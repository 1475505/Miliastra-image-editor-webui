export type LuaFillType = "unused" | "horizontal" | "vertical" | "radial90" | "radial180" | "radial360";
export type LuaFillHorizontalType = "left" | "right";
export type LuaFillVerticalType = "bottom" | "top";
export type LuaFillRadial90Type = "bottomLeft" | "topLeft" | "topRight" | "bottomRight";
export type LuaFillRadialType = "bottom" | "left" | "top" | "right";

export type LuaMask = {
  enabled: boolean;
  imageId: number;
  imageType: "basic" | "stretch" | null;
  offsetX: number;
  offsetY: number;
  width: number | null;
  height: number | null;
  reverseMaskArea: boolean;
  enableSoftEdge: boolean;
  softEdgeMode: "Pixel" | "Percentage";
  softEdgeWidthX: number;
  softEdgeWidthY: number;
  horizontalSoftRange: number;
  verticalSoftRange: number;
  enableFill: boolean;
  fillType: LuaFillType;
  fillHorizontalType: LuaFillHorizontalType;
  fillVerticalType: LuaFillVerticalType;
  fillRadial90Type: LuaFillRadial90Type;
  fillRadialType: LuaFillRadialType;
  fillAmount: number;
};

// Product defaults, not an assertion about all native template defaults.
export const DEFAULT_LUA_MASK: LuaMask = {
  enabled: false, imageId: 100001, imageType: null, offsetX: 0, offsetY: 0, width: null, height: null,
  reverseMaskArea: false, enableSoftEdge: false, softEdgeMode: "Pixel",
  softEdgeWidthX: 0, softEdgeWidthY: 0, horizontalSoftRange: 85, verticalSoftRange: 85,
  // 容器节点 GIA 样本的默认起点是「上」，这里保持同一默认，避免未写方向字段时不一致。
  enableFill: false, fillType: "horizontal", fillHorizontalType: "left", fillVerticalType: "top",
  fillRadial90Type: "bottomLeft", fillRadialType: "top", fillAmount: 0.5
};

/** 填充已配置（不管是否启用）；数据层判断用。 */
export function fillConfigured(mask?: Partial<LuaMask> | null): boolean {
  return Boolean(mask?.enableFill) && (mask?.fillType ?? "horizontal") !== "unused";
}

/** 「启用蒙版」是整个分区的生效开关：羽化与填充也随它生效并导出。 */
export function fillActive(mask?: Partial<LuaMask> | null): boolean {
  return Boolean(mask?.enabled) && fillConfigured(mask);
}

export function luaMaskActive(mask?: Partial<LuaMask> | null): boolean {
  return Boolean(mask?.enabled);
}

/** 未启用时，配置偏离默认（可能有可见效果）才进入选中图元的编辑预览。 */
export function maskPreviewable(mask?: Partial<LuaMask> | null): boolean {
  const value = { ...DEFAULT_LUA_MASK, ...mask };
  return value.imageId !== DEFAULT_LUA_MASK.imageId || value.imageType !== null
    || value.offsetX !== 0 || value.offsetY !== 0 || value.width !== null || value.height !== null
    || value.reverseMaskArea || value.enableSoftEdge || fillConfigured(value);
}

export function parseLuaMaskPatch(value: unknown): Partial<LuaMask> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || !value) throw new Error("luaMask must be an object or null");
  for (const [key, item] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LUA_MASK, key)) throw new Error(`Unknown luaMask field: ${key}`);
    if (["enabled", "reverseMaskArea", "enableSoftEdge", "enableFill"].includes(key)) {
      if (typeof item !== "boolean") throw new Error(`${key} must be boolean`);
    } else if (key === "imageId") {
      if (typeof item !== "number" || !Number.isInteger(item) || item <= 0 || item > 0x7fffffff) throw new Error("imageId must be an integer from 1 to 2147483647");
    } else if (key === "imageType") {
      if (item !== null && item !== "basic" && item !== "stretch") throw new Error("imageType must be basic, stretch or null");
    } else if (key === "softEdgeMode") {
      if (item !== "Pixel" && item !== "Percentage") throw new Error("softEdgeMode must be Pixel or Percentage");
    } else if (key === "fillType") {
      if (!["unused", "horizontal", "vertical", "radial90", "radial180", "radial360"].includes(item as string)) throw new Error("fillType is invalid");
    } else if (key === "fillHorizontalType") {
      if (item !== "left" && item !== "right") throw new Error("fillHorizontalType must be left or right");
    } else if (key === "fillVerticalType") {
      if (item !== "bottom" && item !== "top") throw new Error("fillVerticalType must be bottom or top");
    } else if (key === "fillRadial90Type") {
      if (!["bottomLeft", "topLeft", "topRight", "bottomRight"].includes(item as string)) throw new Error("fillRadial90Type is invalid");
    } else if (key === "fillRadialType") {
      if (!["bottom", "left", "top", "right"].includes(item as string)) throw new Error("fillRadialType is invalid");
    } else {
      const size = key === "width" || key === "height";
      if (size && item === null) continue;
      if (typeof item !== "number" || !Number.isFinite(item) || (size && item < 0)) throw new Error(`Invalid luaMask ${key}`);
      if (key === "fillAmount" && (item < 0 || item > 1)) throw new Error("fillAmount must be between 0 and 1");
    }
  }
  return { ...value };
}

export function luaMaskOf(value?: Partial<LuaMask> | null): LuaMask {
  return { ...DEFAULT_LUA_MASK, ...parseLuaMaskPatch(value ?? null) };
}

export function scaleLuaMask(value: LuaMask, factor: number): LuaMask {
  return { ...value, offsetX: value.offsetX * factor, offsetY: value.offsetY * factor,
    width: value.width === null ? null : value.width * factor,
    height: value.height === null ? null : value.height * factor,
    // Percentage/range units are not inferred; preserve their native values.
    softEdgeWidthX: value.softEdgeMode === "Pixel" ? value.softEdgeWidthX * factor : value.softEdgeWidthX,
    softEdgeWidthY: value.softEdgeMode === "Pixel" ? value.softEdgeWidthY * factor : value.softEdgeWidthY };
}
