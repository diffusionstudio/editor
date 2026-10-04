# @diffusionstudio/jsx

The editor supplies the runtime when a project is mounted, so this package is
needed for **types and tooling** — IntelliSense and `tsc --noEmit`. It carries
no renderer: `useTicker` is a declaration that throws outside a mount, and
elements only become a composition once the editor renders them. The pure
helpers (`parseTime`, the source-stamp constants) are real here;
everything else is a type.

See [reference/jsx](https://github.com/diffusionstudio/editor/blob/main/reference/jsx/README.md)
for the authoring surface itself.


## License

[MPL-2.0](./LICENSE)
