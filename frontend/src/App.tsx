import { useEffect, useMemo, useRef, useState } from "react";

type ShapeType =
  | "ellipse"
  | "rectangle"
  | "triangle"
  | "four_point_star"
  | "five_point_star"
  | "ring"
  | "other";

type SourceType = "json" | "css" | "svg";
type LeftTab = "layers" | "library" | "import";
type RightTab = "props" | "code";
type PreviewTab = "json" | "css" | "svg";

type SceneElement = {
  id: string;
  name: string;
  type: ShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  color: string;
  opacity: number;
  zIndex: number;
  isBackground: boolean;
};

type LibraryCategory = {
  key: string;
  label: string;
  supported: boolean;
};

type SavedLibraryItem = {
  id: string;
  name: string;
  category: string;
  element: SceneElement;
};

type LibraryBaseShapePreset = {
  type: ShapeType;
  color: string;
  width: number;
  height: number;
};

type SceneLibrary = {
  activeCategory: string;
  categories: LibraryCategory[];
  baseShapePresets: LibraryBaseShapePreset[];
  savedItems: SavedLibraryItem[];
};

type SceneDocument = {
  canvas: {
    width: number;
    height: number;
    background: string;
  };
  elements: SceneElement[];
  meta: {
    sourceType: "json" | "css" | "svg" | "editor";
    sourceName: string;
    warnings: string[];
  };
  library: SceneLibrary;
};

type QuickEditState = {
  x: number;
  y: number;
  targetId: string;
} | null;

type InteractionState =
  | {
      kind: "pan";
      startX: number;
      startY: number;
      scrollLeft: number;
      scrollTop: number;
    }
  | {
      kind: "shape";
      id: string;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "resize";
      id: string;
      centerX: number;
      centerY: number;
      rotation: number;
    }
  | {
      kind: "rotate";
      id: string;
      centerX: number;
      centerY: number;
      baseRotation: number;
      startAngle: number;
    }
  | null;

type SnapConfig = {
  enabled: boolean;
  gridSize: number;
  snapToElements: boolean;
  angleStep: number;
};

type GuideLine = {
  orientation: "vertical" | "horizontal";
  position: number;
};

const DEFAULT_SNAP_CONFIG: SnapConfig = {
  enabled: true,
  gridSize: 0,
  snapToElements: true,
  angleStep: 0
};

const TOUR_SEEN_KEY = "miliastra-editor-tour-seen";

const libraryCategories: LibraryCategory[] = [
  { key: "function-icon-mono", label: "功能图标-单色", supported: false },
  { key: "function-icon-color", label: "功能图标-彩色", supported: false },
  { key: "gameplay-icon-mono", label: "玩法图标-单色", supported: false },
  { key: "gameplay-icon-color", label: "玩法图标-彩色", supported: false },
  { key: "ornament-mono", label: "装饰图案-单色", supported: false },
  { key: "ornament-color", label: "装饰图案-彩色", supported: false },
  { key: "floor-mono", label: "地板-单色", supported: false },
  { key: "floor-color", label: "地板-彩色", supported: false },
  { key: "basic-shape", label: "基础形状", supported: true },
  { key: "divider", label: "分割线", supported: false },
  { key: "skill-talent", label: "技能天赋", supported: false },
  { key: "special-character", label: "特殊字符", supported: false },
  { key: "item", label: "道具", supported: false },
  { key: "creation", label: "造物", supported: false }
];

const EMPTY_SCENE = (): SceneDocument => ({
  canvas: {
    width: 300,
    height: 300,
    background: "#ffffff"
  },
  elements: [],
  meta: {
    sourceType: "editor",
    sourceName: "",
    warnings: []
  },
  library: {
    activeCategory: "基础形状",
    categories: libraryCategories,
    baseShapePresets: defaultBaseShapePresets,
    savedItems: []
  }
});

const shapeLabels: Record<ShapeType, string> = {
  ellipse: "圆形",
  rectangle: "矩形",
  triangle: "等腰三角形",
  four_point_star: "四角星",
  five_point_star: "五角星",
  ring: "圆环",
  other: "其他图形"
};

const previewLabels: Record<PreviewTab, string> = {
  json: "JSON",
  css: "CSS",
  svg: "SVG"
};

const defaultBaseShapePresets: LibraryBaseShapePreset[] = [
  { type: "ellipse", color: "#0f766e", width: 88, height: 88 },
  { type: "rectangle", color: "#c2410c", width: 102, height: 70 },
  { type: "triangle", color: "#7c3aed", width: 96, height: 86 },
  { type: "four_point_star", color: "#0f4c81", width: 90, height: 90 },
  { type: "five_point_star", color: "#be123c", width: 92, height: 92 },
  { type: "ring", color: "#f59e0b", width: 92, height: 92 }
];

const EXPORT_FORMATS = [
  { endpoint: "/api/export/gia", ext: "gia", label: "GIA", desc: "游戏素材格式" },
  { endpoint: "/api/export/css", ext: "css", label: "CSS", desc: "Web 样式代码" },
  { endpoint: "/api/export/svg", ext: "svg", label: "SVG", desc: "矢量图形" },
  { endpoint: "/api/export/json", ext: "json", label: "JSON", desc: "场景源数据" }
] as const;

function App() {
  const [scene, setScene] = useState<SceneDocument>(EMPTY_SCENE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("library");
  const [rightTab, setRightTab] = useState<RightTab>("props");
  const [sourceType, setSourceType] = useState<SourceType>("css");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("json");
  const [generatedJson, setGeneratedJson] = useState(JSON.stringify(EMPTY_SCENE(), null, 2));
  const [generatedCss, setGeneratedCss] = useState("");
  const [generatedSvg, setGeneratedSvg] = useState("");
  const [svgExportWarning, setSvgExportWarning] = useState<string | null>(null);
  const [giaGroupName, setGiaGroupName] = useState(() => formatGiaGroupName(new Date()));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState("欢迎使用，点击顶部「教程」可快速上手");
  const [zoom, setZoom] = useState(1);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [quickEdit, setQuickEdit] = useState<QuickEditState>(null);
  const [snapConfig, setSnapConfig] = useState<SnapConfig>(DEFAULT_SNAP_CONFIG);
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [propsView, setPropsView] = useState<"element" | "canvas">("canvas");
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [tourStep, setTourStep] = useState<number | null>(() => {
    try {
      return localStorage.getItem(TOUR_SEEN_KEY) ? null : 0;
    } catch {
      return 0;
    }
  });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState>(null);
  const zoomRef = useRef(zoom);
  const sceneRef = useRef(scene);
  const selectedIdRef = useRef(selectedId);
  const snapConfigRef = useRef(snapConfig);
  const historyRef = useRef<SceneDocument[]>([cloneScene(EMPTY_SCENE())]);
  const historyIndexRef = useRef(0);
  const saveAndApplyRef = useRef<() => Promise<void>>(async () => {});

  const orderedElements = useMemo(
    () => [...scene.elements].sort((a, b) => a.zIndex - b.zIndex),
    [scene.elements]
  );

  const selectedElement = useMemo(
    () => orderedElements.find((element) => element.id === selectedId) ?? null,
    [orderedElements, selectedId]
  );

  const quickEditElement = useMemo(
    () => (quickEdit ? orderedElements.find((element) => element.id === quickEdit.targetId) ?? null : null),
    [orderedElements, quickEdit]
  );

  const activeCategory = scene.library.activeCategory || "基础形状";
  const categoryInfo = scene.library.categories.find((item) => item.label === activeCategory) ?? scene.library.categories[0];
  const baseShapePresets = scene.library.baseShapePresets ?? defaultBaseShapePresets;

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    snapConfigRef.current = snapConfig;
  }, [snapConfig]);

  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      setRightTab("props");
      setPropsView("element");
    } else {
      setPropsView("canvas");
    }
  }, [selectedId]);

  useEffect(() => {
    if (!exportOpen) {
      return;
    }
    const close = () => setExportOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [exportOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => fitCanvasToStage(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  function replaceScene(nextSceneOrUpdater: SceneDocument | ((current: SceneDocument) => SceneDocument)) {
    setScene((current) => {
      const rawNext = typeof nextSceneOrUpdater === "function" ? nextSceneOrUpdater(current) : nextSceneOrUpdater;
      const next = ensureSceneLibrary(rawNext);
      sceneRef.current = next;
      return next;
    });
  }

  function syncHistoryState() {
    setHistoryState({
      canUndo: historyIndexRef.current > 0,
      canRedo: historyIndexRef.current < historyRef.current.length - 1
    });
  }

  function commitHistory(nextScene: SceneDocument) {
    const snapshot = cloneScene(ensureSceneLibrary(nextScene));
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    const last = trimmed[trimmed.length - 1];
    if (JSON.stringify(last) === JSON.stringify(snapshot)) {
      historyRef.current = trimmed;
      historyIndexRef.current = trimmed.length - 1;
      syncHistoryState();
      return;
    }
    trimmed.push(snapshot);
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    syncHistoryState();
  }

  function commitScene(nextSceneOrUpdater: SceneDocument | ((current: SceneDocument) => SceneDocument)) {
    setScene((current) => {
      const rawNext = typeof nextSceneOrUpdater === "function" ? nextSceneOrUpdater(current) : nextSceneOrUpdater;
      const next = ensureSceneLibrary(rawNext);
      sceneRef.current = next;
      commitHistory(next);
      return next;
    });
  }

  function undoScene() {
    if (historyIndexRef.current <= 0) {
      return;
    }
    historyIndexRef.current -= 1;
    const snapshot = cloneScene(historyRef.current[historyIndexRef.current]);
    sceneRef.current = snapshot;
    setScene(snapshot);
    setSelectedId(null);
    setQuickEdit(null);
    setStatus("已撤销上一步");
    syncHistoryState();
  }

  function redoScene() {
    if (historyIndexRef.current >= historyRef.current.length - 1) {
      return;
    }
    historyIndexRef.current += 1;
    const snapshot = cloneScene(historyRef.current[historyIndexRef.current]);
    sceneRef.current = snapshot;
    setScene(snapshot);
    setSelectedId(null);
    setQuickEdit(null);
    setStatus("已重做下一步");
    syncHistoryState();
  }

  function canCaptureShortcut(target: EventTarget | null) {
    const element = target as HTMLElement | null;
    if (!element) {
      return true;
    }
    return !element.closest("input, textarea, select, [contenteditable='true']");
  }

  function getScenePointer(clientX: number, clientY: number) {
    if (!canvasRef.current) {
      return null;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const currentScene = sceneRef.current;
    const scaleX = currentScene.canvas.width / rect.width;
    const scaleY = currentScene.canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveAndApplyRef.current();
        return;
      }

      if (!canCaptureShortcut(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "delete" || key === "backspace") {
        const id = selectedIdRef.current;
        if (id) {
          event.preventDefault();
          removeElementById(id);
        }
        return;
      }

      if (!mod) {
        return;
      }

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoScene();
        } else {
          undoScene();
        }
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redoScene();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const action = interactionRef.current;
      if (!action) {
        return;
      }

      if (action.kind === "pan" && stageRef.current) {
        stageRef.current.scrollLeft = action.scrollLeft - (event.clientX - action.startX);
        stageRef.current.scrollTop = action.scrollTop - (event.clientY - action.startY);
        return;
      }

      if (action.kind === "shape") {
        const cfg = snapConfigRef.current;
        let rawX = action.originX + (event.clientX - action.startX) / zoomRef.current;
        let rawY = action.originY + (event.clientY - action.startY) / zoomRef.current;

        if (event.shiftKey) {
          const dx = Math.abs(rawX - action.originX);
          const dy = Math.abs(rawY - action.originY);
          if (dx >= dy) {
            rawY = action.originY;
          } else {
            rawX = action.originX;
          }
        }

        let finalX = clamp(rawX, 0, sceneRef.current.canvas.width);
        let finalY = clamp(rawY, 0, sceneRef.current.canvas.height);
        let guides: GuideLine[] = [];

        if (cfg.enabled) {
          if (cfg.gridSize > 0) {
            finalX = snapToGrid(finalX, cfg.gridSize);
            finalY = snapToGrid(finalY, cfg.gridSize);
          }

          if (cfg.snapToElements) {
            const movingEl = sceneRef.current.elements.find((el) => el.id === action.id);
            if (movingEl) {
              const others = sceneRef.current.elements.filter((el) => el.id !== action.id);
              const threshold = 6 / zoomRef.current;
              const snap = computeSnapGuides(
                { x: finalX, y: finalY, width: movingEl.width, height: movingEl.height },
                others,
                threshold
              );
              finalX = clamp(snap.x, 0, sceneRef.current.canvas.width);
              finalY = clamp(snap.y, 0, sceneRef.current.canvas.height);
              guides = snap.guides;
            }
          }
        }

        setGuideLines(guides);
        replaceScene((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === action.id
              ? { ...element, x: finalX, y: finalY }
              : element
          )
        }));
        return;
      }

      if (action.kind === "resize") {
        const pointer = getScenePointer(event.clientX, event.clientY);
        if (!pointer) {
          return;
        }
        const local = rotateVector(
          pointer.x - action.centerX,
          pointer.y - action.centerY,
          action.rotation
        );
        replaceScene((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === action.id
              ? {
                  ...element,
                  width: Math.max(8, Math.abs(local.x) * 2),
                  height: Math.max(8, Math.abs(local.y) * 2)
                }
              : element
          )
        }));
        return;
      }

      if (action.kind === "rotate") {
        const pointer = getScenePointer(event.clientX, event.clientY);
        if (!pointer) {
          return;
        }
        const angle = Math.atan2(pointer.y - action.centerY, pointer.x - action.centerX);
        let rotation = normalizeRotation(action.baseRotation - radiansToDegrees(angle - action.startAngle));
        const cfg = snapConfigRef.current;
        if (cfg.enabled && !event.ctrlKey && !event.metaKey) {
          rotation = normalizeRotation(snapAngle(rotation, cfg.angleStep));
        }
        replaceScene((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === action.id
              ? { ...element, rotation }
              : element
          )
        }));
      }
    };

    const handleMouseUp = () => {
      if (interactionRef.current && interactionRef.current.kind !== "pan") {
        commitHistory(sceneRef.current);
      }
      interactionRef.current = null;
      setGuideLines([]);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }
    const stage = stageRef.current;
    requestAnimationFrame(() => {
      stage.scrollLeft = Math.max(0, (stage.scrollWidth - stage.clientWidth) / 2);
      stage.scrollTop = Math.max(0, (stage.scrollHeight - stage.clientHeight) / 2);
    });
  }, [scene.canvas.width, scene.canvas.height, zoom]);

  async function handleImport() {
    if (!sourceContent.trim()) {
      const emptyScene = EMPTY_SCENE();
      commitScene(emptyScene);
      setSelectedId(null);
      setWarnings([]);
      setStatus("已加载空画布");
      await refreshPreviews(emptyScene);
      return;
    }

    setStatus("正在导入基础模板...");
    const response = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType,
        content: sourceContent,
        sourceName: sourceName || `pasted.${sourceType}`
      })
    });

    if (!response.ok) {
      setStatus(`导入失败: ${await response.text()}`);
      return;
    }

    const data = (await response.json()) as {
      scene: SceneDocument;
      warnings: string[];
    };

    commitScene(ensureSceneLibrary(data.scene));
    setSelectedId(data.scene.elements[0]?.id ?? null);
    setWarnings(data.warnings);
    setQuickEdit(null);
    setLeftTab("layers");
    setStatus("基础模板已导入到画布");
    await refreshPreviews(ensureSceneLibrary(data.scene));
    window.setTimeout(() => fitCanvasToStage(), 60);
  }

  async function refreshPreviews(nextScene: SceneDocument) {
    setGeneratedJson(JSON.stringify(nextScene, null, 2));
    const [cssText, svgText] = await Promise.all([
      fetchTextExport("/api/export/css", nextScene),
      fetchTextExport("/api/export/svg", nextScene)
    ]);
    setGeneratedCss(cssText);
    setGeneratedSvg(svgText);
    setSvgExportWarning(extractSvgExportWarning(svgText));
  }

  async function handleSaveAndApply() {
    const nextScene = {
      ...scene,
      library: {
        ...scene.library,
        savedItems: orderedElements
          .filter((element) => element.type !== "other")
          .map((element, index) => ({
            id: `${element.id}-saved-${index}`,
            name: getElementDisplayName(element, scene),
            category: "基础形状",
            element: { ...element }
          }))
      }
    };
    commitScene(nextScene);
    await refreshPreviews(nextScene);
    setStatus("已保存并应用，当前画布图元已同步到代码预览与已保存图元库");
  }

  useEffect(() => {
    saveAndApplyRef.current = handleSaveAndApply;
  }, [handleSaveAndApply]);

  async function handleTemplateUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".json")) {
      setSourceType("json");
    } else if (lower.endsWith(".svg")) {
      setSourceType("svg");
    } else {
      setSourceType("css");
    }
    setSourceName(file.name);
    const fileNameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    setGiaGroupName(fileNameWithoutExt);
    setSourceContent(content);
    setStatus(`已读取文件 ${file.name}`);
    event.target.value = "";
  }

  function loadSampleScene() {
    const sample = buildSampleScene();
    commitScene(sample);
    setSelectedId(null);
    setQuickEdit(null);
    setWarnings([]);
    setLeftTab("layers");
    setStatus("已载入示例场景，可拖拽编辑，或点击顶部「导出」查看效果");
    void refreshPreviews(sample);
    window.setTimeout(() => fitCanvasToStage(), 60);
  }

  async function copyCurrentCode() {
    const label = previewLabels[previewTab];
    const text = previewTab === "json" ? generatedJson : previewTab === "css" ? generatedCss : generatedSvg;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`已复制 ${label} 到剪贴板`);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      document.body.appendChild(helper);
      helper.select();
      try {
        document.execCommand("copy");
        setStatus(`已复制 ${label} 到剪贴板`);
      } catch {
        setStatus("复制失败，请手动选择文本复制");
      }
      document.body.removeChild(helper);
    }
  }

  function createShape(type: ShapeType, override?: Partial<SceneElement>): SceneElement {
    const libraryItem = baseShapePresets.find((item) => item.type === type);
    return {
      id: crypto.randomUUID().slice(0, 8),
      name: shapeLabels[type],
      type,
      x: scene.canvas.width / 2,
      y: scene.canvas.height / 2,
      width: override?.width ?? libraryItem?.width ?? 90,
      height: override?.height ?? libraryItem?.height ?? 90,
      rotation: normalizeRotation(override?.rotation ?? 0),
      color: override?.color ?? libraryItem?.color ?? "#4f46e5",
      opacity: override?.opacity ?? 0.85,
      zIndex: scene.elements.length,
      isBackground: override?.isBackground ?? false
    };
  }

  function addShapeToCanvas(type: ShapeType, x?: number, y?: number, override?: Partial<SceneElement>) {
    if (type === "other") {
      setStatus("“其他图形”尚未开放");
      return;
    }

    const next = createShape(type, override);
    next.x = x ?? next.x;
    next.y = y ?? next.y;

    commitScene((current) => ({
      ...current,
      meta: { ...current.meta, sourceType: "editor" },
      elements: normalizeZIndex([...current.elements, next])
    }));
    setSelectedId(next.id);
    setStatus(`已将 ${shapeLabels[type]} 放入画布`);
  }

  function updateSelected(patch: Partial<SceneElement>) {
    if (!selectedId) {
      return;
    }
    updateElementById(selectedId, patch);
  }

  function updateElementById(id: string, patch: Partial<SceneElement>) {
    const normalizedPatch = normalizeElementPatch(patch);
    commitScene((current) => {
      const target = current.elements.find((element) => element.id === id);
      const elements = current.elements.map((element) =>
        element.id === id ? { ...element, ...normalizedPatch } : element
      );
      const shouldSyncPresetColor =
        typeof normalizedPatch.color === "string" && !!target && isBasicShape(target.type);
      return {
        ...current,
        elements,
        library: shouldSyncPresetColor
          ? {
              ...current.library,
              baseShapePresets: syncBaseShapePresetColor(
                current.library.baseShapePresets,
                target.type,
                normalizedPatch.color as string
              )
            }
          : current.library
      };
    });
  }

  function updateQuickEdit(patch: Partial<SceneElement>) {
    if (!quickEdit?.targetId) {
      return;
    }
    updateElementById(quickEdit.targetId, patch);
  }

  function scaleQuickEdit(factor: number) {
    if (!quickEditElement) {
      return;
    }
    updateQuickEdit({
      width: Math.max(4, quickEditElement.width * factor),
      height: Math.max(4, quickEditElement.height * factor)
    });
  }

  function moveLayer(direction: "up" | "down" | "top" | "bottom") {
    if (!selectedId) {
      return;
    }
    const list = [...orderedElements];
    const index = list.findIndex((item) => item.id === selectedId);
    if (index === -1) {
      return;
    }

    const [item] = list.splice(index, 1);
    let targetIndex = index;
    if (direction === "up") targetIndex = Math.min(list.length, index + 1);
    if (direction === "down") targetIndex = Math.max(0, index - 1);
    if (direction === "top") targetIndex = list.length;
    if (direction === "bottom") targetIndex = 0;
    list.splice(targetIndex, 0, item);

    commitScene((current) => ({
      ...current,
      elements: normalizeZIndex(list)
    }));
  }

  function moveLayerToPosition(layerNumber: number) {
    if (!selectedId) {
      return;
    }
    const list = [...orderedElements];
    const index = list.findIndex((item) => item.id === selectedId);
    if (index === -1) {
      return;
    }

    const [item] = list.splice(index, 1);
    const targetIndex = clamp(Math.round(layerNumber) - 1, 0, list.length);
    list.splice(targetIndex, 0, item);

    commitScene((current) => ({
      ...current,
      elements: normalizeZIndex(list)
    }));
  }

  function removeElementById(id: string) {
    commitScene((current) => ({
      ...current,
      elements: normalizeZIndex(current.elements.filter((element) => element.id !== id))
    }));
    if (quickEdit?.targetId === id) {
      setQuickEdit(null);
    }
    if (selectedIdRef.current === id) {
      setSelectedId(null);
    }
    setStatus("已删除当前图元");
  }

  function removeSelected() {
    if (!selectedId) {
      return;
    }
    removeElementById(selectedId);
  }

  async function downloadExport(endpoint: string, filename: string) {
    setExportOpen(false);
    setStatus(`正在准备 ${filename}...`);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scene,
        giaGroupName: endpoint === "/api/export/gia" ? giaGroupName : undefined
      })
    });
    if (!response.ok) {
      setStatus(`导出失败: ${await response.text()}`);
      return;
    }

    const blob = await response.blob();
    let warning: string | null = null;
    if (endpoint === "/api/export/svg") {
      warning = extractSvgExportWarning(await blob.text());
      setSvgExportWarning(warning);
      if (warning) {
        setStatus(warning);
      }
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(warning ? `已下载 ${filename}（注意：圆环未包含在内）` : `已下载 ${filename}`);
  }

  function updateCanvasSize(field: "width" | "height", value: number) {
    commitScene((current) => {
      const nextValue = clamp(value || 1, 1, 2048);
      if (!lockAspectRatio) {
        return {
          ...current,
          canvas: {
            ...current.canvas,
            [field]: nextValue
          }
        };
      }

      const ratio = current.canvas.width / Math.max(1, current.canvas.height);
      if (field === "width") {
        return {
          ...current,
          canvas: {
            ...current.canvas,
            width: nextValue,
            height: clamp(nextValue / ratio, 1, 2048)
          }
        };
      }
      return {
        ...current,
        canvas: {
          ...current.canvas,
          height: nextValue,
          width: clamp(nextValue * ratio, 1, 2048)
        }
      };
    });
  }

  function updateCanvasBackground(color: string) {
    commitScene((current) => ({
      ...current,
      canvas: { ...current.canvas, background: color }
    }));
  }

  function handleZoomChange(value: number) {
    setZoom(clamp(value, 0.25, 4));
  }

  function fitCanvasToStage() {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const availW = stage.clientWidth - 96;
    const availH = stage.clientHeight - 96;
    if (availW <= 0 || availH <= 0) {
      return;
    }
    const { width, height } = sceneRef.current.canvas;
    setZoom(clamp(Math.min(availW / width, availH / height), 0.25, 4));
  }

  function closeTour() {
    setTourStep(null);
    try {
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function openTour() {
    setTourStep(0);
  }

  function handleStageMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    if ((event.target as HTMLElement).closest(".shape")) {
      return;
    }
    if (!stageRef.current) {
      return;
    }
    interactionRef.current = {
      kind: "pan",
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stageRef.current.scrollLeft,
      scrollTop: stageRef.current.scrollTop
    };
  }

  function handleCanvasDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const payload = event.dataTransfer.getData("application/miliastra-shape");
    if (!payload || !canvasRef.current) {
      return;
    }

    try {
      const data = JSON.parse(payload) as { type: ShapeType; override?: Partial<SceneElement> };
      const rect = canvasRef.current.getBoundingClientRect();
      const x = clamp((event.clientX - rect.left) / zoom, 0, scene.canvas.width);
      const y = clamp((event.clientY - rect.top) / zoom, 0, scene.canvas.height);
      addShapeToCanvas(data.type, x, y, data.override);
    } catch {
      setStatus("拖入图形失败");
    }
  }

  function startShapeDrag(event: React.DragEvent<HTMLButtonElement>, type: ShapeType, override?: Partial<SceneElement>) {
    event.dataTransfer.setData("application/miliastra-shape", JSON.stringify({ type, override }));
  }

  function updateLibraryCategory(label: string) {
    commitScene((current) => ({
      ...current,
      library: {
        ...current.library,
        activeCategory: label
      }
    }));
  }

  const savedLibrary = scene.library.savedItems ?? [];
  const listElements = [...orderedElements].reverse();
  const exportFileName = giaGroupName.trim() || formatGiaGroupName(new Date());
  const isMac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);
  const saveShortcut = isMac ? "⌘S" : "Ctrl+S";

  return (
    <div className="app-shell" onClick={() => setQuickEdit(null)}>
      <header className="topbar">
        <div className="topbar-group">
          <div className="brand" title="千星图片编辑器">
            <span className="brand-mark">
              <Icon name="sparkle" size={13} />
            </span>
            <span className="brand-name">千星图片编辑器</span>
          </div>
          <span className="divider" />
          <button className="icon-btn" onClick={undoScene} disabled={!historyState.canUndo} title="撤销 (Ctrl/⌘+Z)">
            <Icon name="undo" size={15} />
          </button>
          <button className="icon-btn" onClick={redoScene} disabled={!historyState.canRedo} title="重做 (Ctrl/⌘+Shift+Z)">
            <Icon name="redo" size={15} />
          </button>
        </div>

        <div className="topbar-group topbar-center">
          <label className="doc-name" title="素材组名称，将作为导出文件名">
            <Icon name="artboard" size={13} />
            <input
              value={giaGroupName}
              onChange={(event) => setGiaGroupName(event.target.value)}
              placeholder={formatGiaGroupName(new Date())}
              spellCheck={false}
            />
          </label>
        </div>

        <div className="topbar-group">
          <button className="btn btn-primary" onClick={handleSaveAndApply} title={`保存并应用 (${isMac ? "⌘" : "Ctrl+"}S)`}>
            <Icon name="save" size={13} />
            <span>保存并应用</span>
            <kbd className="btn-kbd">{saveShortcut}</kbd>
          </button>
          <div className="menu-wrap" data-tour="export">
            <button
              className="btn btn-ghost"
              onClick={(event) => {
                event.stopPropagation();
                setExportOpen((value) => !value);
              }}
            >
              <Icon name="download" size={13} />
              <span>导出</span>
              <Icon name="chevronDown" size={11} />
            </button>
            {exportOpen ? (
              <div className="menu" onClick={(event) => event.stopPropagation()}>
                {EXPORT_FORMATS.map((item) => (
                  <button
                    key={item.ext}
                    className="menu-item"
                    onClick={() => downloadExport(item.endpoint, `${exportFileName}.${item.ext}`)}
                  >
                    <Icon name="download" size={14} />
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span className="divider" />
          <button className="btn btn-ghost btn-text-icon" onClick={openTour} title="打开新手教程">
            <Icon name="help" size={13} />
            <span>教程</span>
          </button>
          <a className="icon-btn" href="https://github.com/1475505/Miliastra-image-editor-webui" target="_blank" rel="noreferrer" title="GitHub 仓库">
            <Icon name="gitBranch" size={15} />
          </a>
          <a className="icon-btn" href="https://ugc.070077.xyz" target="_blank" rel="noreferrer" title="知识库文档">
            <Icon name="globe" size={15} />
          </a>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar sidebar-left" data-tour="left-panel">
          <div className="sidebar-tabs">
            <div className="seg">
              <button className={leftTab === "layers" ? "active" : ""} onClick={() => setLeftTab("layers")}>
                <Icon name="layers" size={13} />
                <span>图层</span>
              </button>
              <button className={leftTab === "library" ? "active" : ""} onClick={() => setLeftTab("library")}>
                <Icon name="layoutGrid" size={13} />
                <span>图形库</span>
              </button>
              <button className={leftTab === "import" ? "active" : ""} onClick={() => setLeftTab("import")}>
                <Icon name="upload" size={13} />
                <span>导入</span>
              </button>
            </div>
          </div>

          {leftTab === "layers" ? (
            <div className="panel-scroll">
              {listElements.length === 0 ? (
                <div className="empty-box">
                  <div className="empty-box-icon">
                    <Icon name="layers" size={18} />
                  </div>
                  <strong>还没有图元</strong>
                  <p>从图形库拖入基础形状，或导入 SVG / CSS / JSON 模板</p>
                  <div className="empty-box-actions">
                    <button className="btn btn-primary" onClick={() => setLeftTab("library")}>浏览图形库</button>
                    <button className="btn btn-ghost" onClick={() => setLeftTab("import")}>导入模板</button>
                  </div>
                </div>
              ) : (
                <div className="layer-list">
                  {listElements.map((element) => (
                    <button
                      key={element.id}
                      className={`layer-row-item ${selectedId === element.id ? "selected" : ""}`}
                      onClick={() => setSelectedId(element.id)}
                    >
                      <ShapeGlyph type={element.type} color={element.color} />
                      <div className="layer-info">
                        <strong>{getElementBaseName(element)}</strong>
                        <span>
                          {Math.round(element.width)} × {Math.round(element.height)} · {Math.round(element.rotation)}°
                        </span>
                      </div>
                      <span className="layer-badge">{element.zIndex + 1}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : leftTab === "library" ? (
            <div className="panel-scroll stack">
              <label className="field">
                <span>图形分类</span>
                <select value={activeCategory} onChange={(event) => updateLibraryCategory(event.target.value)}>
                  {scene.library.categories.map((category) => (
                    <option key={category.key} value={category.label}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>

              {categoryInfo?.supported ? (
                <div className="library-grid">
                  {baseShapePresets.map((item) => (
                    <button
                      key={item.type}
                      className="library-card"
                      draggable
                      onDragStart={(event) => startShapeDrag(event, item.type)}
                      onDoubleClick={() => addShapeToCanvas(item.type)}
                      title="拖入画布或双击添加"
                    >
                      <ShapeGlyph type={item.type} color={item.color} />
                      <strong>{shapeLabels[item.type]}</strong>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="tip-box">当前分类暂不支持，已预留接口，后续可直接接入。</div>
              )}

              <div className="section-head">
                <span>已保存图元</span>
                <em>{savedLibrary.length} 个</em>
              </div>
              <div className="saved-list">
                {savedLibrary.length === 0 ? (
                  <div className="tip-box">「保存并应用」后，画布图元会出现在这里，可重复拖入复用。</div>
                ) : (
                  savedLibrary.map((item) => (
                    <button
                      key={item.id}
                      className="saved-item"
                      draggable
                      onDragStart={(event) =>
                        startShapeDrag(event, item.element.type, {
                          width: item.element.width,
                          height: item.element.height,
                          rotation: item.element.rotation,
                          color: item.element.color,
                          opacity: item.element.opacity,
                          isBackground: item.element.isBackground
                        })
                      }
                      onDoubleClick={() =>
                        addShapeToCanvas(item.element.type, undefined, undefined, {
                          width: item.element.width,
                          height: item.element.height,
                          rotation: item.element.rotation,
                          color: item.element.color,
                          opacity: item.element.opacity,
                          isBackground: item.element.isBackground
                        })
                      }
                    >
                      <ShapeGlyph type={item.element.type} color={item.element.color} />
                      <div className="layer-info">
                        <strong>{item.name}</strong>
                        <span>
                          {Math.round(item.element.width)} × {Math.round(item.element.height)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="panel-scroll stack">
                <div className="tip-box">
                  支持粘贴或上传 <code>svg / css / json</code> 模板；内容留空时导入将得到 300 × 300 空画布。
                </div>
                <label className="field">
                  <span>模板格式</span>
                  <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}>
                    <option value="svg">SVG</option>
                    <option value="css">CSS</option>
                    <option value="json">JSON</option>
                  </select>
                </label>
                <label className="upload-box">
                  <input type="file" accept=".css,.json,.svg,text/css,application/json,image/svg+xml" onChange={handleTemplateUpload} />
                  <Icon name="upload" size={16} />
                  <strong>点击上传文件</strong>
                  <span>.svg / .css / .json</span>
                </label>
                <label className="field field-grow">
                  <span>或粘贴内容</span>
                  <textarea
                    value={sourceContent}
                    onChange={(event) => setSourceContent(event.target.value)}
                    placeholder="留空时点击「导入到画布」会得到空画布"
                  />
                </label>
                {warnings.length > 0 ? (
                  <div className="message-box warning">
                    {warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                ) : null}
                <button className="btn btn-ghost" onClick={loadSampleScene}>
                  <Icon name="image" size={13} />
                  <span>载入示例场景</span>
                </button>
              </div>
              <div className="sidebar-footer">
                <button className="btn btn-primary btn-block" onClick={handleImport}>
                  导入到画布
                </button>
              </div>
            </>
          )}
        </aside>

        <section className="canvas-area" data-tour="canvas">
          <div className="canvas-toolbar">
            <button className="icon-btn" onClick={() => handleZoomChange(zoom - 0.1)} disabled={zoom <= 0.25} title="缩小">
              <Icon name="minus" size={13} />
            </button>
            <button className="zoom-display" onClick={() => handleZoomChange(1)} title="当前缩放，点击重置为 100%">
              {Math.round(zoom * 100)}%
            </button>
            <button className="icon-btn" onClick={() => handleZoomChange(zoom + 0.1)} disabled={zoom >= 4} title="放大">
              <Icon name="plus" size={13} />
            </button>
            <span className="divider" />
            <button className="icon-btn" onClick={fitCanvasToStage} title="适应窗口：缩放画布以完整显示">
              <Icon name="fit" size={14} />
            </button>
            <span className="divider" />
            <button
              className={`tool-toggle ${snapConfig.enabled ? "active" : ""}`}
              onClick={() => setSnapConfig((c) => ({ ...c, enabled: !c.enabled }))}
              title="智能吸附：拖动图元时自动对齐其他图元的边缘与中心"
            >
              <Icon name="magnet" size={13} />
              <span>吸附</span>
            </button>
            <label className="tool-field" title="网格吸附：拖动时坐标按此像素值取整，0 = 关闭">
              <span>网格</span>
              <input
                type="number"
                min="0"
                max="64"
                step="1"
                value={snapConfig.gridSize}
                onChange={(event) => setSnapConfig((c) => ({ ...c, gridSize: Number(event.target.value) }))}
              />
              <em>px</em>
            </label>
            <label className="tool-field" title="角度步进：旋转手柄时按此角度吸附，0 = 关闭；按住 Ctrl/⌘ 可临时关闭">
              <span>角度</span>
              <input
                type="number"
                min="0"
                max="90"
                step="5"
                value={snapConfig.angleStep}
                onChange={(event) => setSnapConfig((c) => ({ ...c, angleStep: Number(event.target.value) }))}
              />
              <em>°</em>
            </label>
          </div>

          <div
            ref={stageRef}
            className="canvas-stage"
            onMouseDown={handleStageMouseDown}
            onClick={() => {
              setSelectedId(null);
              setQuickEdit(null);
            }}
          >
            <div
              className="canvas-sizer"
              style={{
                width: `max(${scene.canvas.width * zoom + 80}px, 100%)`,
                height: `max(${scene.canvas.height * zoom + 80}px, 100%)`
              }}
            >
              <div
                ref={canvasRef}
                className="canvas"
                style={{
                  width: scene.canvas.width,
                  height: scene.canvas.height,
                  background: scene.canvas.background,
                  transform: `scale(${zoom})`,
                  transformOrigin: "center center"
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleCanvasDrop}
              >
                {orderedElements.map((element) => (
                  <div
                    key={element.id}
                    className={`shape shape-${element.type} ${selectedId === element.id ? "is-selected" : ""}`}
                    style={shapeStyle(element)}
                    onMouseDown={(event) => {
                      if (event.button !== 0) {
                        return;
                      }
                      event.stopPropagation();
                      let dragId = element.id;
                      let dragOriginX = element.x;
                      let dragOriginY = element.y;
                      if (event.altKey) {
                        const cloneId = `el-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                        const maxZ = sceneRef.current.elements.reduce((m, el) => Math.max(m, el.zIndex), 0);
                        const cloned: SceneElement = { ...element, id: cloneId, zIndex: maxZ + 1 };
                        commitScene((current) => ({
                          ...current,
                          elements: [...current.elements, cloned]
                        }));
                        dragId = cloneId;
                        dragOriginX = element.x;
                        dragOriginY = element.y;
                        setSelectedId(cloneId);
                      } else {
                        setSelectedId(element.id);
                      }
                      interactionRef.current = {
                        kind: "shape",
                        id: dragId,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: dragOriginX,
                        originY: dragOriginY
                      };
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(element.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setSelectedId(element.id);
                      setQuickEdit({
                        x: event.clientX,
                        y: event.clientY,
                        targetId: element.id
                      });
                    }}
                  >
                    {element.type === "triangle" ? <div className="triangle-fill" style={{ background: element.color }} /> : null}
                    {element.type === "four_point_star" ? <div className="star star-four" style={{ background: element.color }} /> : null}
                    {element.type === "five_point_star" ? <div className="star star-five" style={{ background: element.color }} /> : null}
                    {selectedId === element.id ? (
                      <>
                        <div className="rotate-stem" />
                        <div className="transform-handle rotate-handle"
                          onMouseDown={(event) => {
                            if (event.button !== 0) {
                              return;
                            }
                            event.stopPropagation();
                            const pointer = getScenePointer(event.clientX, event.clientY);
                            if (!pointer) {
                              return;
                            }
                            interactionRef.current = {
                              kind: "rotate",
                              id: element.id,
                              centerX: element.x,
                              centerY: element.y,
                              baseRotation: element.rotation,
                              startAngle: Math.atan2(pointer.y - element.y, pointer.x - element.x)
                            };
                          }}
                        />
                        <div className="transform-handle scale-handle"
                          onMouseDown={(event) => {
                            if (event.button !== 0) {
                              return;
                            }
                            event.stopPropagation();
                            interactionRef.current = {
                              kind: "resize",
                              id: element.id,
                              centerX: element.x,
                              centerY: element.y,
                              rotation: element.rotation
                            };
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                ))}
                {guideLines.map((guide, index) =>
                  guide.orientation === "vertical" ? (
                    <div
                      key={`guide-v-${index}`}
                      className="snap-guide snap-guide-vertical"
                      style={{ left: `${guide.position}px` }}
                    />
                  ) : (
                    <div
                      key={`guide-h-${index}`}
                      className="snap-guide snap-guide-horizontal"
                      style={{ top: `${guide.position}px` }}
                    />
                  )
                )}
              </div>
            </div>
          </div>

          {orderedElements.length === 0 ? (
            <div className="canvas-empty">
              <div
                className="canvas-empty-card"
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => event.stopPropagation()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleCanvasDrop}
              >
                <div className="empty-box-icon">
                  <Icon name="image" size={20} />
                </div>
                <h3>画布还是空的</h3>
                <p>先确认画布尺寸，再从图形库拖入形状，或导入 SVG / CSS / JSON 模板</p>
                <div className="canvas-quick-setup" title="画布尺寸，也可稍后在右侧「属性 → 画布」中修改">
                  <span>画布尺寸</span>
                  <input
                    type="number"
                    min="1"
                    max="2048"
                    value={Math.round(scene.canvas.width)}
                    onChange={(event) => updateCanvasSize("width", Number(event.target.value))}
                    aria-label="画布宽度"
                  />
                  <em>×</em>
                  <input
                    type="number"
                    min="1"
                    max="2048"
                    value={Math.round(scene.canvas.height)}
                    onChange={(event) => updateCanvasSize("height", Number(event.target.value))}
                    aria-label="画布高度"
                  />
                  <em>px</em>
                </div>
                <div className="empty-box-actions">
                  <button className="btn btn-primary" onClick={() => setLeftTab("library")}>浏览图形库</button>
                  <button className="btn btn-ghost" onClick={() => setLeftTab("import")}>导入模板</button>
                  <button className="btn btn-ghost" onClick={openTour}>观看教程</button>
                </div>
                <button className="link-btn" onClick={loadSampleScene}>或先试试示例场景 →</button>
              </div>
            </div>
          ) : null}

          <button
            className="canvas-meta-chip"
            title="画布尺寸，点击编辑画布属性"
            onClick={() => {
              setRightTab("props");
              setPropsView("canvas");
            }}
          >
            {Math.round(scene.canvas.width)} × {Math.round(scene.canvas.height)}
          </button>
        </section>

        <aside className="sidebar sidebar-right" data-tour="right-panel">
          <div className="sidebar-tabs">
            <div className="seg">
              <button className={rightTab === "props" ? "active" : ""} onClick={() => setRightTab("props")}>
                <Icon name="artboard" size={13} />
                <span>属性</span>
              </button>
              <button className={rightTab === "code" ? "active" : ""} onClick={() => setRightTab("code")}>
                <Icon name="code" size={13} />
                <span>代码</span>
              </button>
            </div>
          </div>

          {rightTab === "props" ? (
            <>
              <div className="props-switch">
                <div className="seg">
                  <button
                    disabled={!selectedElement}
                    className={selectedElement && propsView === "element" ? "active" : ""}
                    onClick={() => selectedElement && setPropsView("element")}
                    title={selectedElement ? "查看选中图元的属性" : "先在画布或图层列表中选中一个图元"}
                  >
                    图元
                  </button>
                  <button
                    className={!selectedElement || propsView === "canvas" ? "active" : ""}
                    onClick={() => setPropsView("canvas")}
                    title="画布尺寸、背景色等设置"
                  >
                    画布
                  </button>
                </div>
              </div>
              <div className="panel-scroll stack">
              {selectedElement && propsView === "element" ? (
                <>
                  <div className="inspector-head">
                    <ShapeGlyph type={selectedElement.type} color={selectedElement.color} />
                    <div className="layer-info">
                      <strong>{getElementBaseName(selectedElement)}</strong>
                      <span>{shapeLabels[selectedElement.type]} · 第 {selectedElement.zIndex + 1} 层</span>
                    </div>
                  </div>

                  <div className="section-head"><span>变换</span></div>
                  <div className="grid-2">
                    <NumField label="X" value={Math.round(selectedElement.x)} onChange={(value) => updateSelected({ x: value })} />
                    <NumField label="Y" value={Math.round(selectedElement.y)} onChange={(value) => updateSelected({ y: value })} />
                    <NumField label="宽" value={Math.round(selectedElement.width)} min={4} onChange={(value) => updateSelected({ width: Math.max(4, value) })} />
                    <NumField label="高" value={Math.round(selectedElement.height)} min={4} onChange={(value) => updateSelected({ height: Math.max(4, value) })} />
                  </div>
                  <div className="field">
                    <span>旋转角度</span>
                    <div className="row">
                      <input
                        type="number"
                        min="-180"
                        max="180"
                        value={Math.round(selectedElement.rotation)}
                        onChange={(event) => updateSelected({ rotation: Number(event.target.value) })}
                      />
                      <button className="icon-btn" onClick={() => updateSelected({ rotation: 0 })} title="复位角度">
                        <Icon name="rotateCw" size={13} />
                      </button>
                    </div>
                  </div>

                  <div className="section-head"><span>外观</span></div>
                  <div className="field">
                    <span>填充颜色</span>
                    <ColorField value={selectedElement.color} onChange={(color) => updateSelected({ color })} />
                  </div>
                  <div className="field">
                    <span>不透明度</span>
                    <div className="row">
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.01"
                        value={selectedElement.opacity}
                        onChange={(event) => updateSelected({ opacity: Number(event.target.value) })}
                      />
                      <input
                        className="pct-input"
                        type="number"
                        min="0"
                        max="100"
                        value={Math.round(selectedElement.opacity * 100)}
                        onChange={(event) => updateSelected({ opacity: clamp(Number(event.target.value) / 100, 0, 1) })}
                      />
                    </div>
                  </div>

                  <div className="section-head"><span>层级</span></div>
                  <div className="layer-controls">
                    <input
                      type="number"
                      min="1"
                      max={Math.max(1, orderedElements.length)}
                      value={selectedElement.zIndex + 1}
                      onChange={(event) => moveLayerToPosition(Number(event.target.value) || 1)}
                      title="层级序号"
                    />
                    <div className="icon-row">
                      <button className="icon-btn" onClick={() => moveLayer("top")} title="置顶">
                        <Icon name="arrowTop" size={13} />
                      </button>
                      <button className="icon-btn" onClick={() => moveLayer("up")} title="上移一层">
                        <Icon name="arrowUp" size={13} />
                      </button>
                      <button className="icon-btn" onClick={() => moveLayer("down")} title="下移一层">
                        <Icon name="arrowDown" size={13} />
                      </button>
                      <button className="icon-btn" onClick={() => moveLayer("bottom")} title="置底">
                        <Icon name="arrowBottom" size={13} />
                      </button>
                    </div>
                  </div>
                  <label className="check-row" title="勾选后导出 GIA 时该图元强制置于最底层">
                    <input
                      type="checkbox"
                      checked={selectedElement.isBackground}
                      onChange={(event) => updateSelected({ isBackground: event.target.checked })}
                    />
                    <span>
                      背景图元
                      <em>导出 GIA 时强制置底</em>
                    </span>
                  </label>

                  <div className="section-spacer" />
                  <button className="btn btn-danger-ghost btn-block" onClick={removeSelected}>
                    <Icon name="trash" size={13} />
                    <span>删除图元</span>
                  </button>
                </>
              ) : (
                <>
                  <div className="section-head"><span>画布设置</span></div>
                  <div className="grid-2">
                    <NumField label="宽 W" value={Math.round(scene.canvas.width)} min={1} max={2048} onChange={(value) => updateCanvasSize("width", value)} />
                    <NumField label="高 H" value={Math.round(scene.canvas.height)} min={1} max={2048} onChange={(value) => updateCanvasSize("height", value)} />
                  </div>
                  <label className="check-row" title="修改宽度或高度时保持比例">
                    <input type="checkbox" checked={lockAspectRatio} onChange={(event) => setLockAspectRatio(event.target.checked)} />
                    <span>等比缩放</span>
                  </label>
                  <div className="field">
                    <span>背景色</span>
                    <ColorField value={scene.canvas.background} onChange={updateCanvasBackground} />
                  </div>

                  <div className="section-head"><span>统计</span></div>
                  <div className="stat-row">
                    <span>图元数量</span>
                    <strong>{orderedElements.length}</strong>
                  </div>
                  <div className="stat-row">
                    <span>画布尺寸</span>
                    <strong>{Math.round(scene.canvas.width)} × {Math.round(scene.canvas.height)}</strong>
                  </div>

                  <div className="tip-box">这里设置画布的尺寸与背景色；选中图元后切换到上方「图元」页可编辑其坐标、颜色与层级。吸附开关在画布顶部工具条上。</div>
                </>
              )}
              </div>
            </>
          ) : (
            <>
              <div className="code-panel">
                <div className="seg seg-compact">
                  {(["json", "css", "svg"] as PreviewTab[]).map((tab) => (
                    <button
                      key={tab}
                      className={previewTab === tab ? "active" : ""}
                      onClick={() => setPreviewTab(tab)}
                    >
                      {previewLabels[tab]}
                    </button>
                  ))}
                </div>
                {previewTab === "svg" && svgExportWarning ? (
                  <div className="message-box warning" data-tour="svg-ring-warning">
                    <p>{svgExportWarning}</p>
                  </div>
                ) : null}
                <textarea
                  readOnly
                  spellCheck={false}
                  value={previewTab === "json" ? generatedJson : previewTab === "css" ? generatedCss : generatedSvg}
                />
              </div>
              <div className="sidebar-footer sidebar-footer-row">
                <button className="btn btn-ghost" onClick={() => refreshPreviews(scene)} title="以当前画布重新生成代码">
                  <Icon name="rotateCw" size={13} />
                  <span>刷新</span>
                </button>
                <button className="btn btn-primary" onClick={copyCurrentCode}>
                  <Icon name="copy" size={13} />
                  <span>复制 {previewLabels[previewTab]}</span>
                </button>
              </div>
            </>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <div className="status-left">
          <Icon name="info" size={12} />
          <span>{status}</span>
        </div>
        <div className="status-right">
          <span>图元 {orderedElements.length}</span>
          <i />
          <span>{Math.round(scene.canvas.width)} × {Math.round(scene.canvas.height)}</span>
          <i />
          <span>QQ 群 1007538100</span>
        </div>
      </footer>

      {quickEdit && quickEditElement ? (
        <div
          className="quick-edit-menu"
          style={{
            left: Math.min(quickEdit.x + 12, window.innerWidth - 252),
            top: Math.min(quickEdit.y + 12, window.innerHeight - 240)
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="section-head">
            <span>快捷编辑</span>
            <em>{shapeLabels[quickEditElement.type]}</em>
          </div>
          <div className="field">
            <span>填充颜色</span>
            <ColorField value={quickEditElement.color} onChange={(color) => updateQuickEdit({ color })} />
          </div>
          <div className="field">
            <span>不透明度 {Math.round(quickEditElement.opacity * 100)}%</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={quickEditElement.opacity}
              onChange={(event) => updateQuickEdit({ opacity: Number(event.target.value) })}
            />
          </div>
          <div className="quick-scale-actions">
            <button className="btn btn-ghost" onClick={() => scaleQuickEdit(0.9)}>缩小 10%</button>
            <button className="btn btn-ghost" onClick={() => scaleQuickEdit(1.1)}>放大 10%</button>
          </div>
        </div>
      ) : null}

      {tourStep !== null ? (
        <TourOverlay
          stepIndex={tourStep}
          onPrev={() => setTourStep((step) => (step === null ? null : Math.max(0, step - 1)))}
          onNext={() => setTourStep((step) => (step === null ? null : Math.min(TOUR_STEPS.length - 1, step + 1)))}
          onSkip={closeTour}
        />
      ) : null}
    </div>
  );
}

type TourStepConfig = {
  title: string;
  target?: string;
  placement?: "center" | "right" | "left" | "bottom";
  body: React.ReactNode;
};

const TOUR_STEPS: TourStepConfig[] = [
  {
    title: "欢迎使用千星图片编辑器",
    placement: "center",
    body: (
      <p>
        这是一款面向游戏图片素材的可视化编辑器：导入模板或拖入基础形状，在画布上直接编排，
        最后一键导出 <b>GIA / CSS / SVG / JSON</b>。接下来用 30 秒了解界面布局。
      </p>
    )
  },
  {
    title: "左侧面板：素材从这里来",
    target: "left-panel",
    placement: "right",
    body: (
      <p>
        <b>图形库</b>：把基础形状拖入画布（或双击添加）；<b>导入</b>：粘贴或上传 SVG / CSS / JSON 模板；
        <b>图层</b>：查看并点选画布上的全部图元。
      </p>
    )
  },
  {
    title: "画布：所见即所得",
    target: "canvas",
    placement: "center",
    body: (
      <p>
        拖动图元即可移动；选中后用<b>右下角手柄缩放</b>、<b>顶部手柄旋转</b>；<b>右键</b>打开快捷编辑。
        顶部悬浮条从左到右依次是：缩放、适应窗口、<b>吸附开关</b>（自动对齐其他图元）、
        <b>网格</b>（坐标按像素取整）、<b>角度</b>（旋转步进）。拖动空白处平移视图。
      </p>
    )
  },
  {
    title: "右侧：属性检查器与代码",
    target: "right-panel",
    placement: "left",
    body: (
      <p>
        「属性」页顶部可在<b>图元 / 画布</b>之间切换：<b>画布</b>页设置尺寸与背景色（也可以直接点画布右下角的尺寸徽标）；
        选中图元后自动切到<b>图元</b>页，精确调整坐标、颜色、透明度与层级。<b>代码</b>页可查看并一键复制 JSON / CSS / SVG。
      </p>
    )
  },
  {
    title: "保存与导出",
    target: "export",
    placement: "bottom",
    body: (
      <p>
        <kbd>Ctrl/⌘</kbd> + <kbd>S</kbd> 随时保存并应用；点击<b>导出</b>可下载 GIA、CSS、SVG、JSON，
        文件名使用顶栏中央的素材组名称。撤销 / 重做按钮在顶栏左侧。
      </p>
    )
  },
  {
    title: "常用快捷键",
    placement: "center",
    body: (
      <>
        <div className="kbd-grid">
          <span><kbd>Ctrl/⌘</kbd> <kbd>S</kbd></span><span>保存并应用</span>
          <span><kbd>Ctrl/⌘</kbd> <kbd>Z</kbd></span><span>撤销</span>
          <span><kbd>Ctrl/⌘</kbd> <kbd>Shift</kbd> <kbd>Z</kbd></span><span>重做</span>
          <span><kbd>Delete</kbd></span><span>删除选中图元</span>
          <span><kbd>Shift</kbd> + 拖拽</span><span>轴锁定移动</span>
          <span><kbd>Alt</kbd> + 拖拽</span><span>复制图元</span>
          <span><kbd>Ctrl/⌘</kbd> + 旋转</span><span>临时关闭角度吸附</span>
        </div>
        <div className="tour-links">
          <a href="https://github.com/1475505/Miliastra-image-editor-webui" target="_blank" rel="noreferrer">GitHub 仓库</a>
          <a href="https://ugc.070077.xyz" target="_blank" rel="noreferrer">知识库文档</a>
          <a href="https://space.bilibili.com/233587917" target="_blank" rel="noreferrer">作者 B 站</a>
        </div>
      </>
    )
  }
];

function TourOverlay({
  stepIndex,
  onPrev,
  onNext,
  onSkip
}: {
  stepIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const total = TOUR_STEPS.length;
  const isLast = stepIndex === total - 1;
  const rect = useTourRect(step.target, stepIndex);

  const cardStyle = computeTourCardStyle(rect, step.placement);

  return (
    <div className="tour-root" onClick={onSkip}>
      {rect ? (
        <div
          className="tour-spot"
          style={{
            left: rect.left - 6,
            top: rect.top - 6,
            width: rect.width + 12,
            height: rect.height + 12
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div className="tour-card" style={cardStyle} onClick={(event) => event.stopPropagation()}>
        <div className="tour-card-head">
          <span className="tour-badge">{stepIndex + 1} / {total}</span>
          <button className="icon-btn" onClick={onSkip} title="关闭教程">
            <Icon name="x" size={13} />
          </button>
        </div>
        <h3>{step.title}</h3>
        <div className="tour-body">{step.body}</div>
        <div className="tour-foot">
          <div className="tour-dots">
            {TOUR_STEPS.map((_, index) => (
              <i key={index} className={index === stepIndex ? "active" : ""} />
            ))}
          </div>
          <div className="tour-actions">
            {stepIndex > 0 ? (
              <button className="btn btn-ghost" onClick={onPrev}>上一步</button>
            ) : null}
            {isLast ? (
              <button className="btn btn-primary" onClick={onSkip}>
                <Icon name="check" size={13} />
                <span>开始使用</span>
              </button>
            ) : (
              <button className="btn btn-primary" onClick={onNext}>下一步</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type TourRect = { left: number; top: number; width: number; height: number };

function useTourRect(target: string | undefined, stepIndex: number): TourRect | null {
  const [rect, setRect] = useState<TourRect | null>(null);

  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    const update = () => {
      const element = document.querySelector(`[data-tour="${target}"]`);
      if (!element) {
        setRect(null);
        return;
      }
      const box = element.getBoundingClientRect();
      setRect({ left: box.left, top: box.top, width: box.width, height: box.height });
    };
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
    };
  }, [target, stepIndex]);

  return rect;
}

function computeTourCardStyle(rect: TourRect | null, placement?: string): React.CSSProperties {
  const cardWidth = 336;
  const gap = 14;
  if (!rect || placement === "center") {
    return { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  }
  if (placement === "right") {
    return {
      left: Math.min(rect.left + rect.width + gap, window.innerWidth - cardWidth - 16),
      top: clamp(rect.top + 8, 72, window.innerHeight - 280)
    };
  }
  if (placement === "left") {
    return {
      left: Math.max(16, rect.left - cardWidth - gap),
      top: clamp(rect.top + 8, 72, window.innerHeight - 280)
    };
  }
  return {
    left: clamp(rect.left + rect.width / 2 - cardWidth / 2, 16, window.innerWidth - cardWidth - 16),
    top: Math.min(rect.top + rect.height + gap, window.innerHeight - 260)
  };
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const [text, setText] = useState(() => formatColorCode(value));

  useEffect(() => {
    setText(formatColorCode(value));
  }, [value]);

  function commit(raw: string) {
    const hex = raw.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      onChange(`#${hex.toLowerCase()}`);
    } else {
      setText(formatColorCode(value));
    }
  }

  return (
    <div className="color-field">
      <label className="swatch" style={{ background: toColorInput(value) }} title="点击选择颜色">
        <input type="color" value={toColorInput(value)} onChange={(event) => onChange(event.target.value)} />
      </label>
      <div className="hex-wrap">
        <span>#</span>
        <input
          value={text}
          maxLength={6}
          spellCheck={false}
          onChange={(event) => setText(event.target.value.toUpperCase())}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              (event.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
    </div>
  );
}

function buildSampleScene(): SceneDocument {
  const base = EMPTY_SCENE();
  const make = (
    type: ShapeType,
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
    rotation = 0,
    opacity = 0.95
  ): SceneElement => ({
    id: crypto.randomUUID().slice(0, 8),
    name: shapeLabels[type],
    type,
    x,
    y,
    width,
    height,
    rotation: normalizeRotation(rotation),
    color,
    opacity,
    zIndex: 0,
    isBackground: false
  });

  const elements = [
    make("ellipse", 150, 150, 176, 176, "#0f766e"),
    make("five_point_star", 150, 140, 108, 108, "#fbbf24"),
    make("rectangle", 150, 226, 124, 26, "#115e59"),
    make("triangle", 82, 62, 46, 42, "#7c3aed", -18),
    make("four_point_star", 226, 70, 42, 42, "#38bdf8", 15)
  ].map((element, index) => ({ ...element, zIndex: index }));

  return {
    ...base,
    canvas: { width: 300, height: 300, background: "#ffffff" },
    elements,
    meta: { sourceType: "editor", sourceName: "示例场景", warnings: [] }
  };
}

function ensureSceneLibrary(scene: SceneDocument): SceneDocument {
  const categories = scene.library?.categories?.length ? scene.library.categories : libraryCategories;
  return {
    ...scene,
    library: {
      activeCategory: scene.library?.activeCategory || "基础形状",
      categories,
      baseShapePresets: normalizeBaseShapePresets(scene.library?.baseShapePresets),
      savedItems: scene.library?.savedItems || []
    }
  };
}

function ShapeGlyph({ type, color }: { type: ShapeType; color: string }) {
  return (
    <div className={`glyph glyph-${type}`}>
      {type === "triangle" ? <div className="triangle-fill" style={{ background: color }} /> : null}
      {type === "four_point_star" ? <div className="star star-four" style={{ background: color }} /> : null}
      {type === "five_point_star" ? <div className="star star-five" style={{ background: color }} /> : null}
      {type === "ellipse" ? <div className="glyph-fill ellipse" style={{ background: color }} /> : null}
      {type === "rectangle" ? <div className="glyph-fill rectangle" style={{ background: color }} /> : null}
      {type === "ring" ? <div className="glyph-fill ring" style={{ background: ringGradient(color) }} /> : null}
    </div>
  );
}

async function fetchTextExport(endpoint: string, scene: SceneDocument) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ scene })
  });
  return await response.text();
}

function extractSvgExportWarning(text: string) {
  const match = text.match(/<!--\s*Miliastra-Warning:\s*([\s\S]*?)\s*-->/);
  return match ? match[1].trim() : null;
}

function normalizeZIndex(elements: SceneElement[]) {
  return elements.map((element, index) => ({
    ...element,
    zIndex: index
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeRotation(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  if (Math.abs(normalized + 180) < 1e-9 && value > 0) {
    return 180;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function normalizeElementPatch(patch: Partial<SceneElement>) {
  if (patch.rotation === undefined) {
    return patch;
  }
  return {
    ...patch,
    rotation: normalizeRotation(patch.rotation)
  };
}

function rotateVector(x: number, y: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos
  };
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function snapToGrid(value: number, gridSize: number) {
  if (gridSize <= 0) {
    return Math.round(value);
  }
  return Math.round(value / gridSize) * gridSize;
}

function snapAngle(value: number, step: number) {
  if (step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

type SnapResult = {
  x: number;
  y: number;
  guides: GuideLine[];
};

function computeSnapGuides(
  moving: { x: number; y: number; width: number; height: number },
  others: SceneElement[],
  threshold: number
): SnapResult {
  const movingEdges = {
    left: moving.x - moving.width / 2,
    centerX: moving.x,
    right: moving.x + moving.width / 2,
    top: moving.y - moving.height / 2,
    centerY: moving.y,
    bottom: moving.y + moving.height / 2
  };

  let bestDx = threshold + 1;
  let bestDy = threshold + 1;
  let snapX: number | null = null;
  let snapY: number | null = null;
  const guides: GuideLine[] = [];

  const xRefs: { pos: number; key: "left" | "centerX" | "right" }[] = [];
  const yRefs: { pos: number; key: "top" | "centerY" | "bottom" }[] = [];

  for (const el of others) {
    xRefs.push(
      { pos: el.x - el.width / 2, key: "left" },
      { pos: el.x, key: "centerX" },
      { pos: el.x + el.width / 2, key: "right" }
    );
    yRefs.push(
      { pos: el.y - el.height / 2, key: "top" },
      { pos: el.y, key: "centerY" },
      { pos: el.y + el.height / 2, key: "bottom" }
    );
  }

  const movingXKeys: ("left" | "centerX" | "right")[] = ["centerX", "left", "right"];
  const movingYKeys: ("top" | "centerY" | "bottom")[] = ["centerY", "top", "bottom"];

  for (const mk of movingXKeys) {
    const mPos = movingEdges[mk];
    for (const ref of xRefs) {
      const dist = Math.abs(mPos - ref.pos);
      if (dist < bestDx) {
        bestDx = dist;
        snapX = ref.pos - (mPos - moving.x);
        guides.length = 0;
        guides.push({ orientation: "vertical", position: ref.pos });
      } else if (dist === bestDx && snapX !== null) {
        guides.push({ orientation: "vertical", position: ref.pos });
      }
    }
  }

  for (const mk of movingYKeys) {
    const mPos = movingEdges[mk];
    for (const ref of yRefs) {
      const dist = Math.abs(mPos - ref.pos);
      if (dist < bestDy) {
        bestDy = dist;
        snapY = ref.pos - (mPos - moving.y);
        const hGuides = guides.filter((g) => g.orientation === "horizontal");
        hGuides.length = 0;
        guides.push({ orientation: "horizontal", position: ref.pos });
      } else if (dist === bestDy && snapY !== null) {
        guides.push({ orientation: "horizontal", position: ref.pos });
      }
    }
  }

  return {
    x: bestDx <= threshold && snapX !== null ? snapX : moving.x,
    y: bestDy <= threshold && snapY !== null ? snapY : moving.y,
    guides: bestDx <= threshold || bestDy <= threshold ? guides : []
  };
}

function cloneScene(scene: SceneDocument) {
  return JSON.parse(JSON.stringify(scene)) as SceneDocument;
}

function getSceneSourceName(scene: SceneDocument) {
  return scene.meta.sourceName || `scene.${scene.meta.sourceType}`;
}

function getElementBaseName(element: SceneElement) {
  return element.name || shapeLabels[element.type] || element.id;
}

function getElementDisplayName(element: SceneElement, scene: SceneDocument) {
  return `L${element.zIndex + 1}-${getSceneSourceName(scene)}-${getElementBaseName(element)}`;
}

function isBasicShape(type: ShapeType) {
  return (
    type === "ellipse" ||
    type === "rectangle" ||
    type === "triangle" ||
    type === "four_point_star" ||
    type === "five_point_star" ||
    type === "ring"
  );
}

function normalizeBaseShapePresets(presets?: LibraryBaseShapePreset[]) {
  const source = Array.isArray(presets) ? presets : [];
  return defaultBaseShapePresets.map((preset) => {
    const matched = source.find((item) => item.type === preset.type);
    return {
      type: preset.type,
      color: matched?.color ?? preset.color,
      width: matched?.width ?? preset.width,
      height: matched?.height ?? preset.height
    };
  });
}

function syncBaseShapePresetColor(
  presets: LibraryBaseShapePreset[] | undefined,
  type: ShapeType,
  color: string
) {
  return normalizeBaseShapePresets(presets).map((preset) =>
    preset.type === type ? { ...preset, color } : preset
  );
}

function ringGradient(color: string) {
  return `radial-gradient(closest-side, transparent 79.5%, ${color} 80.5%)`;
}

function shapeStyle(element: SceneElement) {
  const common = {
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    // Scene rotation is CCW-positive; CSS rotate() appears clockwise on screen.
    transform: `translate(-50%, -50%) rotate(${-element.rotation}deg)`,
    opacity: element.opacity,
    zIndex: element.zIndex
  } as const;

  if (element.type === "ellipse") {
    return { ...common, background: element.color, borderRadius: "50%" };
  }
  if (element.type === "triangle" || element.type === "four_point_star" || element.type === "five_point_star") {
    return { ...common, background: "transparent" };
  }
  if (element.type === "ring") {
    return { ...common, background: ringGradient(element.color) };
  }
  return { ...common, background: element.color };
}

function toColorInput(value: string) {
  if (value.startsWith("#") && (value.length === 7 || value.length === 4)) {
    return value.length === 4
      ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
      : value;
  }
  return "#4f46e5";
}

function formatColorCode(value: string) {
  const normalized = toColorInput(value);
  return normalized.slice(1).toUpperCase();
}

function formatGiaGroupName(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const icons: Record<string, JSX.Element> = {
    sparkle: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l1.5 3.5L17 7l-3.5 1.5L12 12l-1.5-3.5L7 7l3.5-1.5L12 2z" />
        <path d="M8 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
        <path d="M18 11l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5.5-1.5z" />
      </svg>
    ),
    github: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.604-3.369-1.342-3.369-1.342-.454-1.155-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.088 2.91.833.091-.647.349-1.086.635-1.337-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.389-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 4.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.917.678 1.847 0 1.335-.012 2.412-.012 2.74 0 .267.18.578.688.48C19.138 20.164 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
      </svg>
    ),
    gitBranch: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="3" x2="6" y2="15" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <path d="M18 9a9 9 0 0 1-9 9" />
      </svg>
    ),
    globe: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </svg>
    ),
    video: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="14" height="12" rx="2" />
        <path d="M18 9l5-2v10l-5-2" />
      </svg>
    ),
    book: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      </svg>
    ),
    mouse: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="6" y="3" width="12" height="18" rx="6" />
        <line x1="12" y1="7" x2="12" y2="11" />
      </svg>
    ),
    artboard: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" strokeDasharray="4 4" />
        <path d="M15 3v18" strokeDasharray="4 4" />
      </svg>
    ),
    minus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    plus: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
    ),
    lock: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>
    ),
    unlock: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M7 11V7a5 5 0 019.9-1" />
      </svg>
    ),
    magnet: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8v7a5 5 0 0010 0V8" />
        <path d="M6 8H4v3a6 6 0 0012 0V8h-2" />
        <path d="M9 2v6" />
        <path d="M15 2v6" />
      </svg>
    ),
    help: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    save: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <path d="M7 3v5h5" />
      </svg>
    ),
    download: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
    chevronDown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    ),
    chevronUp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 15 12 9 18 15" />
      </svg>
    ),
    info: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
    undo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
      </svg>
    ),
    redo: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
      </svg>
    ),
    layers: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
        <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
        <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
      </svg>
    ),
    layoutGrid: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    upload: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    fit: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
        <path d="M3 16v3a2 2 0 0 0 2 2h3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
      </svg>
    ),
    trash: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
    ),
    copy: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
    x: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
    arrowTop: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3h14" />
        <path d="m18 13-6-6-6 6" />
        <path d="M12 7v14" />
      </svg>
    ),
    arrowBottom: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 21h14" />
        <path d="m6 11 6 6 6-6" />
        <path d="M12 21V7" />
      </svg>
    ),
    arrowUp: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </svg>
    ),
    arrowDown: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m19 12-7 7-7-7" />
        <path d="M12 5v14" />
      </svg>
    ),
    hash: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" y1="9" x2="20" y2="9" />
        <line x1="4" y1="15" x2="20" y2="15" />
        <line x1="10" y1="3" x2="8" y2="21" />
        <line x1="16" y1="3" x2="14" y2="21" />
      </svg>
    ),
    rotateCw: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
      </svg>
    ),
    play: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="6 3 20 12 6 21 6 3" />
      </svg>
    ),
    image: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
      </svg>
    ),
    code: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    check: (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    )
  };
  return <span className="icon">{icons[name] ?? null}</span>;
}

export default App;
