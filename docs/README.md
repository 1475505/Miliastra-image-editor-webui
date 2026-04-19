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
- Parse `.shaper-container` width and height as the canvas when importing CSS
- Ignore `.shaper-container` background color by design; use a full-canvas rectangle element if a visual background is needed
- Keep CSS container size and render with the same `overflow: hidden` behavior
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
- Non-basic library categories are placeholders today
- Current transform editing is single-element only
- Undo / redo is session-level and not persisted
