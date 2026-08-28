import { useWorld } from "@diffusionstudio/koota/solid";
import { getRuntimeDocument } from "@diffusionstudio/reconciler";

export function useDocument() {
  const world = useWorld();
  return () => getRuntimeDocument(world);
}
