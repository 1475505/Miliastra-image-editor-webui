---
name: miliastra-image-css-builder
description: Generate CSS that can be imported into the 千星图片编辑器 (https://github.com/1475505/Miliastra-image-editor-webui) as positioned shape elements. Use when the user wants AI to output CSS that fits or approximates an image with a limited number of elements. For stable import, prefer rectangle and ellipse building blocks only. If the user does not provide the maximum element count, ask for it before generating the CSS.
---

# 千星图片编辑器 CSS 生成

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

## Core Rule

For this skill, generate CSS with only the importer-safe building blocks that reconstruct reliably:

- rectangle
- ellipse via `border-radius: 50%`
- position via `left` and `top`
- size via `width` and `height`
- rotation via `transform: translate(-50%, -50%) rotate(...)`
- transparency via `opacity`

Even though the codebase has some internal support for triangle or star shapes, the CSS importer does not reliably infer those complex shapes from arbitrary CSS. Therefore:

- Do not generate `clip-path`
- Do not generate border-triangle hacks
- Do not generate pseudo-elements
- Approximate triangle, four-point star, and five-point star with multiple rectangles and ellipses

If the user needs an exact triangle or star instead of a CSS approximation, say so briefly and recommend JSON/GIA export or adding native shapes inside the editor after import.

## Simple Example

User request:

`请用不超过 3 个图元生成一个 120x120 的 CSS：白色底，中间一个蓝色圆形，底部一个橙色矩形。`

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
  top: 50px;
  width: 56px;
  height: 56px;
  background: #335cff;
  opacity: 0.96;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 1;
}

.shaper-element.shaper-e2 {
  left: 60px;
  top: 92px;
  width: 52px;
  height: 20px;
  background: #ff8a00;
  opacity: 0.92;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
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

## Supported Building Blocks

Use only these primitive building blocks for CSS output:

- Rectangle: no extra shape property.
- Ellipse: add `border-radius: 50%;`

Represent scaling by changing `width` and `height`.
Represent rotation only with `rotate(<number>deg)`.
Represent transparency only with `opacity`.
Represent complex silhouettes by combining multiple rectangles and ellipses.

Rotation convention:

- `rotate(0deg)` means no rotation.
- Positive angles are clockwise on the editor canvas.
- Negative angles are counterclockwise on the editor canvas.
- When describing orientation in words, prefer being explicit, for example `rotate(45deg)` for a clockwise tilt or `rotate(-30deg)` for a counterclockwise tilt.

## Unsupported Or Unsafe Properties

Do not rely on these, because the current CSS importer ignores them, partially parses them, or does not reconstruct them reliably:

- gradients such as `linear-gradient(...)` or `radial-gradient(...)`
- images such as `url(...)`
- `border`, `outline`, `box-shadow`, `filter`, `mask`
- `clip-path` in any form
- border-triangle techniques such as `width: 0`, `height: 0`, `border-left`, `border-right`, `border-bottom`
- `scale(...)`, `skew(...)`, `matrix(...)`, `translateX(...)`, `translateY(...)`
- pseudo-elements such as `::before` and `::after`
- percentage-based layout as the primary geometry description

## Working Style

When fitting an image:

1. Respect the element limit strictly.
2. Prefer large background rectangles or ellipses first.
3. If the composition needs a background, use a rectangle element instead of container background color.
4. Approximate complex shapes with overlapping rectangles and ellipses.
5. Keep stacking simple and readable.
6. Favor fewer, cleaner shapes over noisy micro-detail.

If the requested fidelity is unrealistic for the given limit, say so briefly and either:

- offer a lower-fidelity CSS version within the limit, or
- recommend SVG/JSON export instead.

## Primitive Examples

All examples below are import-safe and avoid `clip-path`, pseudo-elements, and border hacks.

Common scaffold:

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
```

### Rectangle

Single rectangle:

```css
.shaper-element.shaper-e0 {
  left: 60px;
  top: 60px;
  width: 76px;
  height: 44px;
  background: #2563eb;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}
```

### Isosceles Triangle Approximation

Stepped isosceles triangle built from 5 rectangles:

```css
.shaper-element.shaper-e0 {
  left: 60px;
  top: 30px;
  width: 18px;
  height: 10px;
  background: #ea580c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}

.shaper-element.shaper-e1 {
  left: 60px;
  top: 42px;
  width: 34px;
  height: 10px;
  background: #ea580c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 1;
}

.shaper-element.shaper-e2 {
  left: 60px;
  top: 54px;
  width: 50px;
  height: 10px;
  background: #ea580c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 2;
}

.shaper-element.shaper-e3 {
  left: 60px;
  top: 66px;
  width: 66px;
  height: 10px;
  background: #ea580c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 3;
}

.shaper-element.shaper-e4 {
  left: 60px;
  top: 78px;
  width: 82px;
  height: 10px;
  background: #ea580c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 4;
}
```

### Four-Point Star Approximation

Four-point star built from one vertical rectangle, one horizontal rectangle, and one rotated center square:

```css
.shaper-element.shaper-e0 {
  left: 60px;
  top: 60px;
  width: 18px;
  height: 84px;
  background: #0f4c81;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}

.shaper-element.shaper-e1 {
  left: 60px;
  top: 60px;
  width: 84px;
  height: 18px;
  background: #0f4c81;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 1;
}

.shaper-element.shaper-e2 {
  left: 60px;
  top: 60px;
  width: 34px;
  height: 34px;
  background: #0f4c81;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(45deg);
  transform-origin: 50% 50%;
  z-index: 2;
}
```

### Five-Point Star Approximation

Five-point star built from 5 outward spokes plus 1 center ellipse:

```css
.shaper-element.shaper-e0 {
  left: 60px;
  top: 34px;
  width: 16px;
  height: 56px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  z-index: 0;
}

.shaper-element.shaper-e1 {
  left: 79px;
  top: 48px;
  width: 16px;
  height: 56px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(72deg);
  transform-origin: 50% 50%;
  z-index: 1;
}

.shaper-element.shaper-e2 {
  left: 72px;
  top: 73px;
  width: 16px;
  height: 56px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(144deg);
  transform-origin: 50% 50%;
  z-index: 2;
}

.shaper-element.shaper-e3 {
  left: 48px;
  top: 73px;
  width: 16px;
  height: 56px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(216deg);
  transform-origin: 50% 50%;
  z-index: 3;
}

.shaper-element.shaper-e4 {
  left: 41px;
  top: 48px;
  width: 16px;
  height: 56px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(288deg);
  transform-origin: 50% 50%;
  z-index: 4;
}

.shaper-element.shaper-e5 {
  left: 60px;
  top: 60px;
  width: 24px;
  height: 24px;
  background: #be123c;
  opacity: 1;
  transform: translate(-50%, -50%) rotate(0deg);
  transform-origin: 50% 50%;
  border-radius: 50%;
  z-index: 5;
}
```

These examples are intentionally simple. When generating image-fit CSS, use the same principles to compose larger silhouettes from a small number of safe primitives.
