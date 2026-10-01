// WebMCP editor tools. Unsupported browsers skip registration.
// Read-only tools are annotated; imported content is untrusted data.

import type { CanvasMask, SceneDocument, SceneElement, ShapeType, SourceType, TextBoxSettings } from "./App";

// ---------------------------------------------------------------------------
// WebMCP 浏览器 API 的最小类型声明（规范 IDL 子集）
// ---------------------------------------------------------------------------

interface WebMcpExecuteOptions {
  signal?: AbortSignal;
}

interface WebMcpAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

interface WebMcpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: WebMcpAnnotations;
  execute: (
    args: Record<string, unknown> | null,
    options: WebMcpExecuteOptions
  ) => unknown | Promise<unknown>;
}

interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal }
  ): Promise<void>;
}

declare global {
  interface Document {
    readonly modelContext?: WebMcpModelContext;
  }
}

// ---------------------------------------------------------------------------
// 编辑器桥接接口：由 App 组件实现，保证工具执行时读取到最新状态
// ---------------------------------------------------------------------------

export type AddElementInput = {
  id?: string;
  type: ShapeType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string;
  opacity?: number;
  name?: string;
  zIndex?: number;
  isBackground?: boolean;
  textBox?: Partial<TextBoxSettings>;
  /** type === "image"：素材库 sprite id（6 位） */
  imageAssetId?: number;
  /** 素材 RGB 乘色开关 */
  imageTint?: boolean;
};

export type ElementPatch = Omit<Partial<SceneElement>, "textBox"> & { textBox?: Partial<TextBoxSettings> };
export type ElementUpdate = { id: string; patch: ElementPatch };
export type CanvasRegion = { x: number; y: number; width: number; height: number };
export type PreviewOptions = {
  maxSize: number;
  format: "png" | "jpeg";
  quality: number;
  region?: CanvasRegion;
};
type EditResult = { ok: boolean; error?: string; count?: number };

export type EditorBridge = {
  getScene(): SceneDocument;
  addElements(inputs: AddElementInput[], replace: boolean, select: boolean): EditResult & { elements?: SceneElement[] };
  updateElements(updates: ElementUpdate[]): EditResult;
  removeElements(ids: string[]): EditResult;
  setSelection(id: string | null): EditResult;
  setCanvas(patch: {
    width?: number;
    height?: number;
    background?: string;
    mask?: Partial<CanvasMask>;
  }): { ok: boolean; error?: string };
  clearCanvas(): { ok: boolean };
  importSource(
    sourceType: SourceType,
    content: string,
    name?: string
  ): Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  exportScene(format: "css" | "svg" | "json" | "lua"): Promise<string>;
  getCanvasPreview(
    options: PreviewOptions
  ): Promise<{ ok: boolean; dataUrl?: string; width?: number; height?: number; region?: CanvasRegion; error?: string }>;
  undo(): { ok: boolean; error?: string };
  redo(): { ok: boolean; error?: string };
};

// ---------------------------------------------------------------------------
// 工具注册
// ---------------------------------------------------------------------------

// add_element 可创建的基础形状（不含 other：界面与后端均不支持 AI 直接
// 创建"其他图形"，schema 与实际能力保持一致，避免代理调用后收到报错）。
const SHAPE_TYPES: ShapeType[] = [
  "ellipse",
  "rectangle",
  "triangle",
  "four_point_star",
  "five_point_star",
  "ring",
  "textbox",
  "image"
];

const shapeEnum = { type: "string", enum: SHAPE_TYPES };

function numberProp(description: string, minimum?: number, maximum?: number) {
  return {
    type: "number",
    ...(minimum !== undefined ? { minimum } : {}),
    ...(maximum !== undefined ? { maximum } : {}),
    description
  };
}

function err(message: string) {
  return { ok: false as const, error: message };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const GEOMETRY = "Pixels: origin top-left, x right, y down; x/y are box centers, rotation counter-clockwise. Triangle points up; ring inner/outer diameter ratio is 0.8.";
const DEFAULTS = "Defaults: canvas center, current library size/color, rotation 0; opacity 0.85 for shapes, 1 for text/image. Pass explicit size/color/opacity for predictable results. Omit zIndex to append on top.";

const elementProperties = {
  name: { type: "string", description: "Display name; new elements default to the shape name" },
  x: numberProp("Center X in canvas pixels"),
  y: numberProp("Center Y in canvas pixels"),
  width: numberProp("Box width in pixels (1-2048; default: current library preset)", 1, 2048),
  height: numberProp("Box height in pixels (1-2048; default: current library preset)", 1, 2048),
  rotation: numberProp("Degrees, counter-clockwise about the box center; default 0"),
  color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "RGB hex color, e.g. #0f766e; default: current library preset" },
  opacity: numberProp("Opacity; default 0.85 for basic shapes, 1 for textbox/image", 0, 1),
  zIndex: numberProp("Stacking sort key: larger is above; ties retain existing/input order. Reindexed after editing."),
  isBackground: { type: "boolean", description: "Background element flag for GIA export; default false" },
  text: { type: "string", description: "Textbox text (supports <color>, <i>, <size>)" },
  fontSize: numberProp("Textbox font size (default 20)", 1, 256),
  imageAssetId: { type: "integer", minimum: 100000, maximum: 999999, description: "Required for image: six-digit library sprite id" },
  imageTint: { type: "boolean", description: "Multiply sprite RGB by color, default false" }
};
const addProperties = {
  ...elementProperties,
  id: { type: "string", minLength: 1, description: "Optional unique id; generated when omitted" },
  type: shapeEnum
};
const selectProperty = { type: "boolean", default: false, description: "Select the last added element. Default false preserves selection; replacement clears it." };
const regionSchema = {
  type: "object",
  required: ["x", "y", "width", "height"],
  properties: {
    x: numberProp("Left edge in canvas coordinates"),
    y: numberProp("Top edge in canvas coordinates"),
    width: numberProp("Region width in pixels", 1),
    height: numberProp("Region height in pixels", 1)
  }
};
const queryProperties = {
  offset: { type: "integer", minimum: 0, description: "Skip this many matches (default 0)" },
  limit: { type: "integer", minimum: 1, maximum: 1000, description: "Page size; list_elements defaults to 100, get_scene to all" },
  name: { type: "string", description: "Case-insensitive substring of element name" },
  type: { type: "string", enum: [...SHAPE_TYPES, "other"] },
  ids: { type: "array", items: { type: "string" }, description: "Only these element ids" },
  region: { ...regionSchema, description: "Match elements whose rotated bounding boxes intersect this region" }
};

function objectArg(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function parseRegion(value: unknown): CanvasRegion | undefined {
  if (value === undefined) return undefined;
  const region = objectArg(value, "region");
  for (const key of ["x", "y", "width", "height"] as const) {
    if (typeof region[key] !== "number" || !Number.isFinite(region[key])) throw new Error(`region.${key} must be finite`);
  }
  if ((region.width as number) < 1 || (region.height as number) < 1) throw new Error("region width/height must be at least 1");
  return region as CanvasRegion;
}

function parseElementFields(args: Record<string, unknown>): ElementPatch {
  const patch: ElementPatch = {};
  for (const key of ["x", "y", "width", "height", "rotation", "opacity", "zIndex", "imageAssetId"] as const) {
    if (args[key] === undefined) continue;
    const value = args[key];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
    if ((key === "width" || key === "height") && (value < 1 || value > 2048)) throw new Error(`${key} must be 1-2048`);
    if (key === "opacity" && (value < 0 || value > 1)) throw new Error("opacity must be 0-1");
    if (key === "imageAssetId" && (!Number.isInteger(value) || value < 100000 || value > 999999)) throw new Error("imageAssetId must be a six-digit integer");
    patch[key] = value;
  }
  for (const key of ["name", "color"] as const) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== "string") throw new Error(`${key} must be a string`);
    patch[key] = args[key];
  }
  if (patch.color !== undefined && !/^#[0-9a-f]{6}$/i.test(patch.color)) throw new Error("color must be #RRGGBB");
  for (const key of ["imageTint", "isBackground"] as const) {
    if (args[key] === undefined) continue;
    if (typeof args[key] !== "boolean") throw new Error(`${key} must be boolean`);
    patch[key] = args[key];
  }
  if (args.text !== undefined) {
    if (typeof args.text !== "string") throw new Error("text must be a string");
    patch.textBox = { text: args.text };
  }
  if (args.fontSize !== undefined) {
    const value = args.fontSize;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 256) throw new Error("fontSize must be 1-256");
    patch.textBox = { ...patch.textBox, fontSize: value };
  }
  return patch;
}

function parseAddInput(value: unknown): AddElementInput {
  const args = objectArg(value, "element");
  const type = args.type as ShapeType;
  if (!SHAPE_TYPES.includes(type)) throw new Error(`type must be one of ${SHAPE_TYPES.join(" / ")}`);
  const fields = parseElementFields(args);
  if (type === "image" && fields.imageAssetId === undefined) throw new Error('imageAssetId is required for type "image"');
  if (type !== "image" && (fields.imageAssetId !== undefined || fields.imageTint !== undefined)) throw new Error("imageAssetId/imageTint require type image");
  if (type !== "textbox" && fields.textBox) throw new Error("text/fontSize require type textbox");
  if (args.id !== undefined && (typeof args.id !== "string" || !args.id.trim())) throw new Error("id must be a non-empty string");
  return { ...fields, type, ...(typeof args.id === "string" ? { id: args.id } : {}) };
}

function parseUpdate(value: unknown): ElementUpdate {
  const args = objectArg(value, "update");
  if (typeof args.id !== "string" || !args.id) throw new Error("Missing element id");
  const patch = parseElementFields(args);
  if (!Object.keys(patch).length) throw new Error("No updatable fields provided");
  return { id: args.id, patch };
}

function arrayArg(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function queryElements(scene: SceneDocument, args: Record<string, unknown>, defaultLimit: number) {
  const region = parseRegion(args.region);
  const name = typeof args.name === "string" ? args.name.toLowerCase() : "";
  const ids = args.ids === undefined ? null : new Set(arrayArg(args.ids, "ids"));
  const matched = scene.elements.filter((element) => {
    if (name && !element.name.toLowerCase().includes(name)) return false;
    if (args.type !== undefined && element.type !== args.type) return false;
    if (ids && !ids.has(element.id)) return false;
    if (!region) return true;
    const radians = element.rotation * Math.PI / 180;
    const halfW = (Math.abs(Math.cos(radians)) * element.width + Math.abs(Math.sin(radians)) * element.height) / 2;
    const halfH = (Math.abs(Math.sin(radians)) * element.width + Math.abs(Math.cos(radians)) * element.height) / 2;
    return element.x + halfW >= region.x && element.x - halfW <= region.x + region.width &&
      element.y + halfH >= region.y && element.y - halfH <= region.y + region.height;
  }).sort((a, b) => a.zIndex - b.zIndex);
  const offset = typeof args.offset === "number" && Number.isFinite(args.offset) ? Math.max(0, Math.floor(args.offset)) : 0;
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? clamp(Math.floor(args.limit), 1, 1000) : defaultLimit;
  const elements = matched.slice(offset, offset + limit);
  return { total: scene.elements.length, matched: matched.length, offset, count: elements.length,
    nextOffset: offset + elements.length < matched.length ? offset + elements.length : null, elements };
}

/**
 * 注册编辑器的 WebMCP 工具集。
 *
 * @param getBridge 返回当前可用的编辑器桥接对象（组件渲染期间持续更新）。
 * @returns dispose 函数：注销全部已注册工具。
 */
export function registerEditorTools(getBridge: () => EditorBridge | null): () => void {
  const modelContext = typeof document === "undefined" ? undefined : document.modelContext;
  if (!modelContext) {
    // 浏览器不支持 WebMCP（尚未进入 origin trial / 未启用 flag），静默跳过。
    return () => {};
  }
  const ctx: WebMcpModelContext = modelContext;

  const controller = new AbortController();
  const registrations: Promise<void>[] = [];

  function register(
    def: Omit<WebMcpToolDefinition, "execute">,
    run: (bridge: EditorBridge, args: Record<string, unknown>) => unknown | Promise<unknown>
  ) {
    registrations.push(
      ctx
        .registerTool(
          {
            ...def,
            execute: async (args) => {
              const bridge = getBridge();
              if (!bridge) {
                return err("Editor is not ready yet, please retry later");
              }
              try {
                // 输出可被页面脚本持有；隔离引用，避免修改结果污染不可变场景/撤销历史。
                return structuredClone(await run(bridge, args ?? {}));
              } catch (error) {
                return err(error instanceof Error ? error.message : String(error));
              }
            }
          },
          { signal: controller.signal }
        )
        .catch((error) => {
          console.warn(`[WebMCP] Failed to register tool ${def.name}:`, error);
        })
    );
  }

  register(
    {
      name: "get_scene",
      title: "Get scene",
      description:
        "Read canvas, metadata and elements. Start with summary:true; use list_elements for paginated inspection. No arguments returns the full scene including library. " + GEOMETRY,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: { type: "object", properties: {
        ...queryProperties,
        summary: { type: "boolean", default: false, description: "Only canvas, meta and elementCount; omit elements and library" },
        includeLibrary: { type: "boolean", default: true, description: "Include library presets and saved items" }
      } }
    },
    (bridge, args) => {
      const scene = bridge.getScene();
      if (args.summary === true) return { canvas: scene.canvas, meta: scene.meta, elementCount: scene.elements.length };
      const hasQuery = Object.keys(queryProperties).some((key) => args[key] !== undefined);
      const page = hasQuery ? queryElements(scene, args, scene.elements.length) : null;
      return { canvas: scene.canvas, meta: scene.meta, elements: page?.elements ?? scene.elements,
        ...(args.includeLibrary !== false ? { library: scene.library } : {}),
        ...(page ? { pagination: { ...page, elements: undefined } } : {}) };
    }
  );

  register(
    {
      name: "list_elements",
      title: "List elements",
      description:
        "List elements bottom-to-top, paginated (default 100, max 1000). Filter by name substring, type, ids, or intersection with a region (rotated bounding boxes). Returns total/matched/count/nextOffset. By default entries contain id/name/type/zIndex; details:true includes full geometry, text and sprite settings.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: { type: "object", properties: { ...queryProperties, details: { type: "boolean", default: false } } }
    },
    (bridge, args) => {
      const scene = bridge.getScene();
      const page = queryElements(scene, args, 100);
      return { canvas: scene.canvas, ...page, elements: args.details === true ? page.elements : page.elements.map(
        ({ id, name, type, zIndex }) => ({ id, name, type, zIndex })
      ) };
    }
  );

  register(
    {
      name: "add_element",
      title: "Add element",
      description:
        "Add one shape, textbox or sprite (image requires imageAssetId). Prefer add_elements for multiple shapes: one atomic edit/undo step. Returns the new element. " + GEOMETRY + " " + DEFAULTS,
      inputSchema: {
        type: "object",
        required: ["type"],
        properties: { ...addProperties, select: selectProperty }
      }
    },
    (bridge, args) => {
      const result = bridge.addElements([parseAddInput(args)], false, args.select === true);
      return result.ok ? { ok: true, element: result.elements?.[0] } : result;
    }
  );

  for (const replace of [false, true]) {
    register(
      {
        name: replace ? "set_elements" : "add_elements",
        title: replace ? "Replace all elements" : "Add elements",
        description: (replace
          ? "Replace ALL elements while preserving canvas, metadata and library. Empty array clears elements. "
          : "Add many elements in one call. ") +
          "Atomic, one undo step. Returns count and ids in input order; returnElements:true adds full elements. " + GEOMETRY + " " + DEFAULTS,
        inputSchema: { type: "object", required: ["elements"], properties: {
          elements: { type: "array", items: { type: "object", required: ["type"], properties: addProperties } },
          select: selectProperty,
          returnElements: { type: "boolean", default: false }
        } }
      },
      (bridge, args) => {
        const inputs = arrayArg(args.elements, "elements").map(parseAddInput);
        const result = bridge.addElements(inputs, replace, args.select === true);
        if (!result.ok) return result;
        return { ok: true, count: result.count, ids: result.elements?.map((element) => element.id),
          ...(args.returnElements === true ? { elements: result.elements } : {}) };
      }
    );
  }

  register(
    {
      name: "update_element",
      title: "Update element",
      description:
        "Patch one element by id; prefer update_elements for batches. Preserves selection; unchanged values create no undo step. " + GEOMETRY,
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Target element id (obtainable via list_elements)" },
          ...elementProperties
        }
      }
    },
    (bridge, args) => bridge.updateElements([parseUpdate(args)])
  );

  register(
    {
      name: "update_elements",
      title: "Update elements",
      description: "Patch a batch of {id, ...fields} atomically in one undo step. Ids must exist and be unique. Returns changed count; no-op edits create no history. zIndex accepts fractional/negative sort keys, then normalizes. " + GEOMETRY,
      inputSchema: { type: "object", required: ["updates"], properties: {
        updates: { type: "array", items: { type: "object", required: ["id"], properties: {
          id: { type: "string" }, ...elementProperties
        } } }
      } }
    },
    (bridge, args) => bridge.updateElements(arrayArg(args.updates, "updates").map(parseUpdate))
  );

  register(
    {
      name: "remove_element",
      title: "Remove element",
      description: "Remove the element with the given id from the canvas.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Target element id (obtainable via list_elements)" }
        }
      }
    },
    (bridge, args) => {
      const id = typeof args.id === "string" ? args.id : "";
      if (!id) {
        return err("Missing element id");
      }
      return bridge.removeElements([id]);
    }
  );

  register(
    {
      name: "remove_elements",
      title: "Remove elements",
      description: "Remove multiple elements atomically in one undo step. Every id must exist; duplicates are removed once. Remaining layers retain their order.",
      inputSchema: { type: "object", required: ["ids"], properties: { ids: { type: "array", items: { type: "string" } } } }
    },
    (bridge, args) => {
      const ids = arrayArg(args.ids, "ids");
      if (ids.some((id) => typeof id !== "string" || !id)) return err("ids must contain non-empty strings");
      return bridge.removeElements(ids as string[]);
    }
  );

  register(
    {
      name: "set_selection",
      title: "Set selection",
      description: "Select one element by id, or pass null/omit id to clear the selection outline. Does not change scene/history.",
      inputSchema: { type: "object", properties: { id: { type: ["string", "null"] } } }
    },
    (bridge, args) => {
      if (args.id !== undefined && args.id !== null && typeof args.id !== "string") return err("id must be a string or null");
      return bridge.setSelection(typeof args.id === "string" ? args.id : null);
    }
  );

  register(
    {
      name: "set_canvas",
      title: "Set canvas",
      description: "Patch canvas size/background and GIA mask in one undo step. Mask offsets are relative to canvas center, y UP; mask does not affect PNG or get_canvas_preview.",
      inputSchema: {
        type: "object",
        properties: {
          width: numberProp("Canvas width in pixels (1-2048)", 1, 2048),
          height: numberProp("Canvas height in pixels (1-2048)", 1, 2048),
          background: { type: "string", description: "#RRGGBB or transparent" },
          mask: {
            type: "object",
            additionalProperties: false,
            properties: {
              enabled: { type: "boolean", description: "Enable GIA clipping (default true)" },
              shapeType: { type: "integer", enum: [1, 2], description: "1 rectangle (default), 2 ellipse" },
              x: numberProp("Center offset X, right positive (default 0)"),
              y: numberProp("Center offset Y, UP positive (default 0)"),
              width: { type: ["number", "null"], minimum: 1, description: "Pixels; null follows canvas width (default)" },
              height: { type: ["number", "null"], minimum: 1, description: "Pixels; null follows canvas height (default)" },
              previewOnCanvas: { type: "boolean", description: "Show editor overlay only (default false)" }
            }
          }
        }
      }
    },
    (bridge, args) => {
      const patch: Parameters<EditorBridge["setCanvas"]>[0] = {};
      for (const key of ["width", "height"] as const) {
        if (args[key] === undefined) continue;
        const value = args[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 2048) return err(`${key} must be 1-2048`);
        patch[key] = value;
      }
      if (args.background !== undefined) {
        if (typeof args.background !== "string" || (args.background !== "transparent" && !/^#[0-9a-f]{6}$/i.test(args.background))) return err("background must be #RRGGBB or transparent");
        patch.background = args.background;
      }
      if (args.mask !== undefined) {
        const mask = objectArg(args.mask, "mask");
        const fields = ["enabled", "shapeType", "x", "y", "width", "height", "previewOnCanvas"];
        for (const [key, value] of Object.entries(mask)) {
          if (!fields.includes(key)) return err(`Unknown mask field: ${key}`);
          if (key === "enabled" || key === "previewOnCanvas") {
            if (typeof value !== "boolean") return err(`mask.${key} must be boolean`);
          } else if (key === "shapeType") {
            if (value !== 1 && value !== 2) return err("mask.shapeType must be 1 or 2");
          } else if (value === null && (key === "width" || key === "height")) {
            continue;
          } else if (typeof value !== "number" || !Number.isFinite(value) || ((key === "width" || key === "height") && value < 1)) {
            return err(`Invalid mask.${key}`);
          }
        }
        if (Object.keys(mask).length) patch.mask = mask as Partial<CanvasMask>;
      }
      if (Object.keys(patch).length === 0) {
        return err("No canvas fields provided");
      }
      return bridge.setCanvas(patch);
    }
  );

  register(
    {
      name: "clear_canvas",
      title: "Clear canvas",
      description: "Remove all elements and reset the canvas to a blank scene (undoable).",
      inputSchema: { type: "object", properties: {} }
    },
    (bridge) => bridge.clearCanvas()
  );

  register(
    {
      name: "import_source",
      title: "Import source",
      description:
        "Import CSS/JSON/SVG/Lua text, replacing the entire scene in one undo step. Prefer batch tools for direct edits. JSON with canvas requires element id/type/x/y/width/height; text settings use textBox. SVG supports basic shapes and library images, with limited round-trip fidelity. Lua reads literal data only.",
      annotations: { untrustedContentHint: true },
      inputSchema: {
        type: "object",
        required: ["sourceType", "content"],
        properties: {
          sourceType: {
            type: "string",
            enum: ["css", "json", "svg", "lua"],
            description: "Format of the source content"
          },
          content: { type: "string", description: "Full text content of the source file" },
          name: { type: "string", description: "Source name (optional, used for metadata)" }
        }
      }
    },
    (bridge, args) => {
      const sourceType = args.sourceType as SourceType | undefined;
      if (sourceType !== "css" && sourceType !== "json" && sourceType !== "svg" && sourceType !== "lua") {
        return err("sourceType must be one of css / json / svg / lua");
      }
      const content = typeof args.content === "string" ? args.content : "";
      if (!content.trim()) {
        return err("content must not be empty");
      }
      const name = typeof args.name === "string" ? args.name : undefined;
      return bridge.importSource(sourceType, content, name);
    }
  );

  register(
    {
      name: "export_scene",
      title: "Export scene",
      description:
        "Export the current scene as text and return its content: css (web styles) / svg (vector; unsupported rings are dropped automatically) / json (scene source data) / lua (client image drawing script using one image prefab; textboxes are preserved only for re-import). For the binary GIA format use the in-app export button.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        required: ["format"],
        properties: {
          format: {
            type: "string",
            enum: ["css", "svg", "json", "lua"],
            description: "Export format"
          }
        }
      }
    },
    async (bridge, args) => {
      const format = args.format as "css" | "svg" | "json" | "lua" | undefined;
      if (format !== "css" && format !== "svg" && format !== "json" && format !== "lua") {
        return err("format must be one of css / svg / json / lua");
      }
      const content = await bridge.exportScene(format);
      return { ok: true, format, content };
    }
  );

  register(
    {
      name: "get_canvas_preview",
      title: "Get canvas preview",
      description:
        "Render without selection outlines. Region uses top-left canvas coordinates, clips to canvas and enlarges to maxSize; full canvas only shrinks. PNG preserves alpha; JPEG uses white matte. Use output:image for image-capable clients, otherwise dataUrl (default).",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          maxSize: numberProp("Max longest edge in pixels (default 512)", 128, 2048),
          region: regionSchema,
          format: { type: "string", enum: ["png", "jpeg"], default: "png" },
          quality: numberProp("JPEG quality, default 0.8", 0.1, 1),
          output: { type: "string", enum: ["dataUrl", "image"], default: "dataUrl" }
        }
      }
    },
    async (bridge, args) => {
      const raw = typeof args.maxSize === "number" ? args.maxSize : 512;
      const maxSize = clamp(Math.round(raw) || 512, 128, 2048);
      if (args.format !== undefined && args.format !== "png" && args.format !== "jpeg") return err("format must be png or jpeg");
      if (args.output !== undefined && args.output !== "dataUrl" && args.output !== "image") return err("output must be dataUrl or image");
      const result = await bridge.getCanvasPreview({ maxSize, region: parseRegion(args.region),
        format: args.format === "jpeg" ? "jpeg" : "png",
        quality: typeof args.quality === "number" && Number.isFinite(args.quality) ? clamp(args.quality, 0.1, 1) : 0.8 });
      if (!result.ok || !result.dataUrl || args.output !== "image") return result;
      const comma = result.dataUrl.indexOf(",");
      return { ok: true, width: result.width, height: result.height, region: result.region,
        content: [{ type: "image", mimeType: args.format === "jpeg" ? "image/jpeg" : "image/png", data: result.dataUrl.slice(comma + 1) }] };
    }
  );

  register(
    {
      name: "undo",
      title: "Undo",
      description: "Undo the last editing operation.",
      inputSchema: { type: "object", properties: {} }
    },
    (bridge) => bridge.undo()
  );

  register(
    {
      name: "redo",
      title: "Redo",
      description: "Redo the previously undone operation.",
      inputSchema: { type: "object", properties: {} }
    },
    (bridge) => bridge.redo()
  );

  Promise.all(registrations).then(
    () => {
      console.info(`[WebMCP] Miliastra image editor tools registered (${registrations.length})`);
    },
    () => {
      /* 单个工具注册失败已在上方记录，无需额外处理 */
    }
  );

  return () => {
    controller.abort();
  };
}
