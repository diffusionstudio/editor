# @diffusionstudio/koota

A vendored fork of [pmndrs/koota](https://github.com/pmndrs/koota) reduced to the
core ECS library, plus the in-house Solid bindings that used to live in
`packages/koota-solid`.

| Entry point | Source | Origin |
| --- | --- | --- |
| `@diffusionstudio/koota` | `src/index.ts` | Vendored upstream core (ISC) |
| `@diffusionstudio/koota/solid` | `src/solid/index.ts` | Ours, a port of `@koota/react` (MPL-2.0) |

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
uses them; we use the Solid bindings below instead), the `publish`
package and its `tsdown` build, tests, benches, docs, examples and upstream repo
tooling. The public API is unchanged: `src/index.ts` is upstream's core entry
point, which is all the published `koota` package re-exported.

There is no build step — the package is consumed as TypeScript source, like every
other package in this workspace.

## `QueryResult.sortBy` — cached ordering

`sortBy` orders a query result by a trait value:

```ts
const children = world.query(ChildOf(parent)).sortBy(OrderIndex, 'value', 'asc');
```

It returns a `QueryResult` with exactly the same shape as the unsorted one, so
`readEach`, `updateEach`, `useStores`, `select`, `sort` and array access all work as
usual. The direction defaults to `'asc'`.

The order is cached per world, keyed by the source entity set plus the trait, key and
direction, and is only recomputed when one of two things happens:

- the matched entities change — tracked through the query's version counter, or, for
  the single-relation-pair fast path (`world.query(ChildOf(parent))`), through a
  per-target version on the relation's reverse index;
- a sort value moves on an entity that is currently in the order — tracked through
  `onChange` / `onAdd` / `onRemove` subscriptions on the sort trait, filtered by
  membership so unrelated entities do not invalidate anything.

When neither happened, `sortBy` is a version comparison and hands back the same result
object as last time. `world.query(...)` still allocates its own snapshot array before
`sortBy` runs, so the end-to-end call stays O(n) — but the sorting itself drops out.
At 20k children: 21.1 µs for the bare query, 20.4 µs for query + `sortBy` on a cache
hit, 239 µs for query + `sort()` with a comparator.

Details worth knowing:

- **The returned result is owned by the cache.** Its backing array is mutated in place
  when the order is recomputed. Copy it (`.slice()`) if you need a stable snapshot.
- **The sort is stable.** Entities that compare equal keep their order from the query,
  which is insertion order for a relation pair.
- **Entities without the trait sort last**, in both directions, as do `null`,
  `undefined` and `NaN`. Presence is read from the entity bitmask, not from the store,
  since stores keep stale values after a trait is removed and entity ids are recycled.
- **Chaining sorts by more than one key**, least significant first:
  `.sortBy(Name, 'last').sortBy(Name, 'first')`. Each link gets its own cache entry.
- **Subscribing to the sort trait marks it tracked**, so `updateEach` runs change
  detection on it for the lifetime of the world. That is what makes writes through
  `updateEach` invalidate the order.
- **Tracking queries** (`Added`/`Removed`/`Changed`) rebuild their result on every run,
  so there is nothing stable to cache against; `sortBy` sorts them in place instead.
- `world.reset()` clears every cached order.

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

## The `sideEffects` field is deliberately narrow

The manifest declares `"sideEffects": ["**/entity-methods-patch.ts"]` rather than
the `false` used by the other packages here. `src/entity/entity-methods-patch.ts`
is imported purely for its side effect — it patches `Number.prototype` with the
entity methods (`has`, `add`, `get`, `set`, ...) so a raw number can act as an
entity. Declaring the package side-effect-free lets bundlers tree-shake that
import away, which breaks every entity method at runtime while still typechecking
cleanly. Listing just that one file keeps the rest of core and all of the Solid
bindings tree-shakeable. It is the only side-effect-only import in the package.

## Upstream `@inline` annotations

Core carries `/* @inline */` comments used by upstream's
`unplugin-inline-functions` build plugin. That plugin is not wired up here, so the
annotations are inert; they are left in place to keep diffs against upstream clean.

## License

This package is dual-origin, so the manifest declares `ISC AND MPL-2.0`:

- Everything outside `src/solid` is vendored koota, ISC licensed,
  Copyright (c) 2024-2025 Poimandres — see [LICENSE](./LICENSE).
- `src/solid` is our own port of `@koota/react`, MPL-2.0 like the rest of this
  repository.

---

# Solid bindings — `@diffusionstudio/koota/solid`


Solid bindings for [koota](https://github.com/pmndrs/koota): a port of `@koota/react`. The API mirrors `@koota/react` one to one, adapted to Solid's reactivity model.

## Usage

```tsx
import { createWorld, trait } from '@diffusionstudio/koota';
import { WorldProvider, useQuery, useTrait } from '@diffusionstudio/koota/solid';

const Position = trait({ x: 0, y: 0 });
const world = createWorld();

function App() {
	return (
		<WorldProvider world={world}>
			<EntityList />
		</WorldProvider>
	);
}

function EntityList() {
	const entities = useQuery(Position);
	return <For each={entities()}>{(entity) => <EntityView entity={entity} />}</For>;
}

function EntityView(props: { entity: Entity }) {
	// Pass reactive inputs as accessors so the hook resubscribes when they change
	const pos = useTrait(() => props.entity, Position);
	return <div>{pos()?.x}, {pos()?.y}</div>;
}
```

## Differences from `@koota/react`

- Every hook returns an `Accessor` instead of a plain value: call it (`pos()`, `entities()`) inside JSX, memos, or effects to subscribe.
- Solid components run once, so hooks are set up once. Where React re-renders with new props, here you pass reactive inputs as accessors: the `target` argument of `useTrait`, `useTraitEffect`, `useTag`, `useHas`, `useTarget`, and `useTargets` accepts `Entity | World` or an accessor returning one.
- The `trait` argument of `useTrait`, `useTraitEffect`, and `useHas` also accepts an accessor, which matters for relation pairs with reactive targets: `useTrait(entity, () => ChildOf(parent()))`. Pair identity is compared by relation + target, so re-evaluations with the same pair do not resubscribe.
- `useTraitEffect` runs its callback untracked, like the React version. Cleanup is tied to the owning component.

## Exports

`WorldProvider`, `useWorld`, `useActions`, `useQuery`, `useQueryFirst`, `useTrait`, `useTraitEffect`, `useTag`, `useHas`, `useTarget`, `useTargets`, plus the `MaybeAccessor` type and `access` helper.
