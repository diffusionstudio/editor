import {
  Ai, ChildOf, Fonts, FramePromises, FrameRate, Library, Mode, Project,
  RenderSurface, Root, Source, createRuntimeWorld, disposeDecoders, resetCamera,
} from "@diffusionstudio/runtime";
import { mount } from "@diffusionstudio/reconciler";
import { createEncoder } from "@diffusionstudio/encoder";

declare const window: any;

async function post(path: string, body: any, type: string) {
  await fetch(path, { method: "POST", headers: { "content-type": type }, body });
}

async function run() {
  const job = await (await fetch("/api/job")).json();

  const world = createRuntimeWorld(job.projectId ?? "headless");
  world.set(Mode, { value: job.mode ?? "offline-video" });
  world.set(FrameRate, { value: job.fps ?? 30 });
  world.set(FramePromises, { list: [] });

  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  canvas.style.cssText =
    "position:fixed;left:0;top:0;z-index:-9999;opacity:0;will-change:opacity;pointer-events:none;";
  document.body.appendChild(canvas);
  world.set(RenderSurface, { canvas, ctx: canvas.getContext("2d"), resolution: 1 });

  const mounted = mount(job.code, world);

  const roots = [...world.query(ChildOf(world.get(Root)!))];
  if (roots.length !== 1) throw new Error(`Expected one scene, found ${roots.length}`);

  resetCamera(world);

  const encoder = await createEncoder(world, {
    format: job.format ?? "mp4",
    video: job.video ?? { codec: "avc", resolution: 1080, fps: job.fps ?? 30, bitrate: 8e6 },
    audio: job.audio ?? { enabled: false },
    comment: "Rendered by Frank",
  });

  const result = await encoder.render();
  if (result.type !== "success") throw new Error(`Render ${result.type}`);

  const buf = await result.data.arrayBuffer();
  await post("/api/result", buf, "application/octet-stream");

  mounted.dispose();
  disposeDecoders(world, world.get(Root)!);
  canvas.remove();
  world.destroy();

  await post("/api/status", "ok", "text/plain");
}

run().catch(async (e) => {
  await post("/api/status", String(e && e.stack ? e.stack : e), "text/plain");
});
