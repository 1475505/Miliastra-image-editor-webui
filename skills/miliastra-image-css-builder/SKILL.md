---
name: miliastra-image-css-builder
description: Generate CSS that can be imported into the 千星图片编辑器 (https://github.com/1475505/Miliastra-image-editor-webui) as positioned shape elements. Use when the user wants AI to output CSS that fits or approximates an image with a limited number of elements, especially for rectangle, ellipse, or triangle shapes. If the user does not provide the maximum element count, ask for it before generating the CSS.
---

# 千星图片编辑器-css生成

Generate importable CSS for the 千星图片编辑器.

## Ask First

If the user wants image fitting, icon tracing, or visual approximation and does not give a maximum element count, ask a short follow-up question for the limit before writing CSS.

Example:

`请给我一个图元数量上限，例如 20、50 或 100。`

## Output Goal

Return CSS only unless the user explicitly asks for explanation.

Target the editor's CSS importer format:

- One `.shaper-container { ... }` block for the canvas.
- One rule per element, preferably `.shaper-element.shaper-e0`, `.shaper-element.shaper-e1`, and so on.
- Use absolute positioning with the element center expressed by `left` and `top`.
- Treat `.shaper-container` as layout only, not as visual background.

## Simple Example

User request:

`请用不超过 3 个图元生成一个 120x120 的 CSS：白色底，中央一个蓝色圆形，底部一个橙色三角形。`

Expected output style:

```css
.shaper-container {
  position: relative;
  width: 120px;
  height: 120px;
  background: #ffffff;
  overflow: hidden;
}

.shaper-element {
  position: absolute;
  box-sizing: border-box;
}

.shaper-element.shaper-e0 {
  left: 60px;
  top: 60px;
  width: 120px;
  height: 120px;
  background: #ffffff;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}

.shaper-element.shaper-e1 {
  left: 60px;
  top: 52px;
  width: 56px;
  height: 56px;
  background: #335cff;
  opacity: 0.95;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 1;
}

.shaper-element.shaper-e2 {
  left: 60px;
  top: 92px;
  width: 48px;
  height: 24px;
  background: #ff8a00;
  opacity: 0.9;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  clip-path: polygon(50% 0%, 0% 100%, 100% 100%);
  z-index: 2;
}
```

## Required Canvas Properties

Always include these in `.shaper-container`:

- `position: relative;`
- `width: <number>px;`
- `height: <number>px;`
- `background: #ffffff;`
- `overflow: hidden;`

The container background is not part of the visual design contract.
If the design needs a dark or colored background, represent it with a full-canvas rectangle element as the first shape.

## Required Element Properties

Every element rule must include:

- `left: <number>px;`
- `top: <number>px;`
- `width: <number>px;`
- `height: <number>px;`
- `background: <solid-color>;`
- `opacity: <0-1>;`
- `transform: translate(-50%, -50%) rotate(<number>deg);`
- `transform-origin: 50% 50%;`
- Optional `z-index: <integer>;`

Use `px` units for size and position. Use solid colors only, preferably hex colors such as `#aabbcc` or simple `rgb(r, g, b)`.
Prefer `background` for fills. `background-color` is accepted as a compatibility fallback for elements, but `background` is the recommended output.

## Supported Shapes

Use only these shapes for CSS output:

- Rectangle: no extra shape property.
- Ellipse: add `border-radius: 50%;`
- Triangle: add `clip-path: polygon(50% 0%, 0% 100%, 100% 100%);`

Represent scaling by changing `width` and `height`.
Represent rotation only with `rotate(<number>deg)`.
Represent transparency only with `opacity`.

## Unsupported Or Unsafe Properties

Do not rely on these, because the current importer ignores them or does not reconstruct them reliably:

- gradients such as `linear-gradient(...)` or `radial-gradient(...)`
- images such as `url(...)`
- `border`, `outline`, `box-shadow`, `filter`, `mask`
- `scale(...)`, `skew(...)`, `matrix(...)`, `translateX(...)`, `translateY(...)`
- `clip-path` values other than the exact triangle polygon above
- pseudo-elements such as `::before` and `::after`
- percentage-based layout as the primary geometry description

## Working Style

When fitting an image:

1. Respect the element limit strictly.
2. Prefer large background rectangles or ellipses first.
   If the composition needs a background, use a rectangle element instead of container background color.
3. Use triangles only when they materially improve silhouette or directional detail.
4. Keep stacking simple and readable.
5. Favor fewer, cleaner shapes over noisy micro-detail.

If the requested fidelity is unrealistic for the given limit, say so briefly and either:

- offer a lower-fidelity CSS version within the limit, or
- recommend SVG/JSON export instead.
