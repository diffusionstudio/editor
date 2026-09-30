# Fonts

A `<text>` can be set in any **Google Fonts** family or any font **installed on the machine**. Discover them with [`fonts`](../tools/fonts.md) (filter by family, provider, weight, or style; `popular` narrows to the display and caption faces the font picker leads with). The families the active project has loaded are on [`context`](../tools/context.md) as `fontFamilies`.

## Native `<text>`

Name a family on the [`<text>`](./text.md) element with `fontFamily`; pick the variant with `fontWeight` and `fontStyle`. The value must be a family listed by `fonts`; an unknown family falls back to the editor default (Inter).

```tsx
<text fontFamily="Bebas Neue" fontSize={128} textAlign="center" textBaseline="middle">
  Hello World
</text>
```

A Google family is downloaded the first time a text uses it, only the variants and scripts that text needs, and an export waits for it before drawing a frame. If a Google family and an installed font share a name, the Google family is used.

## HTML

In [`<html>`](./html.md) you style text with ordinary CSS, and Google families are **not** loaded for you. Either link the family's stylesheet (the `stylesheet` URL that `fonts` reports), or name a locally installed font directly:

```tsx
<html width={700} height={110}>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bebas+Neue" />
  <div style="font:400 40px 'Bebas Neue';color:#fff;">Introduction</div>
</html>
```

```tsx
<html width={700} height={110}>
  <div style="font:500 40px Inter;color:#fff;">Introduction</div>
</html>
```

If you want to pin an exact installed variant, declare an `@font-face` whose source is the CSS `local()` string that `fonts` reports for that variant:

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
