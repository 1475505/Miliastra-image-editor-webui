# Miliastra Image Editor WebUI

## Overview

Miliastra Image Editor WebUI is a single-page image element editor with an integrated frontend and backend.

It is designed to:

- import `CSS / JSON / SVG / Lua` into one unified scene model
- continue editing that scene in the browser
- export `GIA / CSS / SVG / JSON / Lua`

Production deployment is intentionally simple: one FastAPI process serves both the API and the built frontend.

## Quick Start / 快速上手

图片描述、40 类用途搜索、看图筛选、素材包下载及 R2 文件发布步骤见 [素材库上传与接入](image-library-upload.md)。AI 选型与批量拼接见 [素材选择技能](../skills/miliastra-image-asset-selector/SKILL.md)。

1. 从左侧图形库拖入形状（或双击添加），也可在「导入」中上传文件或粘贴数据。
2. 直接拖动图元，使用手柄缩放、旋转；在右侧属性面板精调尺寸、颜色和文字。
3. 点击右上角「导出」下载作品。GIA 用于游戏素材，JSON / Lua 可保留场景数据以便继续编辑。

Add shapes from the library or import a file, edit on the canvas, then choose **Export**. Use **Save & Apply** to refresh code previews and reusable library items. This does not save a file to disk; export JSON or Lua to keep a copy.

Lua exports reuse the primitive-shape tool’s client image drawing runtime. Set `IMAGE_PREFAB_ID` to an image control template index, then attach the script to a dedicated empty client container. Both that tool’s palette-based Lua and its GIA-to-Lua outputs can be imported here; uploaded code is never executed. Our exports also preserve names, textbox settings and library items in an editor-data comment. The runtime draws six basic image shapes; textboxes are preserved only for re-import (use GIA for in-game text).

Need to turn a raster image into shapes? Open the [image fitting tool / 图元拟合工具](https://qx-img.070077.xyz/), then import the resulting supported data into the editor. The separate [Miliastra knowledge base / 千星知识库](https://ugc.070077.xyz/) documents the game editor, not this application.

## Current Capabilities

### Import

- Paste or upload `css / json / svg / lua` (Lua: editor / primitive-shape drawing formats)
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
- Browse the existing image library by original category, 40 purpose filters, tone and keywords; purpose and category stay separate
- WebMCP discovers categories and purpose counts, searches assets, previews up to 48 ID-labelled thumbnails, and prepares selected or complete asset ZIPs with original images and a manifest
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
  - `Ctrl+Shift+Z` or `Ctrl+Y` (use ⌘ on macOS)

### Save And Export

- `保存并应用` refreshes JSON / CSS / SVG / Lua previews
- The current canvas can be exported as:
  - `GIA`
  - `CSS`
  - `SVG`
  - `JSON`
  - `Lua` (re-importable scene data)
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
- Current transform editing is single-element only
- Undo / redo is session-level and not persisted
