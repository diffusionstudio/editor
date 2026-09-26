# /// script
# requires-python = ">=3.10"
# dependencies = ["huggingface_hub", "numpy", "onnx==1.23.0", "onnxslim==0.1.96"]
# ///
"""
Builds the fp16 graphs the package loads from the fp32 SAM 2.1 video export.

Constants are folded in fp32 first, so positional encodings are computed at
full precision before they are stored as halves. The graphs then compute in
fp16 but keep their fp32 inputs and outputs, with a cast at each boundary, so
the pipeline feeding them is the same for either precision.

    uv run packages/sam2/scripts/convert_fp16.py <out-dir>
"""

import shutil
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxslim
from huggingface_hub import hf_hub_download
from onnx import TensorProto, helper, numpy_helper

SOURCE_REPO = 'square-zero-labs/sam2.1-tiny-video-onnx'
SOURCE_REVISION = '3b2984dd865f6e9d2cc6aed0be6a5a5c2eb352ce'
GRAPHS = ['vision_encoder', 'mask_decoder', 'memory_encoder', 'memory_attention', 'pointer_tpos']

# Folding memory attention's RoPE would store the same table once per layer, doubling the download.
UNFOLDED = {'memory_attention'}
FOLD_LIMIT_BYTES = 8 << 20

# Inputs the ONNX spec types as float32 whatever the op computes in, by (op, input index).
FLOAT32_INPUTS = {('Resize', 1), ('Resize', 2)}


def to_fp16(model: onnx.ModelProto) -> onnx.ModelProto:
    graph = model.graph
    keep_float = {
        node.input[i]
        for node in graph.node
        for op, i in FLOAT32_INPUTS
        if node.op_type == op and len(node.input) > i
    }

    for init in graph.initializer:
        if init.data_type == TensorProto.FLOAT and init.name not in keep_float:
            init.CopyFrom(numpy_helper.from_array(to_half(numpy_helper.to_array(init)), init.name))

    for node in graph.node:
        for attr in node.attribute:
            if node.op_type == 'Cast' and attr.name == 'to' and attr.i == TensorProto.FLOAT:
                attr.i = TensorProto.FLOAT16
            elif (
                attr.type == onnx.AttributeProto.TENSOR
                and attr.t.data_type == TensorProto.FLOAT
                and node.op_type in ('Constant', 'ConstantOfShape')
                and node.output[0] not in keep_float
            ):
                attr.t.CopyFrom(numpy_helper.from_array(to_half(numpy_helper.to_array(attr.t)), attr.t.name))

    # Float inputs are cast down on entry and float outputs cast back up on exit.
    entry, exit = [], []
    for vi in graph.input:
        if vi.type.tensor_type.elem_type == TensorProto.FLOAT:
            half = f'{vi.name}__fp16'
            for node in graph.node:
                node.input[:] = [half if name == vi.name else name for name in node.input]
            entry.append(helper.make_node('Cast', [vi.name], [half], name=f'{vi.name}__to_fp16', to=TensorProto.FLOAT16))
    for vi in graph.output:
        if vi.type.tensor_type.elem_type == TensorProto.FLOAT:
            half = f'{vi.name}__fp16'
            for node in graph.node:
                node.output[:] = [half if name == vi.name else name for name in node.output]
                node.input[:] = [half if name == vi.name else name for name in node.input]
            exit.append(helper.make_node('Cast', [half], [vi.name], name=f'{vi.name}__to_fp32', to=TensorProto.FLOAT))

    nodes = entry + list(graph.node) + exit
    del graph.node[:]
    graph.node.extend(nodes)
    del graph.value_info[:]
    onnx.checker.check_model(model)
    return model


def to_half(array: np.ndarray) -> np.ndarray:
    return np.clip(array, -65504, 65504).astype(np.float16)


def main(out: Path) -> None:
    (out / 'onnx').mkdir(parents=True, exist_ok=True)
    fetch = lambda path: hf_hub_download(SOURCE_REPO, path, revision=SOURCE_REVISION)

    shutil.copy(fetch('constants.json'), out / 'constants.json')
    for name in GRAPHS:
        model = onnx.load(fetch(f'onnx/{name}.onnx'))
        if name not in UNFOLDED:
            model = onnxslim.slim(model, size_threshold=FOLD_LIMIT_BYTES)
        onnx.save(to_fp16(model), out / 'onnx' / f'{name}.onnx')
        print(f'{name}: {(out / "onnx" / f"{name}.onnx").stat().st_size:,} bytes')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
