// WebMCP (Web Model Context Protocol) 集成模块。
//
// 规范: W3C Web Machine Learning CG Draft Community Group Report
//   https://webmachinelearning.github.io/webmcp/
//
// 页面通过 document.modelContext.registerTool() 将编辑器能力注册为带
// JSON Schema 的命名工具，供浏览器 AI 代理（Chrome WebMCP origin trial、
// ChatGPT 桌面版 site tools 等）直接调用，而无需截图或解析 DOM。
//
// 工具命名遵循规范约束: 1-128 个字符，仅限 ASCII 字母数字与 _ - .
// 只读工具带 annotations.readOnlyHint（代理可将其标记为无需确认的安全操作）；
// 返回内容可能来自导入的外部文件的工具另带 untrustedContentHint，提示代理
// 将其视为数据而非指令（规范 §6.3.1.2 输出注入攻击的缓解措施）。
// 不支持 WebMCP 的浏览器中静默跳过注册，不影响编辑器本身。

import type { SceneDocument, SceneElement, ShapeType, SourceType, TextBoxSettings } from "./App";

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
  type: ShapeType;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  color?: string;
  opacity?: number;
  name?: string;
  textBox?: Partial<TextBoxSettings>;
};

export type EditorBridge = {
  getScene(): SceneDocument;
  addElement(input: AddElementInput): { ok: boolean; error?: string; element?: SceneElement };
  updateElement(
    id: string,
    patch: Partial<SceneElement>
  ): { ok: boolean; error?: string };
  removeElement(id: string): { ok: boolean; error?: string };
  setCanvas(patch: {
    width?: number;
    height?: number;
    background?: string;
  }): { ok: boolean; error?: string };
  clearCanvas(): { ok: boolean };
  importSource(
    sourceType: SourceType,
    content: string,
    name?: string
  ): Promise<{ ok: boolean; error?: string; warnings?: string[] }>;
  exportScene(format: "css" | "svg" | "json"): Promise<string>;
  getCanvasPreview(
    maxSize: number
  ): Promise<{ ok: boolean; dataUrl?: string; width?: number; height?: number; error?: string }>;
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
  "textbox"
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
                return await run(bridge, args ?? {});
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
        "Get the full scene document (JSON) of the Miliastra image editor canvas, including canvas size, background color, and all elements. Element positions are center coordinates and rotation is counter-clockwise positive.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: { type: "object", properties: {} }
    },
    (bridge) => bridge.getScene()
  );

  register(
    {
      name: "list_elements",
      title: "List elements",
      description:
        "List a summary of every element in the current scene, sorted by zIndex from bottom to top. Each entry includes id, name, shape type, center coordinates, width, height, rotation, color, opacity, zIndex, and textBox when the element is a textbox.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: { type: "object", properties: {} }
    },
    (bridge) => {
      const scene = bridge.getScene();
      return {
        canvas: scene.canvas,
        count: scene.elements.length,
        elements: [...scene.elements]
          .sort((a, b) => a.zIndex - b.zIndex)
          .map((element) => ({
            id: element.id,
            name: element.name,
            type: element.type,
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            rotation: element.rotation,
            color: element.color,
            opacity: element.opacity,
            zIndex: element.zIndex,
            isBackground: element.isBackground,
            ...(element.type === "textbox" ? { textBox: element.textBox } : {})
          }))
      };
    }
  );

  register(
    {
      name: "add_element",
      title: "Add element",
      description:
        "Add a basic shape or textbox element to the canvas (ellipse / rectangle / triangle / four_point_star / five_point_star / ring / textbox). x and y are the element center coordinates; if omitted the element is placed at the canvas center. Returns the full data of the new element.",
      inputSchema: {
        type: "object",
        required: ["type"],
        properties: {
          type: shapeEnum,
          x: numberProp("Element center X coordinate (canvas coordinates, origin at top-left)"),
          y: numberProp("Element center Y coordinate (canvas coordinates, origin at top-left)"),
          width: numberProp("Width in pixels (4-2048)", 4, 2048),
          height: numberProp("Height in pixels (4-2048)", 4, 2048),
          rotation: numberProp("Rotation in degrees (counter-clockwise positive, -360 to 360)", -360, 360),
          color: {
            type: "string",
            description: "Hex color, e.g. #0f766e"
          },
          opacity: numberProp("Opacity (0-1)", 0, 1),
          name: {
            type: "string",
            description: "Display name of the element; defaults to the shape's default name"
          },
          text: {
            type: "string",
            description: "Text content when type is textbox"
          },
          fontSize: numberProp("Font size in pixels when type is textbox (1-256)", 1, 256)
        }
      }
    },
    (bridge, args) => {
      const type = args.type as ShapeType | undefined;
      if (!type || !SHAPE_TYPES.includes(type)) {
        return err(`type must be one of ${SHAPE_TYPES.join(" / ")}`);
      }
      const textBox =
        type === "textbox"
          ? {
              ...(typeof args.text === "string" ? { text: args.text } : {}),
              ...(typeof args.fontSize === "number" ? { fontSize: args.fontSize } : {})
            }
          : undefined;
      return bridge.addElement({
        type,
        x: typeof args.x === "number" ? args.x : undefined,
        y: typeof args.y === "number" ? args.y : undefined,
        width: typeof args.width === "number" ? args.width : undefined,
        height: typeof args.height === "number" ? args.height : undefined,
        rotation: typeof args.rotation === "number" ? args.rotation : undefined,
        color: typeof args.color === "string" ? args.color : undefined,
        opacity: typeof args.opacity === "number" ? args.opacity : undefined,
        name: typeof args.name === "string" ? args.name : undefined,
        textBox: textBox && Object.keys(textBox).length ? textBox : undefined
      });
    }
  );

  register(
    {
      name: "update_element",
      title: "Update element",
      description:
        "Update properties of the element with the given id (pass only the fields to change): name, center coordinates, width, height, rotation, color, opacity. For textboxes also text and fontSize.",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", description: "Target element id (obtainable via list_elements)" },
          name: { type: "string", description: "Display name of the element" },
          x: numberProp("Element center X coordinate"),
          y: numberProp("Element center Y coordinate"),
          width: numberProp("Width in pixels (4-2048)", 4, 2048),
          height: numberProp("Height in pixels (4-2048)", 4, 2048),
          rotation: numberProp("Rotation in degrees (counter-clockwise positive, -360 to 360)", -360, 360),
          color: { type: "string", description: "Hex color, e.g. #be123c" },
          opacity: numberProp("Opacity (0-1)", 0, 1),
          text: { type: "string", description: "Text content when the target is a textbox" },
          fontSize: numberProp("Font size in pixels when the target is a textbox (1-256)", 1, 256)
        }
      }
    },
    (bridge, args) => {
      const id = typeof args.id === "string" ? args.id : "";
      if (!id) {
        return err("Missing element id");
      }
      const patch: Record<string, unknown> = {};
      for (const key of [
        "name",
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "color",
        "opacity"
      ] as const) {
        const value = args[key];
        if (
          (key === "name" || key === "color") &&
          typeof value === "string"
        ) {
          patch[key] = value;
        } else if (
          key !== "name" &&
          key !== "color" &&
          typeof value === "number" &&
          Number.isFinite(value)
        ) {
          patch[key] = value;
        }
      }
      const textBoxPatch: Record<string, unknown> = {};
      if (typeof args.text === "string") {
        textBoxPatch.text = args.text;
      }
      if (typeof args.fontSize === "number" && Number.isFinite(args.fontSize)) {
        textBoxPatch.fontSize = args.fontSize;
      }
      if (Object.keys(textBoxPatch).length) {
        patch.textBox = textBoxPatch;
      }
      if (Object.keys(patch).length === 0) {
        return err("No updatable fields provided");
      }
      return bridge.updateElement(id, patch as Partial<SceneElement>);
    }
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
      return bridge.removeElement(id);
    }
  );

  register(
    {
      name: "set_canvas",
      title: "Set canvas",
      description: "Update the canvas size (pixels, 1-2048) and background color (hex).",
      inputSchema: {
        type: "object",
        properties: {
          width: numberProp("Canvas width in pixels (1-2048)", 1, 2048),
          height: numberProp("Canvas height in pixels (1-2048)", 1, 2048),
          background: { type: "string", description: "Background color, e.g. #ffffff" }
        }
      }
    },
    (bridge, args) => {
      const patch: { width?: number; height?: number; background?: string } = {};
      if (typeof args.width === "number" && Number.isFinite(args.width)) {
        patch.width = args.width;
      }
      if (typeof args.height === "number" && Number.isFinite(args.height)) {
        patch.height = args.height;
      }
      if (typeof args.background === "string") {
        patch.background = args.background;
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
        "Parse and import CSS / JSON / SVG source content into the canvas (replaces the current scene, undoable). CSS must follow the Miliastra Primitive Shaper style conventions; SVG supports basic shapes only.",
      annotations: { untrustedContentHint: true },
      inputSchema: {
        type: "object",
        required: ["sourceType", "content"],
        properties: {
          sourceType: {
            type: "string",
            enum: ["css", "json", "svg"],
            description: "Format of the source content"
          },
          content: { type: "string", description: "Full text content of the source file" },
          name: { type: "string", description: "Source name (optional, used for metadata)" }
        }
      }
    },
    (bridge, args) => {
      const sourceType = args.sourceType as SourceType | undefined;
      if (sourceType !== "css" && sourceType !== "json" && sourceType !== "svg") {
        return err("sourceType must be one of css / json / svg");
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
        "Export the current scene as text and return its content: css (web styles) / svg (vector; unsupported rings are dropped automatically) / json (scene source data). For the binary GIA format use the in-app export button.",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        required: ["format"],
        properties: {
          format: {
            type: "string",
            enum: ["css", "svg", "json"],
            description: "Export format"
          }
        }
      }
    },
    async (bridge, args) => {
      const format = args.format as "css" | "svg" | "json" | undefined;
      if (format !== "css" && format !== "svg" && format !== "json") {
        return err("format must be one of css / svg / json");
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
        "Get a PNG snapshot of the current canvas (base64 data URL) to visually inspect the layout. Useful after add/update/remove operations to verify the visual result. maxSize limits the longest edge in pixels to control payload size (default 512, min 128, max 2048).",
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      inputSchema: {
        type: "object",
        properties: {
          maxSize: numberProp("Max longest edge of the snapshot in pixels (128-2048, default 512)", 128, 2048)
        }
      }
    },
    async (bridge, args) => {
      const raw = typeof args.maxSize === "number" ? args.maxSize : 512;
      const maxSize = clamp(Math.round(raw) || 512, 128, 2048);
      return bridge.getCanvasPreview(maxSize);
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
      console.info("[WebMCP] Miliastra image editor tools registered (12)");
    },
    () => {
      /* 单个工具注册失败已在上方记录，无需额外处理 */
    }
  );

  return () => {
    controller.abort();
  };
}
