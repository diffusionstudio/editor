# Fonts

Both text paths draw with fonts **installed on the machine**. Discover what is available with [`dapi fonts`](../fonts.md) (filter by family, weight, or style); the active project's families are also on [`dapi context`](../context.md) as `fontFamilies`. macOS resolves these families for both the native renderer and the browser, so there is nothing to bundle or load.

## Native `<text>`

Name a family on the [`<text>`](./text.md) element with `fontFamily`; pick the variant with `fontWeight` and `fontStyle`. The value must be a family present in `dapi fonts`; an unknown family falls back to the editor default.

```tsx
<text fontFamily="Inter" fontWeight={700} fontSize={128} textAlign="center" textBaseline="middle">
  Hello World
</text>
```

## HTML

In [`<html>`](./html.md) you style text with ordinary CSS, so **use a locally installed font** and name it directly. The browser resolves the family from the OS:

```tsx
<html width={700} height={110}>
  <div style="font:500 40px Inter;color:#fff;">Introduction</div>
</html>
```

Remote web fonts work too (a Google Fonts `<link>`, or an `@font-face` with a `url()` source). However the cost is that every render then depends on the network and on the font host staying up, so a local family from [`dapi fonts`](../fonts.md) is the safer default for anything you have to be able to re-render on demand.

If you want to pin an exact variant, declare an `@font-face` whose source is the CSS `local()` string that `dapi fonts` reports for that variant (never a `url()`):

```tsx
<html width={700} height={110}>
  <style>{`
    @font-face {
      font-family: "Inter Display";
      font-weight: 700;
      src: local('Inter Display Bold'), local('Inter-DisplayBold');
    }
  `}</style>
  <div style="font:700 40px 'Inter Display';color:#fff;">Introduction</div>
</html>
```
