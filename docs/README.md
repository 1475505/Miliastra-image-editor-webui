# Miliastra Image Editor WebUI

## Overview

Miliastra Image Editor WebUI is a single-page image element editor with an integrated frontend and backend.

It is designed to:

- import `CSS / JSON / SVG` into one unified scene model
- continue editing that scene in the browser
- export `GIA / CSS / SVG / JSON`

Production deployment is intentionally simple: one FastAPI process serves both the API and the built frontend.

## Current Capabilities

### Import

- Paste or upload `css / json / svg`
- Prefer `.shaper-container` width and height as the canvas when importing CSS
- Ignore `.shaper-container` background color by design; use a full-canvas rectangle element if a visual background is needed
- Auto-expand the canvas when positioned CSS elements overflow `.shaper-container`
- Auto-fit the canvas from parsed elements when `.shaper-container` is missing
- Parse positioned CSS rules without requiring a fixed `.shaper-element.shaper-eN` naming pattern
- Auto-fit canvas bounds for simplified JSON when `canvas` is missing
- Keep `library` information in the scene structure, including categories, presets, and saved items

### Editing

- Left panel provides `基础模板` and `图形库`
- Basic shape library includes:
  - ellipse
  - rectangle
  - triangle
  - four-point star
  - five-point star
  - ring (圆环, fixed inner:outer radius ratio 0.8, GIA asset ref 100006)
  - textbox (文本框: 默认字号 20、白字、透明白底、描边 `#333333` 20%、左/上对齐；支持 `<color>` / `<i>` / `<size>`)
- Other categories are reserved in the UI and JSON interface
- Drag shapes into canvas or double-click to add
- Canvas supports:
  - panning
  - zooming
  - width / height adjustment
  - locked aspect ratio
  - direct move / rotate / resize for selected elements
  - quick right-click color and opacity editing
- Right panel supports:
  - position
  - size
  - rotation
  - color
  - opacity
  - textbox settings (font, colors, outline, alignment, Min/Max/pivot anchors, rich text)
  - background-element flag
  - layer ordering
  - delete current element
- When nothing is selected, the right panel shows the current element list
- Undo / redo shortcuts:
  - `Ctrl+Z`
  - `Ctrl+R`

### Save And Export

- `保存并应用` refreshes JSON / CSS / SVG previews
- The current canvas can be exported as:
  - `GIA`
  - `CSS`
  - `SVG`
  - `JSON`
- Canvas zoom only affects editor display and does not change export geometry

## JSON Structure

Exported JSON uses this high-level structure:

```json
{
  "canvas": {
    "width": 300,
    "height": 300,
    "background": "#ffffff"
  },
  "elements": [],
  "meta": {
    "sourceType": "editor",
    "sourceName": "",
    "warnings": []
  },
  "library": {
    "activeCategory": "基础形状",
    "categories": [],
    "baseShapePresets": [],
    "savedItems": []
  }
}
```

Field notes:

- `library.activeCategory` stores the current library category
- `library.categories` keeps the reserved category interface
- `library.baseShapePresets` stores default size and color for basic shapes
- `library.savedItems` stores saved element snapshots after `保存并应用`

## Repository Structure

```text
backend/   FastAPI service and import/export APIs
frontend/  React + TypeScript + Vite frontend
docs/      project documentation
demo/      sample CSS input
skills/    reusable Codex skill definitions
```

## Stack

- Frontend: `React + TypeScript + Vite`
- Backend: `FastAPI`
- GIA conversion: bundled Python converter in `backend/vendor/gia/`

For deeper implementation details, see [technical-design.md](technical-design.md).

## Known Limitations

- Complex SVG is not guaranteed to round-trip correctly
- SVG export skips ring (圆环) elements and writes a `Miliastra-Warning` comment in the file head; use CSS or JSON export for rings
- Non-basic library categories are placeholders today
- Current transform editing is single-element only
- Undo / redo is session-level and not persisted
