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
};

// Product defaults, not an assertion about all native template defaults.
export const DEFAULT_LUA_MASK: LuaMask = {
  enabled: false, imageId: 100001, imageType: null, offsetX: 0, offsetY: 0, width: null, height: null,
  reverseMaskArea: false, enableSoftEdge: false, softEdgeMode: "Pixel",
  softEdgeWidthX: 0, softEdgeWidthY: 0, horizontalSoftRange: 85, verticalSoftRange: 85
};

export function luaMaskActive(mask?: Partial<LuaMask> | null): boolean {
  return Boolean(mask?.enabled || mask?.enableSoftEdge);
}

export function parseLuaMaskPatch(value: unknown): Partial<LuaMask> | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || !value) throw new Error("luaMask must be an object or null");
  for (const [key, item] of Object.entries(value)) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_LUA_MASK, key)) throw new Error(`Unknown luaMask field: ${key}`);
    if (["enabled", "reverseMaskArea", "enableSoftEdge"].includes(key)) {
      if (typeof item !== "boolean") throw new Error(`${key} must be boolean`);
    } else if (key === "imageId") {
      if (typeof item !== "number" || !Number.isInteger(item) || item <= 0 || item > 0x7fffffff) throw new Error("imageId must be an integer from 1 to 2147483647");
    } else if (key === "imageType") {
      if (item !== null && item !== "basic" && item !== "stretch") throw new Error("imageType must be basic, stretch or null");
    } else if (key === "softEdgeMode") {
      if (item !== "Pixel" && item !== "Percentage") throw new Error("softEdgeMode must be Pixel or Percentage");
    } else {
      const size = key === "width" || key === "height";
      if (size && item === null) continue;
      if (typeof item !== "number" || !Number.isFinite(item) || (size && item < 0)) throw new Error(`Invalid luaMask ${key}`);
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
