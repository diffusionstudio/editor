# Dependency patches

Applied via [`patch-package`](https://github.com/ds300/patch-package) on `postinstall`.

## `@kobalte/core@0.13.12`

**Root cause.** Kobalte's base `Menu` decides it is a submenu purely from ambient context
(`parentMenuContext = useOptionalMenuContext()`). `AppContextMenu` wraps the whole editor in
`ContextMenu.Trigger`, which provides that `MenuContext` to its subtree. So any independent
`DropdownMenu`/`ContextMenu` root rendered under it inherits the `MenuContext` and is
misclassified as a submenu — `isRootModalContent()` returns `false`, so its modal
pointer-blocking (and focus trap / scroll lock) never engages.

**The patch.** Resets `MenuContext` at the `MenuRoot` boundary: `MenuRoot`'s `<Menu>` is
wrapped in `<MenuContext.Provider value={undefined}>`. A `MenuRoot` is an independent root and
must not inherit an ancestor menu as its parent.

**Real submenus are unaffected.** They are created by `Menu.Sub` → `MenuSub`, which renders
`<Menu>` directly and does not pass through `MenuRoot`, so they keep their real parent context
and non-modal behavior.

**Why not in our wrappers.** `0.13.12` exports context reader hooks (`useMenuContext`,
`useOptionalMenuContext`) but not the raw `MenuContext` singleton, so a wrapper-level reset
isn't possible from app code. Importing `MenuContext` from `@kobalte/core/src/*` yields a
separate context instance and cannot affect the compiled menu components.

**Upstream.** No fix in `0.13.12` or on `main`. Related: [issue #160](https://github.com/kobaltedev/kobalte/issues/160),
[PR #568](https://github.com/kobaltedev/kobalte/pull/568) (future context-API work — not a guaranteed replacement).

**Remove when** Kobalte ships a relevant upstream fix, or the app-level `ContextMenu`
structure changes so the editor is no longer rendered inside `ContextMenu.Trigger`.
