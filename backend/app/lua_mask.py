"""Lua-only per-element image masks; no inferred percentage conversion."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, field_validator


class LuaMaskModel(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    enabled: StrictBool = False
    imageId: StrictInt = Field(default=100001, gt=0, le=0x7FFFFFFF)
    imageType: Literal["basic", "stretch"] | None = None
    offsetX: float = 0
    offsetY: float = 0
    width: float | None = Field(default=None, ge=0)
    height: float | None = Field(default=None, ge=0)
    reverseMaskArea: StrictBool = False
    enableSoftEdge: StrictBool = False
    softEdgeMode: Literal["Pixel", "Percentage"] = "Pixel"
    softEdgeWidthX: float = 0
    softEdgeWidthY: float = 0
    horizontalSoftRange: float = 85
    verticalSoftRange: float = 85

    @field_validator("offsetX", "offsetY", "width", "height", "softEdgeWidthX", "softEdgeWidthY",
                     "horizontalSoftRange", "verticalSoftRange", mode="before")
    @classmethod
    def numeric(cls, value, info):
        if value is None and info.field_name in ("width", "height"):
            return value
        if type(value) not in (int, float):
            raise ValueError("Mask values must be numbers")
        return value


def mask_active(mask) -> bool:
    if mask is None:
        return False
    if isinstance(mask, dict):
        return bool(mask.get("enabled") or mask.get("enableSoftEdge"))
    return mask.enabled or mask.enableSoftEdge


def validate_mask(value):
    result = LuaMaskModel.model_validate(value).model_dump()
    # Keep the old literal-table digest unchanged when loading older mask Lua.
    # Scene validation later adds the default without invalidating its metadata.
    if "imageId" not in value:
        result.pop("imageId")
    # None means leave the native type unchanged, and is omitted by Lua export.
    if result["imageType"] is None:
        result.pop("imageType")
    return result


# The wrapper is axis-aligned in the artwork's coordinate system. Content keeps
# its existing rotation/scale; anchors and sizeDelta are compensated algebraically
# so changing the wrapper size cannot re-layout the source control.
RUNTIME = '''
local maskImageTypeWarnings = {}

local function CreateMask(entry, parent, centerX, centerY, contentWidth, contentHeight)
    if entry == nil or not (entry.enabled or entry.enableSoftEdge) then return nil end
    local mask = game.InstantiateClientUIControl(IMAGE_PREFAB_ID, parent)
    if mask == nil then error("蒙版图片模板无法实例化") end
    table.insert(created, mask)
    mask:SetVisible(false)
    local imageId = entry.imageId or 100001
    if type(imageId) ~= "number" or imageId % 1 ~= 0 or imageId <= 0 or imageId > 2147483647 then
        error("无效的蒙版图片 ID")
    end
    mask:SetImage(Enum.ImageSource.StaticReference, imageId)
    if mask.imageId ~= imageId or mask.imageSource ~= Enum.ImageSource.StaticReference then
        error("蒙版图片资源绑定失败")
    end
    if entry.imageType ~= nil then
        if entry.imageType ~= "basic" and entry.imageType ~= "stretch" then
            error("无效的蒙版图片类型")
        end
        -- imageType is conditional: bind the resource before attempting a write.
        local requestedType = entry.imageType == "stretch" and Enum.ImageType.Stretch or Enum.ImageType.Basic
        local ok, applied = pcall(function()
            mask.imageType = requestedType
            return mask.imageType == requestedType
        end)
        if not ok or not applied then
            local key = tostring(imageId) .. ":" .. entry.imageType
            if not maskImageTypeWarnings[key] then
                maskImageTypeWarnings[key] = true
                print("[图片绘制] 蒙版图片 " .. tostring(imageId) .. " 未能应用图片类型 " .. entry.imageType .. "，继续使用当前类型。")
            end
        end
    end
    mask.name = "__lua_mask"
    mask:SetAnchorMin(0.5, 0.5)
    mask:SetAnchorMax(0.5, 0.5)
    mask:SetPivot(0.5, 0.5)
    local w = entry.width or contentWidth
    local h = entry.height or contentHeight
    mask:SetSizeDelta(w, h)
    mask:SetLocalScale(1, 1, 1)
    mask:SetLocalRotation(0, 0, 0)
    local x = centerX + entry.offsetX
    local y = centerY - entry.offsetY
    mask:SetAnchoredPosition(x, y)
    mask.imageColor = Color.FromRGBA(255, 255, 255, 0)
    mask:SetFillUnused()
    mask.enableMask = true
    mask.enableSoftEdge = entry.enableSoftEdge
    mask.softEdgeMode = Enum.ImageMaskSoftEdgeMode[entry.softEdgeMode]
    mask:SetSoftEdgeWidth(entry.softEdgeWidthX, entry.softEdgeWidthY)
    mask.horizontalSoftRange = entry.horizontalSoftRange
    mask.verticalSoftRange = entry.verticalSoftRange
    mask.reverseMaskArea = entry.reverseMaskArea
    mask:SetActive(true)
    mask:SetAsLastSibling()
    return {control=mask, width=w, height=h, x=x, y=y}
end

local function FitMaskedContent(control, frame, width, height, x, y, minX, minY, maxX, maxY, pivotX, pivotY)
    if frame == nil then return end
    control:SetSizeDelta(width + (ROOT[3] - frame.width) * (maxX - minX),
        height + (ROOT[4] - frame.height) * (maxY - minY))
    control:SetAnchoredPosition(x - frame.x + (ROOT[3] - frame.width) * (minX + (maxX - minX) * pivotX - 0.5),
        y - frame.y + (ROOT[4] - frame.height) * (minY + (maxY - minY) * pivotY - 0.5))
    frame.control:SetVisible(true)
end

local function MaskFrame(entry, parent, w, h, x, y, minX, minY, maxX, maxY, px, py, sx, sy, rx, ry, rz)
    if entry == nil or not (entry.enabled or entry.enableSoftEdge) then return nil end
    local width = w + ROOT[3] * (maxX - minX)
    local height = h + ROOT[4] * (maxY - minY)
    local dx, dy = (0.5 - px) * width * sx, (0.5 - py) * height * sy
    local cx, tx = math.cos(math.rad(rx)), math.sin(math.rad(rx))
    local cy, ty = math.cos(math.rad(ry)), math.sin(math.rad(ry))
    local cz, tz = math.cos(math.rad(rz)), math.sin(math.rad(rz))
    -- Existing editor orthographic Z-X-Y projection, converted to UI Y-up.
    local ox = (cy * cz + ty * tx * tz) * dx + (-cy * tz + ty * tx * cz) * dy
    local oy = cx * tz * dx + cx * cz * dy
    local centerX = x + ROOT[3] * (minX + (maxX - minX) * px - 0.5) + ox
    local centerY = y + ROOT[4] * (minY + (maxY - minY) * py - 0.5) + oy
    return CreateMask(entry, parent, centerX, centerY, math.abs(width * sx), math.abs(height * sy))
end
'''
