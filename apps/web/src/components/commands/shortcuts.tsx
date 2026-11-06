/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The keyboard shortcuts worth finding by name, in the palette under the
// names the project menu gives them: each runs what its keys run, and shows
// the keys.

import { For } from "solid-js";
import { useWorld } from "@diffusionstudio/koota-solid";
import {
  FrameRate,
  Selected,
  getActiveEntity,
  isGroupLike,
  isSequence,
  shuttlePlayback,
  stopPlayback,
  togglePlayback,
} from "@diffusionstudio/runtime";
import { useCommand } from "@/context/commands";
import { clipboardHasMedia } from "@/lib/clipboard";
import {
  applySelectionAsMask,
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  getDocumentEditor,
  getEditHistory,
  getSelectionMask,
  groupSelection,
  pasteSelection,
  redoEdit,
  restackSelection,
  seekBy,
  seekToSelectionEdge,
  seekToTimelineEdge,
  selectAll,
  splitAtPlayhead,
  toggleSelectionHidden,
  undoEdit,
  ungroupSelection,
  unwrapSequenceSelection,
  useActiveScene,
  useSelection,
  wrapSelectionInScene,
  wrapSelectionInSequence,
} from "@/engine";

import { bindSelection, bindingOf, bindingSelection, clearBindings } from "@/engine/timeline/magnetic-binding";
import {
  designateMagneticTrack,
  magneticTrackMode,
  selectedVideoTrack,
  setMagneticTrackEnabled,
} from "@/engine/timeline/magnetic-track";

import type { Entity, World } from "koota";
import type { Section } from "@/context/commands";
import type { DocumentEditor, EditHistory } from "@/engine";

/** What a shortcut needs to have something to work on. */
type ShortcutState = {
  /** The selected nodes. */
  nodes: Entity[];
  history: EditHistory;
  editor: DocumentEditor;
  scene: Entity | null;
  world: World;
};

type Shortcut = {
  id: string;
  title: string;
  group: Section;
  icon: string;
  /** Its keys, one cap each. */
  keys: string[];
  keywords?: string[];
  run(world: World): void;
  /** Whether it has something to work on; always, when left out. */
  available?(state: ShortcutState): boolean;
};

const selection = ({ nodes }: ShortcutState) => nodes.length > 0;
const activeScene = ({ scene }: ShortcutState) => scene !== null;
/** Clips to seek to the edges of: the active scene is where they are, not one of them. */
const selectedClips = ({ nodes, scene }: ShortcutState) => scene !== null && nodes.some((node) => node !== scene);

/** Runs `action` on the active scene, if there is one. */
const onActiveScene = (action: (world: World, scene: Entity) => void) => (world: World) => {
  const scene = getActiveEntity(world);
  if (scene) action(world, scene);
};

const seekSeconds = (seconds: number) => (world: World) =>
  seekBy(world, Math.round(seconds * (world.get(FrameRate)?.value ?? 30)));

const SHORTCUTS: Shortcut[] = [
  {
    id: "designate-magnetic-track",
    title: "指定為磁性主軌",
    group: "Timeline",
    icon: "sidebar-timeline",
    keys: [],
    run: (world) => {
      const track = selectedVideoTrack([...world.query(Selected)]);
      if (track) designateMagneticTrack(world, track);
    },
    available: ({ nodes }) => {
      const track = selectedVideoTrack(nodes);
      return track !== null && !magneticTrackMode(track);
    },
  },
  {
    id: "bind-to-video",
    title: "綁定到影片片段",
    group: "Timeline",
    icon: "sidebar-timeline",
    keys: [],
    run: (world) => bindSelection(world, [...world.query(Selected)]),
    available: ({ nodes }) => bindingSelection(nodes) !== null,
  },
  {
    id: "unbind-from-video",
    title: "解除影片綁定",
    group: "Timeline",
    icon: "sidebar-timeline",
    keys: [],
    run: (world) => clearBindings(world, [...world.query(Selected)]),
    available: ({ nodes }) => nodes.some(bindingOf),
  },
  ...([true, false] as const).map((enabled): Shortcut => ({
    id: enabled ? "enable-magnetic-track" : "disable-magnetic-track",
    title: enabled ? "開啟磁性主軌" : "關閉磁性主軌",
    group: "Timeline",
    icon: "sidebar-timeline",
    keys: [],
    run: (world) => {
      const track = selectedVideoTrack([...world.query(Selected)]);
      if (track) setMagneticTrackEnabled(world, track, enabled);
    },
    available: ({ nodes }) => {
      const track = selectedVideoTrack(nodes);
      return track !== null && magneticTrackMode(track) === (enabled ? "off" : "on");
    },
  })),

  {
    id: "group",
    title: "Group",
    group: "Object",
    icon: "group",
    keys: ["⌘", "G"],
    run: groupSelection,
    available: selection,
  },
  {
    id: "ungroup",
    title: "Ungroup",
    group: "Object",
    icon: "group",
    keys: ["⇧", "⌘", "G"],
    run: ungroupSelection,
    available: ({ nodes }) => nodes.some((node) => isGroupLike(node) || isSequence(node)),
  },
  {
    id: "use-as-mask",
    title: "Use as mask",
    group: "Object",
    icon: "mask-small",
    keys: ["⌃", "⌘", "M"],
    keywords: ["matte", "clip"],
    run: applySelectionAsMask,
    available: ({ nodes, world }) => nodes.length === 2 && getSelectionMask(world) !== null,
  },
  {
    id: "wrap-in-scene",
    title: "Wrap in scene",
    group: "Object",
    icon: "scene-frame-small",
    keys: ["⌘", "↩︎"],
    keywords: ["frame"],
    run: wrapSelectionInScene,
    available: selection,
  },
  {
    id: "wrap-in-sequence",
    title: "Wrap in sequence",
    group: "Object",
    icon: "timeline-sequence-small",
    keys: ["⌥", "⌘", "↩︎"],
    run: wrapSelectionInSequence,
    available: selection,
  },
  {
    id: "unwrap-sequence",
    title: "Unwrap sequence",
    group: "Object",
    icon: "timeline-sequence-small",
    keys: ["⌥", "⇧", "⌘", "↩︎"],
    run: unwrapSequenceSelection,
    available: ({ nodes }) => nodes.some(isSequence),
  },
  {
    id: "bring-to-front",
    title: "Bring to front",
    group: "Object",
    icon: "arrow-top",
    keys: ["]"],
    keywords: ["arrange", "order"],
    run: (world) => restackSelection(world, "front"),
    available: selection,
  },
  {
    id: "send-to-back",
    title: "Send to back",
    group: "Object",
    icon: "arrow-bottom",
    keys: ["["],
    keywords: ["arrange", "order"],
    run: (world) => restackSelection(world, "back"),
    available: selection,
  },
  {
    id: "toggle-hidden",
    title: "Show/Hide",
    group: "Object",
    icon: "eye-on",
    keys: ["⇧", "⌘", "H"],
    keywords: ["hide", "show"],
    run: toggleSelectionHidden,
    available: selection,
  },
  {
    id: "toggle-playback",
    title: "Play or pause",
    group: "Timeline",
    icon: "play",
    keys: ["Space"],
    keywords: ["playback", "stop"],
    run: onActiveScene(togglePlayback),
    available: activeScene,
  },
  {
    id: "play-forward",
    title: "Play forward",
    group: "Timeline",
    icon: "timeline.shuttle-forward",
    keys: ["L"],
    keywords: ["shuttle", "faster"],
    run: onActiveScene((world, scene) => shuttlePlayback(world, scene, 1)),
    available: activeScene,
  },
  {
    id: "play-backward",
    title: "Play backward",
    group: "Timeline",
    icon: "timeline.shuttle-backward",
    keys: ["J"],
    keywords: ["shuttle", "reverse", "rewind"],
    run: onActiveScene((world, scene) => shuttlePlayback(world, scene, -1)),
    available: activeScene,
  },
  {
    id: "stop-playback",
    title: "Stop playback",
    group: "Timeline",
    icon: "timeline.stop",
    keys: ["K"],
    keywords: ["shuttle", "pause"],
    run: onActiveScene(stopPlayback),
    available: activeScene,
  },
  {
    id: "next-frame",
    title: "Go to next frame",
    group: "Timeline",
    icon: "timeline.next-frame",
    keys: ["D"],
    keywords: ["step", "jump", "forward"],
    run: (world) => seekBy(world, 1),
    available: activeScene,
  },
  {
    id: "previous-frame",
    title: "Go to previous frame",
    group: "Timeline",
    icon: "timeline.previous-frame",
    keys: ["A"],
    keywords: ["step", "jump", "back"],
    run: (world) => seekBy(world, -1),
    available: activeScene,
  },
  {
    id: "skip-forward",
    title: "Skip forward 1 second",
    group: "Timeline",
    icon: "timeline.skip-forward",
    keys: ["W"],
    keywords: ["jump", "seek"],
    run: seekSeconds(1),
    available: activeScene,
  },
  {
    id: "skip-back",
    title: "Skip back 1 second",
    group: "Timeline",
    icon: "timeline.skip-back",
    keys: ["S"],
    keywords: ["jump", "seek"],
    run: seekSeconds(-1),
    available: activeScene,
  },
  {
    id: "go-to-start",
    title: "Go to start",
    group: "Timeline",
    icon: "timeline.go-to-start",
    keys: ["Home"],
    keywords: ["jump", "beginning", "first frame"],
    run: (world) => seekToTimelineEdge(world, "start"),
    available: activeScene,
  },
  {
    id: "go-to-end",
    title: "Go to end",
    group: "Timeline",
    icon: "timeline.go-to-end",
    keys: ["End"],
    keywords: ["jump", "last frame"],
    run: (world) => seekToTimelineEdge(world, "end"),
    available: activeScene,
  },
  {
    id: "go-to-selection-start",
    title: "Go to selection start",
    group: "Timeline",
    icon: "timeline.go-to-selection-start",
    keys: [";"],
    keywords: ["jump", "clip", "in point"],
    run: (world) => seekToSelectionEdge(world, "start"),
    available: selectedClips,
  },
  {
    id: "go-to-selection-end",
    title: "Go to selection end",
    group: "Timeline",
    icon: "timeline.go-to-selection-end",
    keys: ["'"],
    keywords: ["jump", "clip", "out point"],
    run: (world) => seekToSelectionEdge(world, "end"),
    available: selectedClips,
  },
  {
    id: "split",
    title: "Split at playhead",
    group: "Timeline",
    icon: "split",
    keys: ["⌘", "B"],
    keywords: ["cut", "razor", "blade"],
    run: splitAtPlayhead,
    available: activeScene,
  },
  {
    id: "undo",
    title: "Undo",
    group: "Edit",
    icon: "undo",
    keys: ["⌘", "Z"],
    run: undoEdit,
    available: ({ history }) => history.canUndo(),
  },
  {
    id: "redo",
    title: "Redo",
    group: "Edit",
    icon: "redo",
    keys: ["⇧", "⌘", "Z"],
    run: redoEdit,
    available: ({ history }) => history.canRedo(),
  },
  {
    id: "copy",
    title: "Copy",
    group: "Edit",
    icon: "copy",
    keys: ["⌘", "C"],
    keywords: ["clipboard"],
    run: copySelection,
    available: selection,
  },
  {
    id: "cut",
    title: "Cut",
    group: "Edit",
    icon: "cut",
    keys: ["⌘", "X"],
    keywords: ["clipboard"],
    run: cutSelection,
    available: selection,
  },
  {
    id: "paste",
    title: "Paste",
    group: "Edit",
    icon: "paste",
    keys: ["⌘", "V"],
    keywords: ["clipboard"],
    run: pasteSelection,
    available: ({ editor }) => editor.canPaste() || clipboardHasMedia(),
  },
  {
    id: "duplicate",
    title: "Duplicate",
    group: "Edit",
    icon: "duplicate",
    keys: ["⌘", "D"],
    keywords: ["copy", "clone"],
    run: duplicateSelection,
    available: selection,
  },
  {
    id: "delete",
    title: "Delete",
    group: "Edit",
    icon: "trash",
    keys: ["⌫"],
    keywords: ["remove"],
    run: deleteSelection,
    available: selection,
  },
  {
    id: "select-all",
    title: "Select all",
    group: "Edit",
    icon: "select-all",
    keys: ["⌘", "A"],
    run: selectAll,
  },
];

/** Every shortcut as a command, sharing one read of what they work on. */
export function ShortcutCommands() {
  const world = useWorld();
  const { nodes } = useSelection();
  const scene = useActiveScene();
  const history = getEditHistory(world);
  const editor = getDocumentEditor(world);

  const state = (): ShortcutState => ({ nodes: nodes(), history, editor, scene: scene(), world });

  return <For each={SHORTCUTS}>{(shortcut) => <ShortcutCommand shortcut={shortcut} state={state} />}</For>;
}

function ShortcutCommand(props: { shortcut: Shortcut; state: () => ShortcutState }) {
  const world = useWorld();
  const { shortcut } = props;

  useCommand({
    id: `shortcut:${shortcut.id}`,
    title: shortcut.title,
    group: shortcut.group,
    icon: shortcut.icon,
    keywords: shortcut.keywords,
    shortcut: shortcut.keys,
    available: shortcut.available ? () => shortcut.available!(props.state()) : undefined,
    run: () => shortcut.run(world),
  });

  return null;
}
