# Dependency patches

Applied via [`patch-package`](https://github.com/ds300/patch-package) on `postinstall`.

## `@kobalte/core@0.13.12`

### Nested menu roots keep modal behavior (`chunk/L544S5A4.jsx`, `MenuRoot`)

`AppContextMenu` wraps the editor in `ContextMenu.Trigger`, providing a `MenuContext` to the
whole subtree. The base `Menu` derives its parent purely from ambient context
(`parentMenuContext = useOptionalMenuContext()`), so an independent `DropdownMenu`/`ContextMenu`
under it is misclassified as a submenu: `isRootModalContent()` returns `false` and its modal
behavior (pointer-blocking, focus trap, scroll lock) never engages.

Fix: `MenuRoot` wraps its `<Menu>` in `<MenuContext.Provider value={undefined}>` — a root has no
parent menu. Real submenus use `Menu.Sub` → `MenuSub` (never `MenuRoot`), so they keep their real
parent context and non-modal behavior and are unaffected.

### Why not in app code

`0.13.12` exports only context reader hooks, not the raw `MenuContext` singleton, so a
wrapper-level reset isn't possible; importing `MenuContext` from `@kobalte/core/src/*` yields a
*separate* context instance that the compiled menus don't use. The fix is not reachable from
application code.

### Upstream / removal

No fix in `0.13.12` or `main`. Related: [#160](https://github.com/kobaltedev/kobalte/issues/160);
[#568](https://github.com/kobaltedev/kobalte/pull/568) is future context-API work, not a guaranteed replacement.

Remove when Kobalte stops treating an unrelated ancestor `MenuContext` as a parent, or the app
no longer renders inside `ContextMenu.Trigger`.

## Unpatched Kobalte assumptions

Verify on Kobalte upgrades:

- `FloatingInspector` relies on `Dialog.Content` forwarding `bypassTopMostLayerCheck`.
- Tooltip focus gating relies on `TooltipTrigger` calling consumer `onFocus` before checking `e.defaultPrevented`.
