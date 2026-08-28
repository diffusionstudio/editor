# @diffusionstudio/koota-solid

Solid bindings for [koota](https://github.com/pmndrs/koota): a port of `@koota/react`. The API mirrors `@koota/react` one to one, adapted to Solid's reactivity model.

## Usage

```tsx
import { createWorld, trait } from '@diffusionstudio/koota';
import { WorldProvider, useQuery, useTrait } from '@diffusionstudio/koota-solid';

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
