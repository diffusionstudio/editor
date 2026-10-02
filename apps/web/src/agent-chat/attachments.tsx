/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


import { Show, createSignal } from "solid-js";

import { pickFiles } from "@diffusionstudio/assets";

import { Icon } from "@/components/ui/icon";
import { RemoveButton } from "@/components/ui/remove-button";
import { cx } from "@/lib/cva";

/**
 * A file or folder dropped onto a composer. Only what the tile and the
 * handoff need: the name to label it, the kind and extension to draw it, and
 * the path to send — null off the desktop, where the browser will not say
 * where a dropped file lives.
 */
export type Attachment = {
  key: string;
  name: string;
  kind: "file" | "folder";
  path: string | null;
};

/** The paths worth sending: attachments the shell could locate. */
export const attachmentPaths = (attachments: Attachment[]): string[] =>
  attachments.flatMap((entry) => (entry.path ? [entry.path] : []));

/** An attachment rebuilt from a path, for a draft restored after a failed send. */
export function attachmentFromPath(path: string): Attachment {
  const name = path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || path;
  return { key: path, name, kind: /\.[A-Za-z0-9]{1,8}$/.test(name) ? "file" : "folder", path };
}

/**
 * The files and folders in a drop, in the order they were dragged. Folders
 * are told apart through the entry API, the only thing a drop says about a
 * directory; the path comes from the desktop shell, which is the only one
 * that knows it. Nothing is opened or read.
 */
export function droppedAttachments(event: DragEvent): Attachment[] {
  const items = Array.from(event.dataTransfer?.items ?? []);
  const result: Attachment[] = [];

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    const file = item.getAsFile();
    if (!file) continue;

    result.push(fileAttachment(file, entry?.isDirectory ? "folder" : "file", entry?.name || file.name));
  }

  return result;
}

/** A file picked or dropped without the entry API, which only a drop has. */
function fileAttachment(file: File, kind: Attachment["kind"] = "file", name = file.name): Attachment {
  const path = window.desktop?.getPathForFile(file) || null;
  return { key: path ?? `${name}:${file.size}:${file.lastModified}`, name, kind, path };
}

/** Files chosen from the system picker, as attachments; folders can only be dropped. */
export async function pickAttachments(): Promise<Attachment[]> {
  const files = await pickFiles({ accept: "" });
  return files.map((file) => fileAttachment(file));
}

/** The same file dropped twice is one attachment, not two tiles. */
export function mergeAttachments(current: Attachment[], dropped: Attachment[]): Attachment[] {
  const known = new Set(current.map((entry) => entry.key));
  return [...current, ...dropped.filter((entry) => !known.has(entry.key))];
}

/**
 * The drag handlers a drop target needs, and whether something is being
 * dragged over it. Drag events fire on every child the pointer crosses, so
 * the overlay is held up by a count of nested enters rather than the last
 * event seen.
 */
export function createDropZone(onDrop: (dropped: Attachment[]) => void) {
  let counter = 0;
  const [dragging, setDragging] = createSignal(false);

  const onDragOver = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const onDragEnter = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter++;
    setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter--;
    if (counter <= 0) {
      counter = 0;
      setDragging(false);
    }
  };
  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    counter = 0;
    setDragging(false);
    const dropped = droppedAttachments(event);
    if (dropped.length) onDrop(dropped);
  };

  return { dragging, onDragOver, onDragEnter, onDragLeave, onDrop: handleDrop };
}

/** The static overlay a composer shows while something is dragged over it. */
export function DropOverlay(props: { radius?: string }) {
  const radius = () => props.radius ?? "rounded-[20px]";
  return (
    <div class={`absolute inset-0 z-20 overflow-hidden border border-primary bg-background p-2 ${radius()}`}>
      <div class={`absolute inset-0 bg-muted ${radius()}`} />
      <div class="relative flex size-full items-center justify-center gap-1 rounded-xl">
        <svg
          aria-hidden="true"
          class="pointer-events-none absolute inset-[0.5px] size-[calc(100%-1px)] overflow-visible text-border-input opacity-15"
        >
          <rect
            width="100%"
            height="100%"
            rx="12"
            fill="none"
            stroke="currentColor"
            stroke-width="1"
            stroke-dasharray="8 4"
            shape-rendering="crispEdges"
          />
        </svg>
        <Icon name="attachment" class="size-6 text-muted-foreground" />
        <span class="text-xs font-450 text-muted-foreground">Drop files or folders here</span>
      </div>
    </div>
  );
}

type AttachmentTileProps = {
  attachment: Attachment;
  class?: string;
  onRemove(): void;
};

/**
 * One dropped file or folder: a grey square with a folder mark, or the file's
 * type in the middle. There is no thumbnail to show — nothing is loaded — so
 * the name is in the tooltip and the remove button appears on hover, as it
 * does on the generation composer's reference images.
 */
export function AttachmentTile(props: AttachmentTileProps) {
  return (
    <div
      class={cx("group relative size-10 shrink-0", props.class)}
      title={props.attachment.name}
    >
      <div class="grid size-full place-items-center overflow-hidden rounded-lg bg-input text-muted-foreground">
        <Show
          when={props.attachment.kind === "folder"}
          fallback={
            <span class="max-w-9 truncate px-0.5 text-[9px] font-450 uppercase tracking-wide">
              {fileType(props.attachment.name)}
            </span>
          }
        >
          <Icon name="navigation.folder" class="size-6" />
        </Show>
      </div>
      <RemoveButton
        label={`Remove ${props.attachment.name}`}
        class="absolute -right-2.5 -top-2.5 z-10 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={props.onRemove}
      />
    </div>
  );
}

/** A small chip for a path in a sent message: icon plus name. */
export function AttachmentChip(props: { path: string }) {
  const attachment = () => attachmentFromPath(props.path);
  return (
    <span class="inline-flex h-5 max-w-full items-center gap-0.5 rounded border border-border bg-transparent pl-0.5 pr-1.5 text-[11px] text-muted-foreground" title={props.path}>
      <Icon name={attachment().kind === "folder" ? "navigation.folder" : "attachment"} class="size-4" />
      <span class="truncate">{attachment().name}</span>
    </span>
  );
}

/** `MP4` for `clip.mp4`, `FILE` for a name with no extension to speak of. */
export function fileType(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1) : "";
  return ext && ext.length <= 8 ? ext : "FILE";
}
