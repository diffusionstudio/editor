# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "onnx==1.23.0", "onnxslim==0.1.96", "torch==2.14.0", "transformers==5.17.0"]
# ///
"""
Exports the graphs the package loads: SAM 2.1 Hiera-Tiny video tracking as
five fixed-shape ONNX graphs, from the `transformers` port of the checkpoint.

The input resolution and the number of frame memories attended to are
parameters; the package's constants must match the ones exported. The
graphs compute in fp16 but take and return fp32, with a cast at each boundary.
Constants are folded in fp32 first, so positional encodings are computed at
full precision before they are stored as halves.

    uv run packages/sam2/scripts/export.py <image-size> <memory-frames> <out-dir>
"""

import hashlib
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnx
import onnxslim
import torch
import torch.nn.functional as F
from onnx import TensorProto, helper, numpy_helper
from torch import nn
from transformers import Sam2VideoConfig, Sam2VideoModel
from transformers.models.sam2_video.modeling_sam2_video import NO_OBJ_SCORE, get_1d_sine_pe

CHECKPOINT = 'facebook/sam2.1-hiera-tiny'
# Masks come out at this size whatever the input resolution, upsampled from the decoder's.
MASK_SIZE = 256
MAX_POINTERS = 16

# Inputs the ONNX spec types as float32 whatever the op computes in, by (op, input index).
FLOAT32_INPUTS = {('Resize', 1), ('Resize', 2)}


def load(image_size: int) -> Sam2VideoModel:
    config = Sam2VideoConfig.from_pretrained(CHECKPOINT)
    feat = image_size // 16
    config.image_size = image_size
    config.vision_config.backbone_config.image_size = [image_size, image_size]
    config.vision_config.backbone_feature_sizes = [[feat * 4, feat * 4], [feat * 2, feat * 2], [feat, feat]]
    config.prompt_encoder_config.image_size = image_size
    config.mask_decoder_config.image_size = image_size
    config.memory_attention_rope_feat_sizes = [feat, feat]
    model = Sam2VideoModel.from_pretrained(CHECKPOINT, config=config, attn_implementation='eager').eval()

    # The backbone's position embedding depends only on the input size; exported as the
    # computation it is, it brings `If` nodes that the runtime evaluates on the CPU.
    backbone = model.vision_encoder.backbone
    with torch.no_grad():
        pos_embed = backbone._get_pos_embed((image_size // 4, image_size // 4))
    backbone._get_pos_embed = lambda hw: pos_embed
    return model


class VisionEncoder(nn.Module):
    """A frame's features at three scales, the smallest also with the prompted frame's no-memory embedding."""

    def __init__(self, model: Sam2VideoModel):
        super().__init__()
        self.model = model
        # Depends only on the input size, so it is a constant rather than a computation in fp16.
        size = model.image_size
        with torch.no_grad():
            self.register_buffer('pos_embed', model.vision_encoder(torch.zeros(1, 3, size, size)).fpn_position_encoding[2])

    def forward(self, pixel_values):
        m = self.model
        feats = m.vision_encoder(pixel_values, return_dict=True).fpn_hidden_states
        feats0 = m.mask_decoder.conv_s0(feats[0])
        feats1 = m.mask_decoder.conv_s1(feats[1])
        feats2_no_mem = feats[2] + m.no_memory_embedding.view(1, -1, 1, 1)
        return feats0, feats1, feats[2], feats2_no_mem, self.pos_embed


class MaskDecoder(nn.Module):
    """Prompt encoder and mask decoder, picking the mask and object pointer as the video predictor does."""

    def __init__(self, model: Sam2VideoModel):
        super().__init__()
        self.model = model

    def forward(self, feats0, feats1, feats2_cond, input_points, input_labels):
        m = self.model
        d = m.mask_decoder
        sparse, dense = m.prompt_encoder(input_points=input_points, input_labels=input_labels, input_boxes=None, input_masks=None)

        _, channels, height, width = feats2_cond.shape
        tokens = torch.cat([d.obj_score_token.weight, d.iou_token.weight, d.mask_tokens.weight], dim=0)
        tokens = torch.cat([tokens[None, None], sparse], dim=2)
        point_embeddings, image_embeddings = d.transformer(
            point_embeddings=tokens,
            image_embeddings=feats2_cond + dense,
            image_positional_embeddings=m.get_image_wide_positional_embeddings(),
            attention_similarity=None,
            target_embedding=None,
        )
        iou_token_out = point_embeddings[:, :, 1, :]
        mask_tokens_out = point_embeddings[:, :, 2 : 2 + d.num_mask_tokens, :]

        image_embeddings = image_embeddings.transpose(2, 3).reshape(1, channels, height, width)
        upscaled = d.activation(d.upscale_layer_norm(d.upscale_conv1(image_embeddings) + feats1))
        upscaled = d.activation(d.upscale_conv2(upscaled) + feats0)
        hyper_in = torch.stack([mlp(mask_tokens_out[:, :, i, :]) for i, mlp in enumerate(d.output_hypernetworks_mlps)], dim=2)
        _, c, h, w = upscaled.shape
        masks = (hyper_in @ upscaled.view(1, 1, c, h * w)).view(1, 1, -1, h, w)
        iou_pred = d.iou_prediction_head(iou_token_out)
        object_score_logits = d.pred_obj_score_head(point_embeddings[:, :, 0, :])

        # Several candidate masks when there is at most one real point: every tracked frame, and a single click.
        multimask = (input_labels != -1).sum() <= m.config.multimask_max_pt_num
        best = torch.argmax(iou_pred[0, 0, 1:]) + 1
        multi_mask, multi_iou, multi_token = masks[0, 0, best], iou_pred[0, 0, best], mask_tokens_out[0, 0, best]

        # One mask: token 0's, unless it is unstable and the best candidate's is taken instead.
        single = masks[0, 0, 0]
        delta = d.dynamic_multimask_stability_delta
        area_i = (single > delta).sum().float()
        area_u = (single > -delta).sum().float()
        stability = torch.where(area_u > 0, area_i / area_u, torch.ones_like(area_u))
        stable = stability >= d.dynamic_multimask_stability_thresh
        single_mask = torch.where(stable, single, multi_mask)
        single_iou = torch.where(stable, iou_pred[0, 0, 0], multi_iou)

        low_res = torch.where(multimask, multi_mask, single_mask)
        iou = torch.where(multimask, multi_iou, single_iou)
        token = torch.where(multimask, multi_token, mask_tokens_out[0, 0, 0])

        appearing = object_score_logits[0, 0, 0] > 0
        low_res = torch.where(appearing, low_res, torch.full_like(low_res, NO_OBJ_SCORE))[None, None]
        high_res = F.interpolate(low_res, size=(m.image_size, m.image_size), mode='bilinear', align_corners=False)
        mask = low_res if w == MASK_SIZE else F.interpolate(low_res, size=(MASK_SIZE, MASK_SIZE), mode='bilinear', align_corners=False)

        weight = appearing.float()
        pointer = weight * m.object_pointer_proj(token[None, None]) + (1 - weight) * m.no_object_pointer
        return mask, high_res, iou.view(1, 1), object_score_logits, pointer.view(1, 1, -1)


class MemoryEncoder(nn.Module):
    """A frame's memory from its features and mask; `binarize` is 1 for a prompted frame."""

    def __init__(self, model: Sam2VideoModel):
        super().__init__()
        self.model = model

    def forward(self, feats2, high_res_mask, object_score_logits, binarize):
        m = self.model
        mask = torch.where(binarize > 0.5, (high_res_mask > 0).float(), torch.sigmoid(high_res_mask))
        mask = mask * m.config.sigmoid_scale_for_mem_enc + m.config.sigmoid_bias_for_mem_enc
        features, pos = m.memory_encoder(feats2, mask)
        occluded = 1 - (object_score_logits > 0).float()
        features = features + occluded.view(1, 1, 1, 1) * m.occlusion_spatial_embedding_parameter.view(1, -1, 1, 1)
        return features.flatten(2).permute(2, 0, 1), pos.flatten(2).permute(2, 0, 1)


class MemoryAttention(nn.Module):
    """The frame's features conditioned on the memory bank: frame memories, then object pointer tokens."""

    def __init__(self, model: Sam2VideoModel):
        super().__init__()
        self.model = model

    def forward(self, current_vision_features, current_vision_position_embeddings, memory, memory_pos):
        m = self.model
        feat = m.backbone_feature_sizes[-1][0]
        out = m.memory_attention(
            current_vision_features=current_vision_features,
            current_vision_position_embeddings=current_vision_position_embeddings,
            memory=memory,
            memory_posision_embeddings=memory_pos,
            num_object_pointer_tokens=MAX_POINTERS * (m.hidden_dim // m.mem_dim),
        )
        return out.squeeze(1).transpose(1, 2).reshape(1, m.hidden_dim, feat, feat)


class PointerTpos(nn.Module):
    """Temporal positions of the object pointers, from their normalized frame distances."""

    def __init__(self, model: Sam2VideoModel):
        super().__init__()
        self.model = model

    def forward(self, normalized_diffs):
        m = self.model
        return m.temporal_positional_encoding_projection_layer(get_1d_sine_pe(normalized_diffs, dim=m.hidden_dim))


def export_fp32(model: Sam2VideoModel, memory_frames: int, out: Path) -> None:
    s = model.image_size
    f = s // 16
    rows = memory_frames * f * f + MAX_POINTERS * (model.hidden_dim // model.mem_dim)

    def save(module, name, args, inputs, outputs, dynamic_axes=None):
        with torch.no_grad():
            torch.onnx.export(
                module, args, str(out / f'{name}.onnx'), input_names=inputs, output_names=outputs,
                opset_version=17, dynamo=False, dynamic_axes=dynamic_axes,
            )

    save(VisionEncoder(model), 'vision_encoder', (torch.randn(1, 3, s, s),),
         ['pixel_values'], ['feats0', 'feats1', 'feats2', 'feats2_no_mem', 'vision_pos_embed'])
    save(MaskDecoder(model), 'mask_decoder',
         (torch.randn(1, 32, 4 * f, 4 * f), torch.randn(1, 64, 2 * f, 2 * f), torch.randn(1, 256, f, f),
          torch.rand(1, 1, 2, 2) * s, torch.tensor([[[1, 0]]], dtype=torch.int32)),
         ['feats0', 'feats1', 'feats2_cond', 'input_points', 'input_labels'],
         ['low_res_mask', 'high_res_mask', 'iou', 'object_score_logits', 'object_pointer'],
         {'input_points': {2: 'num_points'}, 'input_labels': {2: 'num_points'}})
    save(MemoryEncoder(model), 'memory_encoder',
         (torch.randn(1, 256, f, f), torch.randn(1, 1, s, s), torch.randn(1, 1), torch.tensor(1.0)),
         ['feats2', 'high_res_mask', 'object_score_logits', 'binarize'], ['memory_tokens', 'memory_pos'])
    save(MemoryAttention(model), 'memory_attention',
         (torch.randn(f * f, 1, 256), torch.randn(f * f, 1, 256), torch.randn(rows, 1, 64), torch.randn(rows, 1, 64)),
         ['current_vision_features', 'current_vision_position_embeddings', 'memory', 'memory_pos'], ['conditioned_feats'])
    save(PointerTpos(model), 'pointer_tpos', (torch.rand(MAX_POINTERS),), ['normalized_diffs'], ['pointer_pos'])


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
    return model


def to_half(array: np.ndarray) -> np.ndarray:
    return np.clip(array, -65504, 65504).astype(np.float16)


def dedupe_constants(model: onnx.ModelProto) -> onnx.ModelProto:
    """Stores each distinct constant once: folding leaves a copy of the RoPE tables in every attention block."""
    graph = model.graph
    for node in [n for n in graph.node if n.op_type == 'Constant' and n.attribute[0].name == 'value']:
        tensor = onnx.TensorProto()
        tensor.CopyFrom(node.attribute[0].t)
        tensor.name = node.output[0]
        graph.initializer.append(tensor)
        graph.node.remove(node)

    first: dict[str, str] = {}
    rename: dict[str, str] = {}
    kept = []
    for init in graph.initializer:
        array = numpy_helper.to_array(init)
        key = hashlib.sha1(f'{array.dtype}{array.shape}'.encode() + array.tobytes()).hexdigest()
        if key in first:
            rename[init.name] = first[key]
        else:
            first[key] = init.name
            kept.append(init)
    del graph.initializer[:]
    graph.initializer.extend(kept)
    for node in graph.node:
        node.input[:] = [rename.get(name, name) for name in node.input]
    return model


def main(image_size: int, memory_frames: int, out: Path) -> None:
    model = load(image_size)
    (out / 'onnx').mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as fp32:
        export_fp32(model, memory_frames, Path(fp32))
        for path in sorted(Path(fp32).glob('*.onnx')):
            graph = dedupe_constants(to_fp16(onnxslim.slim(onnx.load(path))))
            onnx.checker.check_model(graph)
            onnx.save(graph, out / 'onnx' / path.name)
            print(f'{path.stem}: {(out / "onnx" / path.name).stat().st_size:,} bytes')

    constants = {
        'image_size': image_size,
        'memory_frames': memory_frames,
        'image_mean': [0.485, 0.456, 0.406],
        'image_std': [0.229, 0.224, 0.225],
        'memory_temporal_positional_encoding': model.memory_temporal_positional_encoding.detach().reshape(model.num_maskmem, -1).tolist(),
    }
    (out / 'constants.json').write_text(json.dumps(constants))


if __name__ == '__main__':
    main(int(sys.argv[1]), int(sys.argv[2]), Path(sys.argv[3]))
