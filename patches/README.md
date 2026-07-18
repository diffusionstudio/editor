# Dependency patches

Applied via [`patch-package`](https://github.com/ds300/patch-package) on `postinstall`.

## `@kobalte/core@0.13.12`

### Fix 1 — nested menu roots keep modal behavior (`chunk/L544S5A4.jsx`, `MenuRoot`)

`AppContextMenu` wraps the editor in `ContextMenu.Trigger`, providing a `MenuContext` to the
whole subtree. The base `Menu` derives its parent purely from ambient context
(`parentMenuContext = useOptionalMenuContext()`), so an independent `DropdownMenu`/`ContextMenu`
under it is misclassified as a submenu: `isRootModalContent()` returns `false` and its modal
behavior (pointer-blocking, focus trap, scroll lock) never engages.

Fix: `MenuRoot` wraps its `<Menu>` in `<MenuContext.Provider value={undefined}>` — a root has no
parent menu. Real submenus use `Menu.Sub` → `MenuSub` (never `MenuRoot`), so they keep their real
parent context and non-modal behavior and are unaffected.

### Fix 2 — modal dropdowns don't refocus their trigger on pointer/outside dismiss (`chunk/WT65CSSX.jsx`, `DropdownMenuContent`)

`DropdownMenuContent` refocuses its trigger on close unless `hasInteractedOutside`, which it
sets only when `!isModal`. A modal dropdown (restored by Fix 1) therefore refocuses on outside
click; when the trigger also carries a `Tooltip`, that reopens the tooltip, whose dismissable
layer blocks an underlying floating inspector's outside-dismissal.

Fix: set `hasInteractedOutside` on any outside interaction. Escape/keyboard/selection don't fire
`onInteractOutside`, so their focus-return is preserved.

### Why not in app code

`0.13.12` exports only context reader hooks, not the raw `MenuContext` singleton, so a
wrapper-level reset isn't possible; importing `MenuContext` from `@kobalte/core/src/*` yields a
*separate* context instance that the compiled menus don't use. And the modal-refocus decision is
internal to `DropdownMenuContent` (the public `onCloseAutoFocus` can't override it). Neither fix
is reachable from application code.

### Upstream / removal

No fix in `0.13.12` or `main`. Related: [#160](https://github.com/kobaltedev/kobalte/issues/160);
[#568](https://github.com/kobaltedev/kobalte/pull/568) is future context-API work, not a guaranteed replacement.

- Remove **Fix 1** when Kobalte stops treating an unrelated ancestor `MenuContext` as a parent,
  or the app no longer renders inside `ContextMenu.Trigger`.
- Remove **Fix 2** when Kobalte skips modal-dropdown trigger-refocus on pointer/outside dismiss.
