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
    "topbar.tour": "上手",
    "topbar.tourTitle": "快速上手",
    "topbar.github": "GitHub 仓库",
    "topbar.docs": "千星知识库",
    "topbar.lang": "中/EN",

    // Prefab lookup
    "prefab.title": "元件信息查询",
    "prefab.add": "添加到画布",
    "prefab.libraryHint": "输入元件 ID 查询缩略图，点击或拖动结果添加到画布。仅支持 Lua 绘制。",
    "prefab.luaOnly": "元件图片仅支持 Lua 绘制；JSON 可保存场景。含元件的场景不能导出 GIA、CSS、SVG 或 PNG。",
    "prefab.variable": "Lua 元件 ID 配置名称",
    "prefab.variableHint": "导出 Lua 会自动在脚本内定义元件 ID 配置表，无需创建客户端脚本参数。",
    "prefab.history.title": "已添加的元件",
    "prefab.history.empty": "添加到画布过的元件会记录在这里，刷新后仍可复用。",
    "prefab.history.clear": "清空记录",
    "prefab.history.reuse": (name: string) => `再次添加 ${name}`,
    "prefab.history.remove": (name: string) => `从记录中移除 ${name}`,
    "library.basicShape": "基础形状",
    "shape.prefab": "元件",
    "prefab.hint": "输入元件 ID，查看对应缩略图、名称和分类。",
    "prefab.id": "元件 ID",
    "prefab.search": "查询",
    "prefab.loading": "查询中…",
    "prefab.type": "类型",
    "prefab.type.Gadget": "物件",
    "prefab.type.Monster": "造物",
    "prefab.type.Level": "关卡",
    "prefab.category": "分类",
    "prefab.categoryId": "分类 ID",
    "prefab.uncategorized": "未分类",
    "prefab.imageSize": "缩略图尺寸",
    "prefab.pixelHint": "尺寸为 PNG 像素，不表示三维模型大小。",
    "prefab.noImage": "暂无缩略图",
    "prefab.imageFailed": "缩略图加载失败",
    "prefab.openImage": "打开原图 ↗",
    "prefab.relatedIds": "关联 ID",
    "prefab.listId": "目录 ID",
    "prefab.empty": "输入元件 ID 后显示单个查询结果",
    "prefab.stale": "当前显示上次缓存的信息，暂时无法更新。",
    "prefab.error.invalid-id": "请输入有效的正整数元件 ID。",
    "prefab.error.not-found": "未找到该元件 ID，请检查输入或点击刷新。",
    "prefab.error.unavailable": "元件索引暂不可用，请稍后重试。",

    // 左侧面板 tabs
    "tab.layers": "图层",
    "tab.library": "图形库",
    "tab.import": "导入",

    // 图层空状态
    "layers.empty.title": "还没有图元",
    "layers.empty.desc": "从图形库拖入基础形状，或导入 SVG / CSS / JSON / Lua 模板",
    "layers.empty.browse": "浏览图形库",
    "layers.empty.import": "导入模板",

    // 图形库面板
    "library.category": "图形分类",
    "library.dragHint": "拖入画布或双击添加",
    "library.unsupported": "当前分类暂不支持，已预留接口，后续可直接接入。",
    "library.saved": "已保存图元",
    "library.savedCount": (n: number) => `${n} 个`,
    "library.savedEmpty": "「保存并应用」后，画布图元会出现在这里，可重复拖入复用。",
    "library.searchPlaceholder": "搜索 ID、描述或用途，如头像框",
    "library.allAssets": "全部素材",
    "library.use": "用途",
    "library.allUses": "全部用途",
    "library.refresh": "刷新",
    "library.matchCount": (n: number) => `${n} 张素材`,
    "library.toneAll": "全部",
    "library.toneMono": "单色",
    "library.toneColor": "彩色",
    "library.toneOther": "其他",
    "library.toneFlat": "该分类没有单色 / 彩色之分",
    "library.toneMonoHint": "单色素材可跟随图层颜色染色",
    "library.loading": "素材索引加载中…",
    "library.loadFailed": "素材索引加载失败，请确认后端服务已启动。",
    "library.retry": "重试",
    "library.empty": "没有符合条件的素材",
    "library.selectHint": "点击素材查看 ID 与元数据",
    "library.metaLoading": "元数据加载中…",
    "library.metaMissing": "该素材没有元数据文件",
    "library.metaFailed": "元数据加载失败",
    "library.metaStretchable": "可九宫格拉伸",
    "library.metaFlat": "不可拉伸",

    // 导入面板
    "import.tip": "上传文件或粘贴内容。支持 SVG、CSS、JSON 和 Lua 场景。",
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
    "canvas.empty.desc": "拖入形状，或导入已有作品。",
    "canvas.empty.sizeTitle": "画布尺寸，也可稍后在右侧「属性 → 画布」中修改",
    "canvas.empty.size": "画布尺寸",
    "canvas.empty.widthAria": "画布宽度",
    "canvas.empty.heightAria": "画布高度",
    "canvas.empty.watchTour": "快速上手",
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
    "props.tintColor": "染色",
    "props.assetId": "素材 ID",
    "props.assetTintable": "素材可染色",
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
    "props.sceneScale": "整体缩放",
    "props.sceneScaleTitle": "按倍率同时缩放画布尺寸与全部图元（含文本字号），可通过撤销恢复",
    "props.sceneScaleApply": "应用",
    "props.viewBg": "画布背景（仅查看）",
    "props.viewBgHint": "只影响编辑器显示，导出恒为透明底；需要实底请添加满画布矩形图元。",
    "props.viewBgDark": "深灰（默认）",
    "props.viewBgLight": "浅灰",
    "props.viewBgBlack": "黑色",
    "props.viewBgWhite": "白色",
    "props.viewBgChecker": "棋盘格（透明指示）",
    "props.viewBgImage": "自定义图片…",
    "props.viewBgImageHint": "选择本地图片作为画布查看背景（仅显示，不导出）",
    "props.stats": "统计",
    "props.elementCount": "图元数量",
    "props.canvasSize": "画布尺寸",
    "props.canvasTip": "选中图元后，可编辑位置、颜色与层级。",
    "props.maskSettings": "遮罩配置",
    "props.maskEnabled": "启用遮罩",
    "props.maskEnabledTitle": "关闭后导出 GIA 不裁剪图元",
    "props.maskShape": "遮罩形状",
    "props.maskShapeRect": "矩形",
    "props.maskShapeCircle": "圆形",
    "props.maskOffsetX": "偏移 X",
    "props.maskOffsetY": "偏移 Y",
    "props.maskFollow": "尺寸与画布一致",
    "props.maskFollowTitle": "勾选时遮罩尺寸始终跟随画布，取消后可单独修改宽高",
    "props.maskPreview": "在画布上预览遮罩",
    "props.maskPreviewTitle": "勾选时在编辑器画布上叠加显示遮罩边界与裁剪范围",

    // 代码面板
    "code.refresh": "刷新",
    "code.refreshTitle": "以当前画布重新生成代码",
    "code.copy": (label: string) => `复制 ${label}`,
    "luaDialog.title": "Lua 绘制脚本",
    "luaDialog.open": "复制Lua绘制脚本",
    "luaDialog.openDesc": "在弹窗中查看并复制",
    "luaDialog.close": "关闭 Lua 脚本弹窗",
    "luaDialog.code": "Lua 脚本内容",
    "luaDialog.loading": "正在生成 Lua 脚本…",
    "luaDialog.hint": "可直接复制脚本。在游戏中运行前，请按脚本开头的说明配置控件模板索引。",

    // 颜色选择
    "color.pick": "点击选择颜色",

    // 状态栏
    "statusbar.elements": "图元",
    "statusbar.qq": "QQ 群 1007538100",
    "statusbar.welcome": "准备就绪，开始创作吧",
    "statusbar.undone": "已撤销上一步",
    "statusbar.redone": "已重做下一步",
    "statusbar.emptyLoaded": "已加载空画布",
    "statusbar.importing": "正在导入基础模板...",
    "statusbar.importFailed": (msg: string) => `导入失败: ${msg}`,
    "statusbar.imported": "基础模板已导入到画布",
    "statusbar.sceneScaled": (factor: number) => `已整体缩放 ${factor} 倍`,
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
    "statusbar.assetAdded": (name: string) => `已添加素材 ${name}`,

    // 形状标签
    "shape.ellipse": "圆形",
    "shape.rectangle": "矩形",
    "shape.triangle": "等腰三角形",
    "shape.four_point_star": "四角星",
    "shape.five_point_star": "五角星",
    "shape.ring": "圆环",
    "shape.textbox": "文本框",
    "shape.image": "素材图片",
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
    "export.lua.desc": "客户端绘制脚本 · 可再次导入",
    "export.lua.setup": "含图片时填写 IMAGE_PREFAB_ID，含文本框时填写 TEXTBOX_PREFAB_ID（对应控件模板索引），挂到专用空客户端容器节点。文本字号自适应按编辑器设置导出，默认开启。",
    "export.lua.preservedOnly": "Lua 支持图片与文本框。其他不支持的图元仅保留在回导数据中。",
    "import.luaHint": "支持图元拟合工具及本编辑器导出的 Lua。仅读取图元数据，不运行脚本。",

    // 快捷编辑
    "quick.edit": "快捷编辑",
    "quick.shrink": "缩小 10%",
    "quick.grow": "放大 10%",
    "quick.delete": "删除",

    // 示例场景
    "sample.sceneName": "示例场景",

    "tools.fitting": "图元拟合工具",
    "tools.fittingHint": "将图片拟合为图元，再导入编辑",
    "welcome.close": "关闭快速上手",
    "welcome.title": "从一个图元开始",
    "welcome.subtitle": "拼出你的画面，带进千星奇域。",
    "welcome.create": "添加素材",
    "welcome.createHint": "从左侧拖入形状，或导入已有作品。",
    "welcome.edit": "调整画面",
    "welcome.editHint": "拖动、缩放、旋转；右侧精调属性。",
    "welcome.export": "导出作品",
    "welcome.exportHint": "右上角选择格式，下载后即可使用。",
    "welcome.docs": "编辑器使用说明 ↗",
    "welcome.import": "导入作品",
    "welcome.start": "开始创作"
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
    "topbar.tour": "Help",
    "topbar.tourTitle": "Quick start",
    "topbar.github": "GitHub Repository",
    "topbar.docs": "Miliastra Knowledge Base",
    "topbar.lang": "中/EN",

    // Prefab lookup
    "prefab.title": "Prefab lookup",
    "prefab.add": "Add to canvas",
    "prefab.libraryHint": "Look up a Prefab ID, then click or drag the result onto the canvas. Lua drawing only.",
    "prefab.luaOnly": "Prefab images support Lua drawing only. JSON preserves the scene. Scenes containing Prefabs cannot export GIA, CSS, SVG or PNG.",
    "prefab.variable": "Lua Prefab ID configuration name",
    "prefab.variableHint": "The Lua export defines a Prefab ID table inside the script. No client script parameters are required.",
    "prefab.history.title": "Added Prefabs",
    "prefab.history.empty": "Prefabs added to the canvas appear here and remain available after refreshing.",
    "prefab.history.clear": "Clear history",
    "prefab.history.reuse": (name: string) => `Add ${name} again`,
    "prefab.history.remove": (name: string) => `Remove ${name} from history`,
    "library.basicShape": "Basic shapes",
    "shape.prefab": "Prefab",
    "prefab.hint": "Enter a Prefab ID to view its thumbnail, name and categories.",
    "prefab.id": "Prefab ID",
    "prefab.search": "Look up",
    "prefab.loading": "Loading…",
    "prefab.type": "Type",
    "prefab.type.Gadget": "Gadget",
    "prefab.type.Monster": "Creature",
    "prefab.type.Level": "Level",
    "prefab.category": "Categories",
    "prefab.categoryId": "Category IDs",
    "prefab.uncategorized": "Uncategorized",
    "prefab.imageSize": "Thumbnail size",
    "prefab.pixelHint": "Dimensions are PNG pixels, not the 3D model size.",
    "prefab.noImage": "No thumbnail available",
    "prefab.imageFailed": "Failed to load thumbnail",
    "prefab.openImage": "Open image ↗",
    "prefab.relatedIds": "Related IDs",
    "prefab.listId": "Catalog IDs",
    "prefab.empty": "Enter a Prefab ID to see its information",
    "prefab.stale": "Showing cached information; an update is temporarily unavailable.",
    "prefab.error.invalid-id": "Enter a valid positive integer Prefab ID.",
    "prefab.error.not-found": "Prefab ID not found. Check the ID or refresh the index.",
    "prefab.error.unavailable": "The Prefab index is temporarily unavailable. Please retry later.",

    // Left panel tabs
    "tab.layers": "Layers",
    "tab.library": "Library",
    "tab.import": "Import",

    // Layers empty state
    "layers.empty.title": "No elements yet",
    "layers.empty.desc": "Drag a basic shape from the library, or import an SVG / CSS / JSON / Lua template",
    "layers.empty.browse": "Browse Library",
    "layers.empty.import": "Import Template",

    // Library panel
    "library.category": "Category",
    "library.dragHint": "Drag to canvas or double-click to add",
    "library.unsupported": "This category is not yet supported. The interface is reserved for future expansion.",
    "library.saved": "Saved Elements",
    "library.savedCount": (n: number) => `${n} item${n === 1 ? "" : "s"}`,
    "library.savedEmpty": "After \"Save & Apply\", canvas elements will appear here and can be dragged back in for reuse.",
    "library.searchPlaceholder": "Search ID, description or use (e.g. avatar.frame)",
    "library.allAssets": "All assets",
    "library.use": "Use",
    "library.allUses": "All uses",
    "library.refresh": "Refresh",
    "library.matchCount": (n: number) => `${n} assets`,
    "library.toneAll": "All",
    "library.toneMono": "Mono",
    "library.toneColor": "Color",
    "library.toneOther": "Other",
    "library.toneFlat": "This category has no mono / color split",
    "library.toneMonoHint": "Mono assets can be tinted by the layer color",
    "library.loading": "Loading asset index…",
    "library.loadFailed": "Failed to load the asset index. Make sure the backend service is running.",
    "library.retry": "Retry",
    "library.empty": "No assets match the current filters",
    "library.selectHint": "Click an asset to inspect its ID and metadata",
    "library.metaLoading": "Loading metadata…",
    "library.metaMissing": "This asset has no metadata file",
    "library.metaFailed": "Failed to load metadata",
    "library.metaStretchable": "Nine-slice stretchable",
    "library.metaFlat": "Not stretchable",

    // Import panel
    "import.tip": "Upload a file or paste SVG, CSS, JSON or Lua scene data.",
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
    "canvas.empty.desc": "Drag in a shape or import your artwork.",
    "canvas.empty.sizeTitle": "Canvas size. Can also be changed later in \"Properties → Canvas\" on the right.",
    "canvas.empty.size": "Canvas size",
    "canvas.empty.widthAria": "Canvas width",
    "canvas.empty.heightAria": "Canvas height",
    "canvas.empty.watchTour": "Quick start",
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
    "props.tintColor": "Tint",
    "props.assetId": "Asset ID",
    "props.assetTintable": "Tintable asset",
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
    "props.sceneScale": "Scale scene",
    "props.sceneScaleTitle": "Scale the canvas and all elements (including font sizes) by a factor. Undoable.",
    "props.sceneScaleApply": "Apply",
    "props.viewBg": "Canvas background (view only)",
    "props.viewBgHint": "Affects the editor display only; exports are always transparent. Add a canvas-filling rectangle for a solid backdrop.",
    "props.viewBgDark": "Dark gray (default)",
    "props.viewBgLight": "Light gray",
    "props.viewBgBlack": "Black",
    "props.viewBgWhite": "White",
    "props.viewBgChecker": "Checkerboard (transparency)",
    "props.viewBgImage": "Custom image…",
    "props.viewBgImageHint": "Pick a local image as the view-only canvas backdrop (never exported)",
    "props.stats": "Stats",
    "props.elementCount": "Element count",
    "props.canvasSize": "Canvas size",
    "props.canvasTip": "Select an element to edit its position, color and layer.",
    "props.maskSettings": "Mask settings",
    "props.maskEnabled": "Enable mask",
    "props.maskEnabledTitle": "When off, exported GIA does not clip elements",
    "props.maskShape": "Mask shape",
    "props.maskShapeRect": "Rectangle",
    "props.maskShapeCircle": "Circle",
    "props.maskOffsetX": "Offset X",
    "props.maskOffsetY": "Offset Y",
    "props.maskFollow": "Match canvas size",
    "props.maskFollowTitle": "When checked the mask size always follows the canvas; uncheck to set width and height",
    "props.maskPreview": "Preview mask on canvas",
    "props.maskPreviewTitle": "Show mask boundary and clip range as an overlay on the editor canvas",

    // Code panel
    "code.refresh": "Refresh",
    "code.refreshTitle": "Regenerate code from the current canvas",
    "code.copy": (label: string) => `Copy ${label}`,
    "luaDialog.title": "Lua drawing script",
    "luaDialog.open": "Copy Lua drawing script",
    "luaDialog.openDesc": "View and copy in a dialog",
    "luaDialog.close": "Close Lua script dialog",
    "luaDialog.code": "Lua script content",
    "luaDialog.loading": "Generating Lua script…",
    "luaDialog.hint": "Copy the script directly. Before running it in-game, configure the control template index as described at the top of the script.",

    // Color picker
    "color.pick": "Click to pick a color",

    // Status bar
    "statusbar.elements": "Elements",
    "statusbar.qq": "QQ Group 1007538100",
    "statusbar.welcome": "Ready when you are.",
    "statusbar.undone": "Undone",
    "statusbar.redone": "Redone",
    "statusbar.emptyLoaded": "Empty canvas loaded",
    "statusbar.importing": "Importing template...",
    "statusbar.importFailed": (msg: string) => `Import failed: ${msg}`,
    "statusbar.imported": "Template imported to canvas",
    "statusbar.sceneScaled": (factor: number) => `Scene scaled by ${factor}×`,
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
    "statusbar.assetAdded": (name: string) => `Added asset ${name}`,

    // Shape labels
    "shape.ellipse": "Ellipse",
    "shape.rectangle": "Rectangle",
    "shape.triangle": "Isosceles Triangle",
    "shape.four_point_star": "Four-point Star",
    "shape.five_point_star": "Five-point Star",
    "shape.ring": "Ring",
    "shape.textbox": "Text Box",
    "shape.image": "Library Image",
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
    "export.lua.desc": "Client drawing script · re-importable",
    "export.lua.setup": "Set IMAGE_PREFAB_ID for images and TEXTBOX_PREFAB_ID for textboxes to their control template indices, then attach the script to a dedicated empty client container. Adaptive font sizing follows the editor setting and is enabled by default.",
    "export.lua.preservedOnly": "Lua draws images and textboxes. Other unsupported elements are kept only for re-import.",
    "import.luaHint": "Accepts Lua exported by the image fitting tool or this editor. Reads drawing data without running the script.",

    // Quick edit
    "quick.edit": "Quick Edit",
    "quick.shrink": "Shrink 10%",
    "quick.grow": "Grow 10%",
    "quick.delete": "Delete",

    // Sample scene
    "sample.sceneName": "Sample Scene",

    "tools.fitting": "Image to Shapes",
    "tools.fittingHint": "Fit an image to shapes, then import to edit",
    "welcome.close": "Close quick start",
    "welcome.title": "Start with a shape",
    "welcome.subtitle": "Build your artwork. Bring it into Miliastra.",
    "welcome.create": "Add something",
    "welcome.createHint": "Drag a shape from the library or import your work.",
    "welcome.edit": "Make it yours",
    "welcome.editHint": "Move, resize and rotate. Fine-tune on the right.",
    "welcome.export": "Take it with you",
    "welcome.exportHint": "Choose a format in Export and download your work.",
    "welcome.docs": "Editor guide ↗",
    "welcome.import": "Import work",
    "welcome.start": "Start creating"
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
