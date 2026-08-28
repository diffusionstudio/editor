# @diffusionstudio/koota

A vendored fork of [pmndrs/koota](https://github.com/pmndrs/koota), reduced to the
core ECS library.

Upstream commit: [`460a0c8`](https://github.com/pmndrs/koota/commit/460a0c8cca7839debffab304ed83dd8bbd0a3d30)
(the `koota@0.6.6` line).

## What was kept

- `packages/core/src` → `src` — the whole vanilla core: world, entities, traits,
  queries, relations, storage, actions.
- `packages/collections/src` → `src/collections` — `SparseSet`, `Deque` and
  `HiSparseBitSet`, the only internal package core depends on. Upstream imports of
  `@koota/collections` were rewritten to relative paths.

## What was dropped

React bindings (`@koota/react` and the `koota/react` entry point — nothing here
uses them; Solid bindings live in `@diffusionstudio/koota-solid`), the `publish`
package and its `tsdown` build, tests, benches, docs, examples and upstream repo
tooling. The public API is unchanged: `src/index.ts` is upstream's core entry
point, which is all the published `koota` package re-exported.

There is no build step — the package is consumed as TypeScript source, like every
other package in this workspace.

## Fork changes

One behavioural change on top of upstream, previously carried as
`patches/koota+0.6.6.patch` against the built `node_modules/koota` and now folded
into the source (that patch file has been deleted):

- `src/query/utils/check-query.ts` and `src/query/utils/check-query-tracking.ts` —
  `Or(...)` is a query-wide constraint, but static bitmasks are stored per trait
  generation. Upstream returns `false` as soon as any one generation's `Or` mask
  fails to match, so an `Or` spanning traits in two generations can never match.
  The fork accumulates `Or` state across the whole generation loop and rejects
  only if no generation matched. The relation-filtered variants delegate to these
  two functions, so they inherit the fix.

## Do not add `"sideEffects": false`

Unlike the other packages in this workspace, this package's manifest deliberately
omits `sideEffects`. `src/entity/entity-methods-patch.ts` is imported purely for
its side effect — it patches `Number.prototype` with the entity methods (`has`,
`add`, `get`, `set`, ...) so a raw number can act as an entity. Declaring the
package side-effect-free lets bundlers tree-shake that import away, which breaks
every entity method at runtime while still typechecking cleanly. Upstream omits
the field for the same reason.

## Upstream `@inline` annotations

Core carries `/* @inline */` comments used by upstream's
`unplugin-inline-functions` build plugin. That plugin is not wired up here, so the
annotations are inert; they are left in place to keep diffs against upstream clean.

## License

koota is ISC licensed, Copyright (c) 2024-2025 Poimandres — see [LICENSE](./LICENSE).
