---
name: miliastra-image-svg-builder
description: Generate SVG that can be imported into the 千星图片编辑器 (https://github.com/1475505/Miliastra-image-editor-webui) as positioned primitive shapes, then exported to GIA. Use when the user provides an image and wants SVG that fits it with a limited number of elements. The SVG importer only supports axis-aligned rectangles, circles/ellipses, and 3-point triangles — rotation is NOT preserved on import. If the user does not give a maximum element count, ask for it before generating the SVG.
---

# 千星图片编辑器 SVG 生成

Generate importable SVG for the 千星图片编辑器.

The SVG will be imported via `POST /api/import { sourceType: "svg" }`, edited, and exported to `GIA` (or `CSS` / `PNG` / `JSON`). Only SVG constructs that the importer reliably reconstructs may appear in the output.

## Ask First

If the user wants image fitting, icon tracing, or visual approximation and does not give a maximum element count, ask a short follow-up question for the limit before writing SVG.

Example:

`请给我一个图元数量上限，例如 20、50 或 100。`

Also confirm the target canvas size if the image dimensions are not obvious (for example `300x300`).

## Output Goal

Return SVG only unless the user explicitly asks for explanation.

The output must be a single well-formed `<svg>` document that:

- Has `width`, `height`, and `viewBox="0 0 W H"` on the root `<svg>` (the `viewBox` offset must be `0 0`; any min-x/min-y is ignored by the importer).
- Keeps every primitive fully inside `[0, 0] → [W, H]`. The SVG importer does **not** auto-expand the canvas, so anything outside the viewBox is lost or clipped on export.
- Uses only the importable primitives listed in §Supported SVG Subset.
- Places a full-canvas background `<rect>` as the **first** child element. The SVG importer hardcodes the canvas background to white and does not flag any element as `isBackground` (the root `<svg>` consumes the importer's index 0), so the first child rect simply acts as the painted background at the lowest `zIndex` and is drawn first in GIA.

## Supported SVG Subset

This is the exact set the importer (`parse_svg_scene` in `backend/app/main.py`) reconstructs. Anything outside this set is either dropped with a warning or silently flattened.

### Canvas / root

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H">
```

- `width` / `height`: parsed as numbers (units like `px` are tolerated but plain numbers are preferred).
- `viewBox`: only the 3rd and 4th components (W, H) are read; the min-x/min-y offset is **ignored**. Always use `0 0 W H`.
- No auto-expand: keep all shapes inside the viewBox.

### Importable tags (namespace-stripped)

| Tag | Imported as | Geometry read | Notes |
|-----|-------------|---------------|-------|
| `<rect>` | `rectangle` | `x`,`y`,`width`,`height` (x,y = top-left) | Axis-aligned only. |
| `<circle>` | `ellipse` | `cx`,`cy`,`r` | `width=height=2r`. |
| `<ellipse>` | `ellipse` | `cx`,`cy`,`rx`,`ry` | `width=2rx`, `height=2ry`. |
| `<polygon points="p1 p2 p3">` | `triangle` | the 3 points' **bounding box** only | Rendered as an upward isosceles triangle within that bbox; the actual vertex shape is NOT preserved. |

### Common attributes (on any of the above)

- `fill` — solid color only: `#rrggbb`, `#rgb`, `rgb(r,g,b)`, or a CSS named color. Gradients, patterns, `url(...)` are dropped. Invalid colors fall back to `#4f46e5`.
- `opacity` — a number in `[0,1]`, read as element opacity. Prefer this over rgba/`#rrggbbaa` fills (alpha in a color is stripped; alpha is expressed via `opacity`).

### Hard import limits (do NOT rely on these)

These are dropped and listed in an import warning by `parse_svg_scene` (the warning reads `部分 SVG 节点未导入: <tags>`). Do not emit them if you want the imported scene to match the SVG preview:

- **`transform` is NOT parsed.** Any `transform="rotate(...)"` / `translate(...)` / `matrix(...)` is ignored → every imported element has `rotation=0`. This is the most important constraint: **the SVG builder cannot use rotation.**
- `<polygon>` with a point count other than 3 → dropped (warning). In particular four-point stars (8 points) and five-point stars (10 points) are **not importable**.
- `<path>`, `<line>`, `<polyline>`, `<use>`, `<g>`-only grouping, `<text>`, `<image>` → dropped (warning).
- Gradients (`<linearGradient>`, `<radialGradient>`), filters (`<filter>`), clip-paths, masks, `<defs>` → dropped (warning).
- `fill-opacity`, `stroke`, `stroke-width`, `rx`/`ry` on `<rect>` (rounded corners) → not read.
- `<style>` element → dropped (warning). CSS classes and presentation attributes other than `fill`/`opacity` on supported elements are simply not read (no warning).

## Core Rule

Generate SVG with **only the importer-safe, axis-aligned building blocks**:

- rectangle via `<rect>`
- circle via `<circle>` (or `<ellipse>` with equal rx,ry)
- ellipse via `<ellipse>`
- upward isosceles triangle via a 3-point `<polygon>`

Because rotation is dropped on import:

- Do **not** emit `transform` on any element. Even if it renders correctly in a browser, the imported scene will flatten every shape to `rotation=0`, so the editor preview and the GIA output would diverge from the SVG.
- Approximate tilted or slanted regions with multiple axis-aligned rectangles and ellipses.
- Approximate triangles that point down or sideways with stacked rectangles/ellipses, or accept apex-up only.

If the user needs an exact four-point star, five-point star, or rotated primitive in the final GIA, say so briefly and recommend one of:

- the `miliastra-image-css-builder` skill (CSS import preserves `transform: rotate(...)`),
- JSON import (full `SceneElement` including `rotation`), or
- adding native star/rotated shapes inside the editor after import.

## Required Structure

A minimal scaffold every output must follow:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="W" height="H" viewBox="0 0 W H">
  <rect x="0" y="0" width="W" height="H" fill="#ffffff" />
  <!-- shape elements here, all inside [0,0]→[W,H] -->
</svg>
```

- The first child is the full-canvas background `<rect>`. Its `fill` is the scene background color (white by default; use a dark/colored fill if the image background is not white).
- Every shape element carries `fill` and (optionally) `opacity`.
- No `transform` anywhere.
- No `<defs>`, no gradients, no filters, no `<style>`.

## Coordinate Conventions

- Origin is top-left, y-down, units in pixels.
- `<rect>` `x`,`y` is the **top-left** corner of the rectangle.
- `<circle>` / `<ellipse>` `cx`,`cy` is the **center**.
- `<polygon>` points are absolute coordinates; only their bounding box is used. To round-trip a triangle faithfully, emit the three vertices of an **apex-up isosceles** triangle so its bbox matches the intended triangle:
  - apex `(cx, cy - h/2)`
  - bottom-left `(cx - w/2, cy + h/2)`
  - bottom-right `(cx + w/2, cy + h/2)`
- Document order = z-order. The first element is the background; later elements paint on top. The importer assigns `zIndex` by document order.

## Color & Opacity

- Use solid `#rrggbb` fills. `rgb(r,g,b)` and named colors are accepted but hex is preferred.
- Express translucency with the `opacity` attribute, not with `rgba()` or 8-digit hex (alpha is stripped from colors and re-expressed via opacity).
- Keep `opacity` in `[0,1]`. Use it for soft color blending when overlapping primitives (the demo CSS style relies heavily on translucent overlaps).

## Simple Example

User request:

`请用不超过 4 个图元生成一个 120x120 的 SVG：白色底，中间一个蓝色圆形，底部一个橙色矩形，左上一个绿色三角形。`

Expected output (note: the background rect counts as one of the 4 elements):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#ffffff" />
  <circle cx="60" cy="52" r="28" fill="#335cff" opacity="0.96" />
  <rect x="34" y="82" width="52" height="20" fill="#ff8a00" opacity="0.92" />
  <polygon points="24,18 12,44 36,44" fill="#16a34a" opacity="0.95" />
</svg>
```

The green triangle's 3 points `(24,18) (12,44) (36,44)` have bbox `x∈[12,36]`, `y∈[18,44]` → center `(24,31)`, `width=24`, `height=26`, imported as an apex-up isosceles triangle. The apex point `(24,18)` is already at the top-center of that bbox, so the imported triangle matches the polygon closely.

## Primitive Examples

All examples are import-safe: no `transform`, no gradients, no non-3-point polygons.

Common scaffold (repeated for each example; canvas 120x120):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect x="0" y="0" width="120" height="120" fill="#ffffff" />
```

### Rectangle

```xml
  <rect x="22" y="38" width="76" height="44" fill="#2563eb" opacity="1" />
```

### Circle / Ellipse

Circle:

```xml
  <circle cx="60" cy="60" r="38" fill="#2563eb" opacity="0.9" />
```

Ellipse (different rx, ry):

```xml
  <ellipse cx="60" cy="60" rx="42" ry="22" fill="#2563eb" opacity="0.9" />
```

### Upward Isosceles Triangle

A triangle centered at `(60,60)`, width `80`, height `70` (apex up):

```xml
  <polygon points="60,25 20,95 100,95" fill="#ea580c" opacity="1" />
```

Points are `apex (60,25)`, `bottom-left (20,95)`, `bottom-right (100,95)`. Bbox is `[20,100]×[25,95]` → center `(60,60)`, `width=80`, `height=70`, imported as apex-up isosceles — matches.

### Triangle Approximation (Stepped)

Because only apex-up isosceles triangles import, a downward or slanted triangle is approximated with stacked rectangles (5 here) rather than a single rotated polygon:

```xml
  <rect x="51" y="25" width="18" height="10" fill="#ea580c" opacity="1" />
  <rect x="43" y="37" width="34" height="10" fill="#ea580c" opacity="1" />
  <rect x="35" y="49" width="50" height="10" fill="#ea580c" opacity="1" />
  <rect x="27" y="61" width="66" height="10" fill="#ea580c" opacity="1" />
  <rect x="19" y="73" width="82" height="10" fill="#ea580c" opacity="1" />
```

### Four-Point Star Approximation

A 4-point star cannot be imported as a polygon (it has 8 points). Build it from axis-aligned rectangles plus a center ellipse:

```xml
  <rect x="51" y="18" width="18" height="84" fill="#0f4c81" opacity="1" />
  <rect x="18" y="51" width="84" height="18" fill="#0f4c81" opacity="1" />
  <ellipse cx="60" cy="60" rx="26" ry="26" fill="#0f4c81" opacity="1" />
```

### Five-Point Star Approximation

A 5-point star (10 points) is also not importable. Approximate with a small center circle and spokes made of rectangles (kept axis-aligned; the spokes are stubs rather than rotated arms):

```xml
  <rect x="52" y="20" width="16" height="40" fill="#be123c" opacity="1" />
  <rect x="52" y="60" width="16" height="40" fill="#be123c" opacity="1" />
  <rect x="20" y="52" width="40" height="16" fill="#be123c" opacity="1" />
  <rect x="60" y="52" width="40" height="16" fill="#be123c" opacity="1" />
  <circle cx="60" cy="60" r="16" fill="#be123c" opacity="1" />
```

For a recognizable 5-point star silhouette, rotation is essential — recommend the CSS builder skill or native editor shapes in that case.

## Working Style

When fitting an image:

1. Respect the element limit strictly (the background rect counts as one element).
2. Lay the full-canvas background rect first with the image's dominant background color.
3. Add large color masses next, preferring `<ellipse>` / `<circle>` for soft blobs and highlights and `<rect>` for flat bands/regions.
4. Fill in mid-size details, then small accents, increasing `zIndex` (later document order paints on top).
5. Use translucent overlaps (`opacity` 0.4–0.9) to blend color masses — this is the main technique for approximating gradients and soft edges without rotation.
6. Keep all coordinates integers or `.5` where possible; never place shapes outside `[0,0]→[W,H]`.
7. Favor fewer, cleaner shapes over noisy micro-detail.

If the requested fidelity is unrealistic for the limit (especially if the image needs many tilted shapes), say so briefly and either:

- offer a lower-fidelity axis-aligned SVG version within the limit, or
- recommend the `miliastra-image-css-builder` skill (CSS import preserves rotation) or JSON export for higher-fidelity GIA fitting.

## Rotation Reminder

The single biggest difference from the CSS builder: **SVG import drops all rotation.** If a good fit requires many rotated ellipses (the technique that powers `demo/demo.css`), SVG is the wrong format — switch the user to CSS. Use the SVG builder when the composition is naturally axis-aligned, or when SVG output is explicitly required.
