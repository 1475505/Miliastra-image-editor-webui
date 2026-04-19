import { useEffect, useMemo, useRef, useState } from "react";

type ShapeType =
  | "ellipse"
  | "rectangle"
  | "triangle"
  | "four_point_star"
  | "five_point_star"
  | "other";

type SourceType = "json" | "css" | "svg";
type LeftTab = "template" | "library";
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
  other: "其他图形"
};

const previewLabels: Record<PreviewTab, string> = {
  json: "JSON 浏览",
  css: "CSS 浏览",
  svg: "SVG 浏览"
};

const defaultBaseShapePresets: LibraryBaseShapePreset[] = [
  { type: "ellipse", color: "#0f766e", width: 88, height: 88 },
  { type: "rectangle", color: "#c2410c", width: 102, height: 70 },
  { type: "triangle", color: "#7c3aed", width: 96, height: 86 },
  { type: "four_point_star", color: "#0f4c81", width: 90, height: 90 },
  { type: "five_point_star", color: "#be123c", width: 92, height: 92 }
];

function App() {
  const [scene, setScene] = useState<SceneDocument>(EMPTY_SCENE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leftTab, setLeftTab] = useState<LeftTab>("template");
  const [sourceType, setSourceType] = useState<SourceType>("css");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [previewTab, setPreviewTab] = useState<PreviewTab>("json");
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [generatedJson, setGeneratedJson] = useState(JSON.stringify(EMPTY_SCENE(), null, 2));
  const [generatedCss, setGeneratedCss] = useState("");
  const [generatedSvg, setGeneratedSvg] = useState("");
  const [giaGroupName, setGiaGroupName] = useState(() => formatGiaGroupName(new Date()));
  const [warnings, setWarnings] = useState<string[]>([]);
  const [status, setStatus] = useState("基础模板默认是空画布，可以直接粘贴或上传 css/json/svg。");
  const [zoom, setZoom] = useState(1);
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const [quickEdit, setQuickEdit] = useState<QuickEditState>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionState>(null);
  const zoomRef = useRef(zoom);
  const sceneRef = useRef(scene);
  const historyRef = useRef<SceneDocument[]>([cloneScene(EMPTY_SCENE())]);
  const historyIndexRef = useRef(0);

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
    sceneRef.current = scene;
  }, [scene]);

  function replaceScene(nextSceneOrUpdater: SceneDocument | ((current: SceneDocument) => SceneDocument)) {
    setScene((current) => {
      const rawNext = typeof nextSceneOrUpdater === "function" ? nextSceneOrUpdater(current) : nextSceneOrUpdater;
      const next = ensureSceneLibrary(rawNext);
      sceneRef.current = next;
      return next;
    });
  }

  function commitHistory(nextScene: SceneDocument) {
    const snapshot = cloneScene(ensureSceneLibrary(nextScene));
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    const last = trimmed[trimmed.length - 1];
    if (JSON.stringify(last) === JSON.stringify(snapshot)) {
      historyRef.current = trimmed;
      historyIndexRef.current = trimmed.length - 1;
      return;
    }
    trimmed.push(snapshot);
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
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
      if (!canCaptureShortcut(event.target)) {
        return;
      }
      if (!event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (historyIndexRef.current > 0) {
          historyIndexRef.current -= 1;
          const snapshot = cloneScene(historyRef.current[historyIndexRef.current]);
          sceneRef.current = snapshot;
          setScene(snapshot);
          setSelectedId(null);
          setQuickEdit(null);
          setStatus("已撤销上一步");
        }
        return;
      }

      if (key === "r" || key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        if (historyIndexRef.current < historyRef.current.length - 1) {
          historyIndexRef.current += 1;
          const snapshot = cloneScene(historyRef.current[historyIndexRef.current]);
          sceneRef.current = snapshot;
          setScene(snapshot);
          setSelectedId(null);
          setQuickEdit(null);
          setStatus("已重做下一步");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
        replaceScene((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === action.id
              ? {
                  ...element,
                  x: clamp(action.originX + (event.clientX - action.startX) / zoomRef.current, 0, current.canvas.width),
                  y: clamp(action.originY + (event.clientY - action.startY) / zoomRef.current, 0, current.canvas.height)
                }
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
          -action.rotation
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
        replaceScene((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            element.id === action.id
              ? {
                  ...element,
                  rotation: action.baseRotation + radiansToDegrees(angle - action.startAngle)
                }
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
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
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
    setStatus("基础模板已导入到画布");
    await refreshPreviews(ensureSceneLibrary(data.scene));
  }

  async function refreshPreviews(nextScene: SceneDocument) {
    setGeneratedJson(JSON.stringify(nextScene, null, 2));
    const [cssText, svgText] = await Promise.all([
      fetchTextExport("/api/export/css", nextScene),
      fetchTextExport("/api/export/svg", nextScene)
    ]);
    setGeneratedCss(cssText);
    setGeneratedSvg(svgText);
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
    setStatus("已保存并应用，当前画布图元已同步到导出浏览区与已保存图元库。");
  }

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
      rotation: override?.rotation ?? 0,
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

    commitScene((current) => {
      const target = current.elements.find((element) => element.id === selectedId);
      const elements = current.elements.map((element) =>
        element.id === selectedId ? { ...element, ...patch } : element
      );
      const shouldSyncPresetColor = typeof patch.color === "string" && !!target && isBasicShape(target.type);
      return {
        ...current,
        elements,
        library: shouldSyncPresetColor
          ? {
              ...current.library,
              baseShapePresets: syncBaseShapePresetColor(
                current.library.baseShapePresets,
                target.type,
                patch.color as string
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

    commitScene((current) => {
      const target = current.elements.find((element) => element.id === quickEdit.targetId);
      const elements = current.elements.map((element) =>
        element.id === quickEdit.targetId ? { ...element, ...patch } : element
      );
      const shouldSyncPresetColor = typeof patch.color === "string" && !!target && isBasicShape(target.type);
      return {
        ...current,
        elements,
        library: shouldSyncPresetColor
          ? {
              ...current.library,
              baseShapePresets: syncBaseShapePresetColor(
                current.library.baseShapePresets,
                target.type,
                patch.color as string
              )
            }
          : current.library
      };
    });
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

  function removeSelected() {
    if (!selectedId) {
      return;
    }

    commitScene((current) => ({
      ...current,
      elements: normalizeZIndex(current.elements.filter((element) => element.id !== selectedId))
    }));
    if (quickEdit?.targetId === selectedId) {
      setQuickEdit(null);
    }
    setSelectedId(null);
    setStatus("已删除当前图元");
  }

  async function downloadExport(endpoint: string, filename: string) {
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    setStatus(`已下载 ${filename}`);
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

  function handleZoomChange(value: number) {
    setZoom(clamp(value, 0.25, 4));
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

  return (
    <div className="app-shell" onClick={() => setQuickEdit(null)}>
      <div className="top-strip">
        <div className="title-block">
          <div className="title-chip">千星图片编辑器</div>
          <div className="top-links">
            <a className="top-link-button" href="https://github.com/1475505/Miliastra-image-editor-webui" target="_blank" rel="noreferrer">
              开源仓库
            </a>
            <a className="top-link-button" href="https://space.bilibili.com/233587917" target="_blank" rel="noreferrer">
              作者 B 站
            </a>
            <a className="top-link-button" href="https://ugc.070077.xyz" target="_blank" rel="noreferrer">
              知识库问答
            </a>
          </div>
          <div className="top-meta">用户 QQ 群：1007538100</div>
        </div>
        <div className="status-pill">{status}</div>
      </div>

      <main className="workspace-grid">
        <section className="card left-panel">
          <div className="tab-header">
            <button className={leftTab === "template" ? "tab active" : "tab"} onClick={() => setLeftTab("template")}>
              基础模板
            </button>
            <button className={leftTab === "library" ? "tab active" : "tab"} onClick={() => setLeftTab("library")}>
              图形库
            </button>
          </div>

          {leftTab === "template" ? (
            <div className="template-layout">
              <div className="left-scroll">
                <div className="stack">
                  <p className="helper-text">
                    默认是空图片。这里可以粘贴或上传 <code>css / json / svg</code>，留空导入时会得到空画布。
                  </p>
                  <label className="field">
                    <span>模板格式</span>
                    <select value={sourceType} onChange={(event) => setSourceType(event.target.value as SourceType)}>
                      <option value="css">CSS</option>
                      <option value="json">JSON</option>
                      <option value="svg">SVG</option>
                    </select>
                  </label>
                  <label className="upload-box">
                    <input type="file" accept=".css,.json,.svg,text/css,application/json,image/svg+xml" onChange={handleTemplateUpload} />
                    <span>上传 css / json / svg</span>
                  </label>
                  <label className="field">
                    <span>粘贴内容</span>
                    <textarea
                      value={sourceContent}
                      onChange={(event) => setSourceContent(event.target.value)}
                      rows={10}
                      placeholder="这里留空时，点击导入会得到空画布。"
                    />
                  </label>
                  {warnings.length > 0 ? (
                    <div className="message-box warning">
                      {warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="sticky-footer">
                <button className="primary-btn" onClick={handleImport}>
                  导入到画布
                </button>
              </div>
            </div>
          ) : (
            <div className="left-scroll">
              <div className="stack">
                <p className="helper-text">
                  图形库按分类下拉筛选。默认是“基础形状”；其他分类先保留接口并提示暂不支持。
                </p>
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
                      >
                        <ShapeGlyph type={item.type} color={item.color} />
                        <strong>{shapeLabels[item.type]}</strong>
                        <span>拖入画布或双击添加</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-inline">当前分类暂不支持，已预留接口，后续可直接接入。</div>
                )}

                <div className="saved-section">
                  <div className="section-mini-head">
                    <strong>已保存图元</strong>
                    <span>{savedLibrary.length} 个</span>
                  </div>
                  <div className="saved-list">
                    {savedLibrary.length === 0 ? (
                      <div className="empty-inline">保存并应用后会出现在这里</div>
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
                          <div>
                            <strong>{item.name}</strong>
                            <span>
                              {item.category} / {Math.round(item.element.width)} × {Math.round(item.element.height)}
                            </span>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="card canvas-panel">
          <div className="canvas-head">
            <div>
              <strong>画布</strong>
              <span>默认居中显示。左键拖动空白区域可移动视图，滚动条与缩放滑块同时可用</span>
            </div>
            <div className="canvas-tools">
              <div className="zoom-tool">
                <button onClick={() => handleZoomChange(zoom - 0.1)}>-</button>
                <span>缩放</span>
                <input
                  type="range"
                  min="0.25"
                  max="4"
                  step="0.05"
                  value={zoom}
                  onChange={(event) => handleZoomChange(Number(event.target.value))}
                />
                <button onClick={() => handleZoomChange(zoom + 0.1)}>+</button>
                <strong>{Math.round(zoom * 100)}%</strong>
              </div>
              <div className="size-tool">
                <label>
                  W
                  <input
                    type="number"
                    min="1"
                    max="2048"
                    value={Math.round(scene.canvas.width)}
                    onChange={(event) => updateCanvasSize("width", Number(event.target.value))}
                  />
                </label>
                <label>
                  H
                  <input
                    type="number"
                    min="1"
                    max="2048"
                    value={Math.round(scene.canvas.height)}
                    onChange={(event) => updateCanvasSize("height", Number(event.target.value))}
                  />
                </label>
                <label className="ratio-lock">
                  <input
                    type="checkbox"
                    checked={lockAspectRatio}
                    onChange={(event) => setLockAspectRatio(event.target.checked)}
                  />
                  等比
                </label>
              </div>
            </div>
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
                width: `max(${scene.canvas.width * zoom + 48}px, 100%)`,
                height: `max(${scene.canvas.height * zoom + 48}px, 100%)`
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
                      interactionRef.current = {
                        kind: "shape",
                        id: element.id,
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: element.x,
                        originY: element.y
                      };
                      setSelectedId(element.id);
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
                {orderedElements.length === 0 ? (
                  <div className="empty-canvas-tip">空画布，可从左侧基础模板导入，或从图形库拖入图形</div>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="card right-panel">
          <div className="section-mini-head">
            <strong>图元层级与属性</strong>
            <span>{selectedElement ? `层级 ${selectedElement.zIndex + 1}` : "图元列表"}</span>
          </div>

          {selectedElement ? (
            <div className="detail-stack">
              <div className="selected-preview">
                <ShapeGlyph type={selectedElement.type} color={selectedElement.color} />
                <div>
                  <strong>{shapeLabels[selectedElement.type]}</strong>
                  <span>{getElementDisplayName(selectedElement, scene)}</span>
                </div>
              </div>

              <div className="empty-detail">
                旋转和缩放优先在画布上直接操作。蓝色手柄用于旋转，橙色手柄用于缩放；右侧继续负责数值和层级编辑。
              </div>

              <div className="property-grid">
                <label className="field">
                  <span>X</span>
                  <input type="number" value={selectedElement.x} onChange={(event) => updateSelected({ x: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>Y</span>
                  <input type="number" value={selectedElement.y} onChange={(event) => updateSelected({ y: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>宽度</span>
                  <input type="number" value={selectedElement.width} onChange={(event) => updateSelected({ width: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>高度</span>
                  <input type="number" value={selectedElement.height} onChange={(event) => updateSelected({ height: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>颜色 #{formatColorCode(selectedElement.color)}</span>
                  <input type="color" value={toColorInput(selectedElement.color)} onChange={(event) => updateSelected({ color: event.target.value })} />
                </label>
                <label className="field">
                  <span>透明度 {selectedElement.opacity.toFixed(2)}</span>
                  <input type="range" min="0" max="1" step="0.01" value={selectedElement.opacity} onChange={(event) => updateSelected({ opacity: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>旋转</span>
                  <input type="number" value={selectedElement.rotation} onChange={(event) => updateSelected({ rotation: Number(event.target.value) })} />
                </label>
                <label className="field checkbox">
                  <input type="checkbox" checked={selectedElement.isBackground} onChange={(event) => updateSelected({ isBackground: event.target.checked })} />
                  <span>背景图元</span>
                </label>
              </div>

              <div className="layer-input-row">
                <label className="field">
                  <span>层级</span>
                  <input
                    type="number"
                    min="1"
                    max={orderedElements.length}
                    value={selectedElement.zIndex + 1}
                    onChange={(event) => moveLayerToPosition(Number(event.target.value) || 1)}
                  />
                </label>
                <button onClick={() => moveLayerToPosition(selectedElement.zIndex)}>层级 -1</button>
                <button onClick={() => moveLayerToPosition(selectedElement.zIndex + 2)}>层级 +1</button>
              </div>

              <div className="layer-toolbox">
                <button onClick={() => moveLayer("top")}>置顶</button>
                <button onClick={() => moveLayer("up")}>上移</button>
                <button onClick={() => moveLayer("down")}>下移</button>
                <button onClick={() => moveLayer("bottom")}>置底</button>
              </div>

              <button className="danger-btn" onClick={removeSelected}>
                删除当前图元
              </button>
            </div>
          ) : (
            <>
              <div className="empty-detail">
                未选中图元时，这里显示当前图元列表。点击列表项可直接选中；选中后可在画布上拖动旋转和缩放手柄。
              </div>
              <div className="element-list">
                {listElements.length === 0 ? (
                  <div className="empty-inline">当前画布还没有图元</div>
                ) : (
                  listElements.map((element) => (
                    <button
                      key={element.id}
                      className="element-list-item"
                      onClick={() => setSelectedId(element.id)}
                    >
                      <ShapeGlyph type={element.type} color={element.color} />
                      <div>
                        <strong>{getElementDisplayName(element, scene)}</strong>
                        <span>
                          {Math.round(element.width)} × {Math.round(element.height)} / 旋转 {Math.round(element.rotation)}°
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <section className="bottom-strip">
        <div className="bottom-actions">
          <label className="gia-export-field">
            <span>素材组名称</span>
            <input value={giaGroupName} onChange={(event) => setGiaGroupName(event.target.value)} placeholder={formatGiaGroupName(new Date())} />
          </label>
          <button className="primary-btn compact" onClick={handleSaveAndApply}>
            保存并应用
          </button>
          <button onClick={() => downloadExport("/api/export/gia", `${giaGroupName}.gia`)}>下载 GIA</button>
          <button onClick={() => downloadExport("/api/export/css", `${giaGroupName}.css`)}>下载 CSS</button>
          <button onClick={() => downloadExport("/api/export/svg", `${giaGroupName}.svg`)}>下载 SVG</button>
          <button onClick={() => downloadExport("/api/export/json", `${giaGroupName}.json`)}>下载 JSON</button>
          <button className="drawer-toggle" onClick={() => setPreviewExpanded((value) => !value)}>
            {previewExpanded ? "收起浏览" : "展开浏览"}
          </button>
        </div>

        {previewExpanded ? (
          <div className="preview-zone">
            <div className="tab-header compact-tabs">
              {(["json", "css", "svg"] as PreviewTab[]).map((tab) => (
                <button
                  key={tab}
                  className={previewTab === tab ? "tab active" : "tab"}
                  onClick={() => setPreviewTab(tab)}
                >
                  {previewLabels[tab]}
                </button>
              ))}
            </div>
            <textarea
              readOnly
              rows={8}
              value={previewTab === "json" ? generatedJson : previewTab === "css" ? generatedCss : generatedSvg}
            />
          </div>
        ) : null}
      </section>

      {quickEdit && quickEditElement ? (
        <div
          className="quick-edit-menu"
          style={{ left: quickEdit.x + 12, top: quickEdit.y + 12 }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="section-mini-head">
            <strong>右键快捷编辑</strong>
            <span>{shapeLabels[quickEditElement.type]}</span>
          </div>
          <label className="field">
            <span>颜色 #{formatColorCode(quickEditElement.color)}</span>
            <input type="color" value={toColorInput(quickEditElement.color)} onChange={(event) => updateQuickEdit({ color: event.target.value })} />
          </label>
          <label className="field">
            <span>透明度 {quickEditElement.opacity.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.01" value={quickEditElement.opacity} onChange={(event) => updateQuickEdit({ opacity: Number(event.target.value) })} />
          </label>
          <div className="quick-scale-actions">
            <button onClick={() => scaleQuickEdit(0.9)}>缩小 10%</button>
            <button onClick={() => scaleQuickEdit(1.1)}>放大 10%</button>
          </div>
        </div>
      ) : null}
    </div>
  );
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

function normalizeZIndex(elements: SceneElement[]) {
  return elements.map((element, index) => ({
    ...element,
    zIndex: index
  }));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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
    type === "five_point_star"
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

function shapeStyle(element: SceneElement) {
  const common = {
    left: `${element.x}px`,
    top: `${element.y}px`,
    width: `${element.width}px`,
    height: `${element.height}px`,
    transform: `translate(-50%, -50%) rotate(${element.rotation}deg)`,
    opacity: element.opacity,
    zIndex: element.zIndex
  } as const;

  if (element.type === "ellipse") {
    return { ...common, background: element.color, borderRadius: "50%" };
  }
  if (element.type === "triangle" || element.type === "four_point_star" || element.type === "five_point_star") {
    return { ...common, background: "transparent" };
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

export default App;
