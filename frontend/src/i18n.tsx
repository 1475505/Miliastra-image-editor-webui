import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Lang = "zh" | "en";

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

type TranslationValue = string | ((...args: any[]) => string);
type TranslationDict = Record<string, TranslationValue>;

type I18nValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  t: TranslateFn;
};

const LANG_STORAGE_KEY = "miliastra-editor-lang";

const FALLBACK_LANG: Lang = "zh";

export const DEFAULT_LANG: Lang = (() => {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored === "zh" || stored === "en") {
      return stored;
    }
  }
  if (typeof navigator !== "undefined") {
    const nav = navigator.language?.toLowerCase() ?? "";
    if (nav.startsWith("en")) {
      return "en";
    }
  }
  return FALLBACK_LANG;
})();

export const translations: Record<Lang, TranslationDict> = {
  zh: {
    // 品牌
    "brand.name": "千星图片编辑器",
    "brand.title": "千星图片编辑器",

    // 顶部工具栏
    "topbar.undo": "撤销",
    "topbar.undoShort": "撤销 (Ctrl/⌘+Z)",
    "topbar.redo": "重做",
    "topbar.redoShort": "重做 (Ctrl/⌘+Shift+Z)",
    "topbar.docName": "素材组名称，将作为导出文件名",
    "topbar.save": "保存并应用",
    "topbar.saveShort": (m: string) => `保存并应用 (${m}S)`,
    "topbar.export": "导出",
    "topbar.tour": "教程",
    "topbar.tourTitle": "打开新手教程",
    "topbar.github": "GitHub 仓库",
    "topbar.docs": "知识库文档",
    "topbar.lang": "中/EN",

    // 左侧面板 tabs
    "tab.layers": "图层",
    "tab.library": "图形库",
    "tab.import": "导入",

    // 图层空状态
    "layers.empty.title": "还没有图元",
    "layers.empty.desc": "从图形库拖入基础形状，或导入 SVG / CSS / JSON 模板",
    "layers.empty.browse": "浏览图形库",
    "layers.empty.import": "导入模板",

    // 图形库面板
    "library.category": "图形分类",
    "library.dragHint": "拖入画布或双击添加",
    "library.unsupported": "当前分类暂不支持，已预留接口，后续可直接接入。",
    "library.saved": "已保存图元",
    "library.savedCount": (n: number) => `${n} 个`,
    "library.savedEmpty": "「保存并应用」后，画布图元会出现在这里，可重复拖入复用。",

    // 导入面板
    "import.tip": "支持粘贴或上传 svg / css / json 模板；内容留空时导入将得到 300 × 300 空画布。",
    "import.format": "模板格式",
    "import.upload": "点击上传文件",
    "import.paste": "或粘贴内容",
    "import.pastePlaceholder": "留空时点击「导入到画布」会得到空画布",
    "import.sample": "载入示例场景",
    "import.submit": "导入到画布",

    // 画布工具条
    "canvas.zoomOut": "缩小",
    "canvas.zoomReset": "当前缩放，点击重置为 100%",
    "canvas.zoomIn": "放大",
    "canvas.fit": "适应窗口：缩放画布以完整显示",
    "canvas.snapTitle": "智能吸附：拖动图元时自动对齐其他图元的边缘与中心",
    "canvas.snap": "吸附",
    "canvas.gridTitle": "网格吸附：拖动时坐标按此像素值取整，0 = 关闭",
    "canvas.grid": "网格",
    "canvas.angleTitle": "角度步进：旋转手柄时按此角度吸附，0 = 关闭；按住 Ctrl/⌘ 可临时关闭",
    "canvas.angle": "角度",

    // 画布空状态
    "canvas.empty.title": "画布还是空的",
    "canvas.empty.desc": "先确认画布尺寸，再从图形库拖入形状，或导入 SVG / CSS / JSON 模板",
    "canvas.empty.sizeTitle": "画布尺寸，也可稍后在右侧「属性 → 画布」中修改",
    "canvas.empty.size": "画布尺寸",
    "canvas.empty.widthAria": "画布宽度",
    "canvas.empty.heightAria": "画布高度",
    "canvas.empty.watchTour": "观看教程",
    "canvas.empty.sample": "或先试试示例场景 →",
    "canvas.metaTitle": "画布尺寸，点击编辑画布属性",

    // 右侧面板 tabs
    "tab.props": "属性",
    "tab.code": "代码",

    // 属性面板
    "props.element": "图元",
    "props.canvas": "画布",
    "props.elementTitle": "查看选中图元的属性",
    "props.elementEmpty": "先在画布或图层列表中选中一个图元",
    "props.canvasTitle": "画布尺寸、背景色等设置",
    "props.layer": (n: number) => `第 ${n} 层`,
    "props.transform": "变换",
    "props.width": "宽",
    "props.height": "高",
    "props.widthW": "宽 W",
    "props.heightH": "高 H",
    "props.rotation": "旋转角度",
    "props.rotationReset": "复位角度",
    "props.appearance": "外观",
    "props.fillColor": "填充颜色",
    "props.opacity": "不透明度",
    "props.visibility": "可见性",
    "props.initialVisible": "初始可见性",
    "props.textbox": "文本框设置",
    "props.fontSize": "字号",
    "props.minFontSize": "最小字号",
    "props.autoSize": "字号自适应",
    "props.textColor": "文本颜色",
    "props.textboxBg": "背景颜色",
    "props.outlineEnabled": "启用文字描边",
    "props.outlineColor": "描边颜色",
    "props.alignH": "水平对齐",
    "props.alignV": "垂直对齐",
    "props.align.left": "左",
    "props.align.center": "中",
    "props.align.right": "右",
    "props.align.top": "上",
    "props.align.middle": "中",
    "props.align.bottom": "下",
    "props.scaleX": "缩放 X",
    "props.scaleY": "缩放 Y",
    "props.anchor": "锚点",
    "props.anchorType": "锚点类型",
    "props.anchorCenter": "中心",
    "props.anchorCustom": "自定义",
    "props.anchorPivot": "中心",
    "props.textContent": "文本内容",
    "props.richHint": "支持 <color=red></color>、<i></i>、<size=20></size>",
    "props.layerSection": "层级",
    "props.layerNumberTitle": "层级序号",
    "props.layerTop": "置顶",
    "props.layerUp": "上移一层",
    "props.layerDown": "下移一层",
    "props.layerBottom": "置底",
    "props.bgTitle": "勾选后导出 GIA 时该图元强制置于最底层",
    "props.bgLabel": "背景图元",
    "props.bgHint": "导出 GIA 时强制置底",
    "props.delete": "删除图元",
    "props.canvasSettings": "画布设置",
    "props.lockAspect": "等比缩放",
    "props.lockAspectTitle": "修改宽度或高度时保持比例",
    "props.bgColor": "背景色",
    "props.stats": "统计",
    "props.elementCount": "图元数量",
    "props.canvasSize": "画布尺寸",
    "props.canvasTip": "这里设置画布的尺寸与背景色；选中图元后切换到上方「图元」页可编辑其坐标、颜色与层级。吸附开关在画布顶部工具条上。",

    // 代码面板
    "code.refresh": "刷新",
    "code.refreshTitle": "以当前画布重新生成代码",
    "code.copy": (label: string) => `复制 ${label}`,

    // 颜色选择
    "color.pick": "点击选择颜色",

    // 状态栏
    "statusbar.elements": "图元",
    "statusbar.qq": "QQ 群 1007538100",
    "statusbar.welcome": "欢迎使用，点击顶部「教程」可快速上手",
    "statusbar.undone": "已撤销上一步",
    "statusbar.redone": "已重做下一步",
    "statusbar.emptyLoaded": "已加载空画布",
    "statusbar.importing": "正在导入基础模板...",
    "statusbar.importFailed": (msg: string) => `导入失败: ${msg}`,
    "statusbar.imported": "基础模板已导入到画布",
    "statusbar.saved": "已保存并应用，当前画布图元已同步到代码预览与已保存图元库",
    "statusbar.aiCleared": "AI 代理已清空画布",
    "statusbar.aiImported": "AI 代理已导入模板到画布",
    "statusbar.fileRead": (name: string) => `已读取文件 ${name}`,
    "statusbar.sampleLoaded": "已载入示例场景，可拖拽编辑，或点击顶部「导出」查看效果",
    "statusbar.copied": (label: string) => `已复制 ${label} 到剪贴板`,
    "statusbar.copyFailed": "复制失败，请手动选择文本复制",
    "statusbar.otherShape": "“其他图形”尚未开放",
    "statusbar.shapeAdded": (name: string) => `已将 ${name} 放入画布`,
    "statusbar.elementDeleted": "已删除当前图元",
    "statusbar.preparing": (name: string) => `正在准备 ${name}...`,
    "statusbar.exportFailed": (msg: string) => `导出失败: ${msg}`,
    "statusbar.ringSvgAlert": "圆环不支持导出为 SVG，已自动从导出文件中删除。如需圆环，请改用 CSS 或 JSON 导出。",
    "statusbar.downloaded": (name: string) => `已下载 ${name}`,
    "statusbar.downloadedWithRingWarning": (name: string) => `已下载 ${name}（注意：圆环未包含在内）`,
    "statusbar.dropFailed": "拖入图形失败",

    // 形状标签
    "shape.ellipse": "圆形",
    "shape.rectangle": "矩形",
    "shape.triangle": "等腰三角形",
    "shape.four_point_star": "四角星",
    "shape.five_point_star": "五角星",
    "shape.ring": "圆环",
    "shape.textbox": "文本框",
    "shape.other": "其他图形",

    // 图形库分类
    "category.function-icon-mono": "功能图标-单色",
    "category.function-icon-color": "功能图标-彩色",
    "category.gameplay-icon-mono": "玩法图标-单色",
    "category.gameplay-icon-color": "玩法图标-彩色",
    "category.ornament-mono": "装饰图案-单色",
    "category.ornament-color": "装饰图案-彩色",
    "category.floor-mono": "地板-单色",
    "category.floor-color": "地板-彩色",
    "category.basic-shape": "基础形状",
    "category.divider": "分割线",
    "category.skill-talent": "技能天赋",
    "category.special-character": "特殊字符",
    "category.item": "道具",
    "category.creation": "造物",

    // 导出格式描述
    "export.gia.desc": "游戏素材格式",
    "export.css.desc": "Web 样式代码",
    "export.svg.desc": "矢量图形",
    "export.json.desc": "场景源数据",

    // 快捷编辑
    "quick.edit": "快捷编辑",
    "quick.shrink": "缩小 10%",
    "quick.grow": "放大 10%",

    // 示例场景
    "sample.sceneName": "示例场景",

    // 教程步骤
    "tour.close": "关闭教程",
    "tour.prev": "上一步",
    "tour.next": "下一步",
    "tour.start": "开始使用",
    "tour.step1.title": "欢迎使用千星图片编辑器",
    "tour.step1.body": "这是一款面向游戏图片素材的可视化编辑器：导入模板或拖入基础形状，在画布上直接编排，最后一键导出 GIA / CSS / SVG / JSON。接下来用 30 秒了解界面布局。",
    "tour.step2.title": "左侧面板：素材从这里来",
    "tour.step2.body": "图形库：把基础形状拖入画布（或双击添加）；导入：粘贴或上传 SVG / CSS / JSON 模板；图层：查看并点选画布上的全部图元。",
    "tour.step3.title": "画布：所见即所得",
    "tour.step3.body": "拖动图元即可移动；选中后用右下角手柄缩放、顶部手柄旋转；右键打开快捷编辑。顶部悬浮条从左到右依次是：缩放、适应窗口、吸附开关（自动对齐其他图元）、网格（坐标按像素取整）、角度（旋转步进）。拖动空白处平移视图。",
    "tour.step4.title": "右侧：属性检查器与代码",
    "tour.step4.body": "「属性」页顶部可在图元 / 画布之间切换：画布页设置尺寸与背景色（也可以直接点画布右下角的尺寸徽标）；选中图元后自动切到图元页，精确调整坐标、颜色、透明度与层级。代码页可查看并一键复制 JSON / CSS / SVG。",
    "tour.step5.title": "保存与导出",
    "tour.step5.body": "Ctrl/⌘ + S 随时保存并应用；点击导出可下载 GIA、CSS、SVG、JSON，文件名使用顶栏中央的素材组名称。撤销 / 重做按钮在顶栏左侧。",
    "tour.step6.title": "常用快捷键",
    "tour.step6.saveApply": "保存并应用",
    "tour.step6.undo": "撤销",
    "tour.step6.redo": "重做",
    "tour.step6.deleteSelected": "删除选中图元",
    "tour.step6.axisLock": "轴锁定移动",
    "tour.step6.duplicate": "复制图元",
    "tour.step6.disableAngleSnap": "临时关闭角度吸附",
    "tour.step6.github": "GitHub 仓库",
    "tour.step6.docs": "知识库文档",
    "tour.step6.bilibili": "作者 B 站"
  },
  en: {
    // Brand
    "brand.name": "Miliastra Image Editor",
    "brand.title": "Miliastra Image Editor",

    // Top bar
    "topbar.undo": "Undo",
    "topbar.undoShort": "Undo (Ctrl/⌘+Z)",
    "topbar.redo": "Redo",
    "topbar.redoShort": "Redo (Ctrl/⌘+Shift+Z)",
    "topbar.docName": "Asset group name, used as export filename",
    "topbar.save": "Save & Apply",
    "topbar.saveShort": (m: string) => `Save & Apply (${m}S)`,
    "topbar.export": "Export",
    "topbar.tour": "Tour",
    "topbar.tourTitle": "Open beginner tour",
    "topbar.github": "GitHub Repository",
    "topbar.docs": "Knowledge Base",
    "topbar.lang": "中/EN",

    // Left panel tabs
    "tab.layers": "Layers",
    "tab.library": "Library",
    "tab.import": "Import",

    // Layers empty state
    "layers.empty.title": "No elements yet",
    "layers.empty.desc": "Drag a basic shape from the library, or import an SVG / CSS / JSON template",
    "layers.empty.browse": "Browse Library",
    "layers.empty.import": "Import Template",

    // Library panel
    "library.category": "Category",
    "library.dragHint": "Drag to canvas or double-click to add",
    "library.unsupported": "This category is not yet supported. The interface is reserved for future expansion.",
    "library.saved": "Saved Elements",
    "library.savedCount": (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    "library.savedEmpty": "After \"Save & Apply\", canvas elements will appear here and can be dragged back in for reuse.",

    // Import panel
    "import.tip": "Paste or upload an svg / css / json template. Leaving content empty will produce a 300 × 300 empty canvas.",
    "import.format": "Template format",
    "import.upload": "Click to upload a file",
    "import.paste": "Or paste content",
    "import.pastePlaceholder": "Leaving empty and clicking \"Import to Canvas\" yields an empty canvas",
    "import.sample": "Load sample scene",
    "import.submit": "Import to Canvas",

    // Canvas toolbar
    "canvas.zoomOut": "Zoom out",
    "canvas.zoomReset": "Current zoom. Click to reset to 100%.",
    "canvas.zoomIn": "Zoom in",
    "canvas.fit": "Fit to window: scale the canvas to fit",
    "canvas.snapTitle": "Smart snap: align to edges and centers of other elements while dragging",
    "canvas.snap": "Snap",
    "canvas.gridTitle": "Grid snap: snap coordinates to this pixel value while dragging. 0 = off",
    "canvas.grid": "Grid",
    "canvas.angleTitle": "Angle step: snap the rotation handle to this angle. 0 = off. Hold Ctrl/⌘ to temporarily disable.",
    "canvas.angle": "Angle",

    // Canvas empty state
    "canvas.empty.title": "Canvas is empty",
    "canvas.empty.desc": "Set the canvas size first, then drag a shape from the library, or import an SVG / CSS / JSON template",
    "canvas.empty.sizeTitle": "Canvas size. Can also be changed later in \"Properties → Canvas\" on the right.",
    "canvas.empty.size": "Canvas size",
    "canvas.empty.widthAria": "Canvas width",
    "canvas.empty.heightAria": "Canvas height",
    "canvas.empty.watchTour": "Watch tour",
    "canvas.empty.sample": "Or try the sample scene →",
    "canvas.metaTitle": "Canvas size. Click to edit canvas properties.",

    // Right panel tabs
    "tab.props": "Properties",
    "tab.code": "Code",

    // Properties panel
    "props.element": "Element",
    "props.canvas": "Canvas",
    "props.elementTitle": "View properties of the selected element",
    "props.elementEmpty": "Select an element on the canvas or in the layer list first",
    "props.canvasTitle": "Canvas size, background color, etc.",
    "props.layer": (n: number) => `Layer ${n}`,
    "props.transform": "Transform",
    "props.width": "W",
    "props.height": "H",
    "props.widthW": "Width W",
    "props.heightH": "Height H",
    "props.rotation": "Rotation",
    "props.rotationReset": "Reset angle",
    "props.appearance": "Appearance",
    "props.fillColor": "Fill color",
    "props.opacity": "Opacity",
    "props.visibility": "Visibility",
    "props.initialVisible": "Initially visible",
    "props.textbox": "Text box",
    "props.fontSize": "Font size",
    "props.minFontSize": "Min font size",
    "props.autoSize": "Auto font size",
    "props.textColor": "Text color",
    "props.textboxBg": "Background color",
    "props.outlineEnabled": "Enable outline",
    "props.outlineColor": "Outline color",
    "props.alignH": "Horizontal align",
    "props.alignV": "Vertical align",
    "props.align.left": "Left",
    "props.align.center": "Center",
    "props.align.right": "Right",
    "props.align.top": "Top",
    "props.align.middle": "Middle",
    "props.align.bottom": "Bottom",
    "props.scaleX": "Scale X",
    "props.scaleY": "Scale Y",
    "props.anchor": "Anchor",
    "props.anchorType": "Anchor type",
    "props.anchorCenter": "Center",
    "props.anchorCustom": "Custom",
    "props.anchorPivot": "Pivot",
    "props.textContent": "Text",
    "props.richHint": "Supports <color=red></color>, <i></i>, <size=20></size>",
    "props.layerSection": "Layer",
    "props.layerNumberTitle": "Layer index",
    "props.layerTop": "Bring to front",
    "props.layerUp": "Move up one layer",
    "props.layerDown": "Move down one layer",
    "props.layerBottom": "Send to back",
    "props.bgTitle": "When checked, this element is forced to the bottom layer on GIA export",
    "props.bgLabel": "Background element",
    "props.bgHint": "Forced to bottom on GIA export",
    "props.delete": "Delete element",
    "props.canvasSettings": "Canvas settings",
    "props.lockAspect": "Lock aspect ratio",
    "props.lockAspectTitle": "Preserve aspect ratio when changing width or height",
    "props.bgColor": "Background color",
    "props.stats": "Stats",
    "props.elementCount": "Element count",
    "props.canvasSize": "Canvas size",
    "props.canvasTip": "Set the canvas size and background color here. After selecting an element, switch to the \"Element\" tab above to edit its coordinates, color, and layer. The snap toggle lives in the toolbar above the canvas.",

    // Code panel
    "code.refresh": "Refresh",
    "code.refreshTitle": "Regenerate code from the current canvas",
    "code.copy": (label: string) => `Copy ${label}`,

    // Color picker
    "color.pick": "Click to pick a color",

    // Status bar
    "statusbar.elements": "Elements",
    "statusbar.qq": "QQ Group 1007538100",
    "statusbar.welcome": "Welcome! Click \"Tour\" in the top bar to get started.",
    "statusbar.undone": "Undone",
    "statusbar.redone": "Redone",
    "statusbar.emptyLoaded": "Empty canvas loaded",
    "statusbar.importing": "Importing template...",
    "statusbar.importFailed": (msg: string) => `Import failed: ${msg}`,
    "statusbar.imported": "Template imported to canvas",
    "statusbar.saved": "Saved & applied. Canvas elements are now synced to the code preview and saved library.",
    "statusbar.aiCleared": "AI agent cleared the canvas",
    "statusbar.aiImported": "AI agent imported a template to the canvas",
    "statusbar.fileRead": (name: string) => `File ${name} read`,
    "statusbar.sampleLoaded": "Sample scene loaded. Drag to edit, or click \"Export\" at the top to see the result.",
    "statusbar.copied": (label: string) => `Copied ${label} to clipboard`,
    "statusbar.copyFailed": "Copy failed. Please select the text manually and copy.",
    "statusbar.otherShape": "\"Other shape\" is not yet available",
    "statusbar.shapeAdded": (name: string) => `Added ${name} to canvas`,
    "statusbar.elementDeleted": "Element deleted",
    "statusbar.preparing": (name: string) => `Preparing ${name}...`,
    "statusbar.exportFailed": (msg: string) => `Export failed: ${msg}`,
    "statusbar.ringSvgAlert": "Rings cannot be exported to SVG and have been removed automatically. Use CSS or JSON export to keep rings.",
    "statusbar.downloaded": (name: string) => `Downloaded ${name}`,
    "statusbar.downloadedWithRingWarning": (name: string) => `Downloaded ${name} (note: rings are not included)`,
    "statusbar.dropFailed": "Failed to drop shape",

    // Shape labels
    "shape.ellipse": "Ellipse",
    "shape.rectangle": "Rectangle",
    "shape.triangle": "Isosceles Triangle",
    "shape.four_point_star": "Four-point Star",
    "shape.five_point_star": "Five-point Star",
    "shape.ring": "Ring",
    "shape.textbox": "Text Box",
    "shape.other": "Other Shape",

    // Library categories
    "category.function-icon-mono": "Function Icon (Mono)",
    "category.function-icon-color": "Function Icon (Color)",
    "category.gameplay-icon-mono": "Gameplay Icon (Mono)",
    "category.gameplay-icon-color": "Gameplay Icon (Color)",
    "category.ornament-mono": "Ornament (Mono)",
    "category.ornament-color": "Ornament (Color)",
    "category.floor-mono": "Floor (Mono)",
    "category.floor-color": "Floor (Color)",
    "category.basic-shape": "Basic Shape",
    "category.divider": "Divider",
    "category.skill-talent": "Skill / Talent",
    "category.special-character": "Special Character",
    "category.item": "Item",
    "category.creation": "Creation",

    // Export format descriptions
    "export.gia.desc": "Game asset format",
    "export.css.desc": "Web style code",
    "export.svg.desc": "Vector graphics",
    "export.json.desc": "Scene source data",

    // Quick edit
    "quick.edit": "Quick Edit",
    "quick.shrink": "Shrink 10%",
    "quick.grow": "Grow 10%",

    // Sample scene
    "sample.sceneName": "Sample Scene",

    // Tour steps
    "tour.close": "Close tour",
    "tour.prev": "Previous",
    "tour.next": "Next",
    "tour.start": "Get started",
    "tour.step1.title": "Welcome to Miliastra Image Editor",
    "tour.step1.body": "This is a visual editor for game image assets: import a template or drag in basic shapes, arrange them directly on the canvas, and export GIA / CSS / SVG / JSON in one click. Take 30 seconds to learn the layout.",
    "tour.step2.title": "Left panel: where assets come from",
    "tour.step2.body": "Library: drag basic shapes onto the canvas (or double-click to add). Import: paste or upload SVG / CSS / JSON templates. Layers: view and pick any element on the canvas.",
    "tour.step3.title": "Canvas: what you see is what you get",
    "tour.step3.body": "Drag an element to move it. When selected, use the bottom-right handle to scale and the top handle to rotate. Right-click for quick edit. The floating toolbar at the top, from left to right: zoom, fit to window, snap toggle (auto-align to other elements), grid (snap coordinates to pixels), angle (rotation step). Drag empty space to pan.",
    "tour.step4.title": "Right side: property inspector and code",
    "tour.step4.body": "The top of the \"Properties\" tab lets you switch between Element and Canvas. The Canvas tab sets size and background color (you can also click the size badge at the bottom-right of the canvas). After selecting an element, it auto-switches to the Element tab for precise control of coordinates, color, opacity, and layer. The Code tab lets you view and copy JSON / CSS / SVG.",
    "tour.step5.title": "Save and export",
    "tour.step5.body": "Ctrl/⌘ + S saves and applies at any time. Click Export to download GIA, CSS, SVG, or JSON. The filename uses the asset group name in the center of the top bar. Undo / redo buttons are on the left of the top bar.",
    "tour.step6.title": "Common shortcuts",
    "tour.step6.saveApply": "Save & Apply",
    "tour.step6.undo": "Undo",
    "tour.step6.redo": "Redo",
    "tour.step6.deleteSelected": "Delete selected element",
    "tour.step6.axisLock": "Axis-locked move",
    "tour.step6.duplicate": "Duplicate element",
    "tour.step6.disableAngleSnap": "Temporarily disable angle snap",
    "tour.step6.github": "GitHub Repository",
    "tour.step6.docs": "Knowledge Base",
    "tour.step6.bilibili": "Author on Bilibili"
  }
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    }
  }, [lang]);

  const value = useMemo<I18nValue>(() => {
    const dict = translations[lang] ?? translations[FALLBACK_LANG];
    const fallback = translations[FALLBACK_LANG];
    const t: TranslateFn = (key, vars) => {
      const raw = dict[key] ?? fallback[key] ?? key;
      if (typeof raw === "function") {
        return vars ? raw(...Object.values(vars)) : raw();
      }
      return raw;
    };
    return {
      lang,
      setLang: setLangState,
      toggleLang: () => setLangState((current) => (current === "zh" ? "en" : "zh")),
      t
    };
  }, [lang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return ctx;
}

export function shapeLabelKey(type: string): string {
  return `shape.${type}`;
}

export function categoryLabelKey(key: string): string {
  return `category.${key}`;
}
