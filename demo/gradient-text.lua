-- 双色渐变字：底色文字 + 透明羽化蒙版中的顶色文字，共 3 个控件（宿主另计）。
-- 使用前填写下方 IMAGE_PREFAB_ID 和 TEXTBOX_PREFAB_ID；0 表示尚未配置，不是真机索引。
-- 把本脚本映射并挂到专用空客户端容器节点；不要挂到被实例化的模板上。
-- 导入本文件或配套 gradient-text.json 可在拼图工具继续编辑。
-- 两份文字必须保持文案、字号、尺寸、对齐和最终位置一致。
-- 顶层蒙版：相对文字中心左边界=-150、右边界=770，X 羽化宽度=300，Y=0。
-- 只让左侧羽化穿过字面，右侧羽化移到字面以外；精确渐变曲线未作真机标定。

-- 双色渐变字：图片与文本 Lua 绘制脚本
-- 挂到专用空客户端容器，OnStart 绘制；模板设为仅存为模板。
local IMAGE_PREFAB_ID = 0 -- 图片控件模板索引ID；无图片且未启用蒙版/羽化时无需填写
local TEXTBOX_PREFAB_ID = 0 -- 必填：文本框控件模板索引ID
-- 字号自适应由每个文本框的 autoSize 显式设置，默认开启；minFontSize 为最小字号。
local BASE_SCALE = 1
local OFFSET_X = 0
local OFFSET_Y = 0
local ROOT = {0,0,800.0,360.0,0.5,0.5,0.5,0.5,0.5,0.5,1,1,0}
local ELEMENTS = {
}
-- 蒙版和羽化仅 Lua 可用；四个羽化数值原样传入，不换算百分比。
local IMAGE_MASKS = {}
local TEXT_MASKS = {{["enabled"]=false,["offsetX"]=0,["offsetY"]=0,["reverseMaskArea"]=false,["enableSoftEdge"]=false,["softEdgeMode"]="Pixel",["softEdgeWidthX"]=0,["softEdgeWidthY"]=0,["horizontalSoftRange"]=85,["verticalSoftRange"]=85},{["enabled"]=true,["offsetX"]=310.0,["offsetY"]=0.0,["width"]=920.0,["height"]=220.0,["reverseMaskArea"]=false,["enableSoftEdge"]=true,["softEdgeMode"]="Pixel",["softEdgeWidthX"]=300.0,["softEdgeWidthY"]=0.0,["horizontalSoftRange"]=85.0,["verticalSoftRange"]=85.0}}
-- 文本框数据：位置使用编辑器画布坐标，textBox 保存完整文字与样式。
local TEXTBOXES = {
    {["name"]="底色文字 · 蓝",["x"]=400.0,["y"]=180.0,["width"]=560.0,["height"]=130.0,["rotation"]=0.0,["textBox"]={["text"]="星间来信",["fontSize"]=72,["autoSize"]=false,["minFontSize"]=72,["textColor"]="#6f9aff",["textOpacity"]=1.0,["bgColor"]="#ffffff",["bgOpacity"]=0.0,["outlineEnabled"]=false,["outlineColor"]="#333333",["outlineOpacity"]=0.0,["alignH"]="center",["alignV"]="middle",["anchorType"]="center",["visible"]=true,["scaleX"]=1.0,["scaleY"]=1.0,["anchorMinX"]=0.5,["anchorMinY"]=0.5,["anchorMaxX"]=0.5,["anchorMaxY"]=0.5,["pivotX"]=0.5,["pivotY"]=0.5}},
    {["name"]="渐入文字 · 金",["x"]=400.0,["y"]=180.0,["width"]=560.0,["height"]=130.0,["rotation"]=0.0,["textBox"]={["text"]="星间来信",["fontSize"]=72,["autoSize"]=false,["minFontSize"]=72,["textColor"]="#f5d49c",["textOpacity"]=1.0,["bgColor"]="#ffffff",["bgOpacity"]=0.0,["outlineEnabled"]=false,["outlineColor"]="#333333",["outlineOpacity"]=0.0,["alignH"]="center",["alignV"]="middle",["anchorType"]="center",["visible"]=true,["scaleX"]=1.0,["scaleY"]=1.0,["anchorMinX"]=0.5,["anchorMinY"]=0.5,["anchorMaxX"]=0.5,["anchorMaxY"]=0.5,["pivotX"]=0.5,["pivotY"]=0.5}},
}
-- {1,图片序号} / {2,文本框序号}，从背景到前景绘制。
local DRAW_ORDER = {
    {2,1},
    {2,2},
}
local ALIGN_H = {left=Enum.TextHorizontalAlignment.Left, center=Enum.TextHorizontalAlignment.Middle, right=Enum.TextHorizontalAlignment.Right}
local ALIGN_V = {top=Enum.TextVerticalAlignment.Top, middle=Enum.TextVerticalAlignment.Middle, bottom=Enum.TextVerticalAlignment.Bottom}
local function TextColor(hex, opacity)
    return Color.FromRGBA(tonumber(string.sub(hex, 2, 3), 16), tonumber(string.sub(hex, 4, 5), 16), tonumber(string.sub(hex, 6, 7), 16), math.floor(opacity * 255))
end

local created = {}

local function CreateMask(entry, parent, centerX, centerY, contentWidth, contentHeight)
    if entry == nil or not (entry.enabled or entry.enableSoftEdge) then return nil end
    local mask = game.InstantiateClientUIControl(IMAGE_PREFAB_ID, parent)
    if mask == nil then error("蒙版图片模板无法实例化") end
    table.insert(created, mask)
    mask:SetVisible(false)
    mask:SetImage(Enum.ImageSource.StaticReference, 100001)
    if mask.imageId ~= 100001 or mask.imageSource ~= Enum.ImageSource.StaticReference then
        error("蒙版图片资源绑定失败")
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

local function Clear()
    for i = #created, 1, -1 do
        if created[i].alive then game.DestroyClientUIControl(created[i]) end
    end
    created = {}
end

local building = false
local function Build()
    Clear()
    if true and (type(IMAGE_PREFAB_ID) ~= "number" or IMAGE_PREFAB_ID <= 0 or IMAGE_PREFAB_ID % 1 ~= 0) then
        printerr("[图片绘制] 请填写 IMAGE_PREFAB_ID：客户端图片控件模板索引ID")
        return
    end
    if type(TEXTBOX_PREFAB_ID) ~= "number" or TEXTBOX_PREFAB_ID <= 0 or TEXTBOX_PREFAB_ID % 1 ~= 0 then
        printerr("[图片绘制] 请填写 TEXTBOX_PREFAB_ID：客户端文本框控件模板索引ID")
        return
    end
    local parent = script.object
    if parent == nil then return end
    parent:SetAnchorMin(0.5, 0.5)
    parent:SetAnchorMax(0.5, 0.5)
    parent:SetPivot(ROOT[5], ROOT[6])
    parent:SetSizeDelta(ROOT[3], ROOT[4])
    parent:SetLocalScale(ROOT[11] * BASE_SCALE, ROOT[12] * BASE_SCALE, 1)
    parent:SetLocalRotation(0, 0, ROOT[13])
    parent:SetAnchoredPosition(OFFSET_X, OFFSET_Y)
    local ok, err = pcall(function()
        for _, entry in ipairs(DRAW_ORDER) do
            local index = entry[2]
            if entry[1] == 2 then
                local item = TEXTBOXES[index]
                local box = item.textBox
                local frame = MaskFrame(TEXT_MASKS[index], parent, item.width, item.height,
                    item.x - ROOT[3] / 2, ROOT[4] / 2 - item.y,
                    box.anchorMinX, box.anchorMinY, box.anchorMaxX, box.anchorMaxY, box.pivotX, box.pivotY,
                    box.scaleX, box.scaleY, item.rotationX or 0, item.rotationY or 0, item.rotation)
                local text = game.InstantiateClientUIControl(TEXTBOX_PREFAB_ID, frame and frame.control or parent)
                if text == nil then error("文本框模板无法实例化，请确认已设为仅存为模板") end
                table.insert(created, text)
                text.name = item.name
                text:SetAnchorMin(box.anchorMinX, box.anchorMinY)
                text:SetAnchorMax(box.anchorMaxX, box.anchorMaxY)
                text:SetPivot(box.pivotX, box.pivotY)
                text:SetSizeDelta(item.width, item.height)
                text:SetLocalScale(box.scaleX, box.scaleY, 1)
                text:SetLocalRotation(item.rotationX or 0, item.rotationY or 0, item.rotation)
                text:SetAnchoredPosition(item.x - ROOT[3] / 2, ROOT[4] / 2 - item.y)
                text.fontSize = box.fontSize
                text.minimumFontSize = box.minFontSize
                text.adaptiveFontSize = box.autoSize
                text.fontColor = TextColor(box.textColor, box.textOpacity)
                text.bgColor = TextColor(box.bgColor, box.bgOpacity)
                text.enableOutline = box.outlineEnabled
                text.outlineColor = TextColor(box.outlineColor, box.outlineOpacity)
                text.horizontalAlignment = ALIGN_H[box.alignH]
                text.verticalAlignment = ALIGN_V[box.alignV]
                text.text = box.text
                FitMaskedContent(text, frame, item.width, item.height,
                    item.x - ROOT[3] / 2, ROOT[4] / 2 - item.y,
                    box.anchorMinX, box.anchorMinY, box.anchorMaxX, box.anchorMaxY, box.pivotX, box.pivotY)
                text:SetActive(true)
                text:SetVisible(box.visible)
                text:SetAsLastSibling()
            else
                local item = ELEMENTS[index]
                local frame = MaskFrame(IMAGE_MASKS[index], parent, item[4], item[5], item[2], item[3],
                    item[8], item[9], item[10], item[11], item[6], item[7], item[12], item[13], 0, 0, item[14])
                local image = game.InstantiateClientUIControl(IMAGE_PREFAB_ID, frame and frame.control or parent)
                if image == nil then error("图片模板无法实例化，请确认已设为仅存为模板") end
                table.insert(created, image)
                image:SetImage(Enum.ImageSource.StaticReference, item[1])
                -- imageType 仅部分图片支持，保留不支持该属性的静态图片。
                pcall(function() image.imageType = Enum.ImageType.Stretch end)
                image:SetAnchorMin(item[8], item[9])
                image:SetAnchorMax(item[10], item[11])
                image:SetPivot(item[6], item[7])
                image:SetSizeDelta(item[4], item[5])
                image:SetLocalScale(item[12], item[13], 1)
                image:SetLocalRotation(0, 0, item[14])
                image:SetAnchoredPosition(item[2], item[3])
                image.imageColor = Color.FromRGBA(item[15], item[16], item[17], item[18])
                image.enableMask, image.enableSoftEdge, image.reverseMaskArea = false, false, false
                image:SetFillUnused()
                FitMaskedContent(image, frame, item[4], item[5], item[2], item[3],
                    item[8], item[9], item[10], item[11], item[6], item[7])
                image:SetActive(true)
                image:SetVisible(true)
                image:SetAsLastSibling()
            end
        end
    end)
    if not ok then
        Clear()
        printerr("[图片绘制] " .. tostring(err))
    end
end

function OnDestroy()
    created = {} -- 宿主销毁负责回收子树，不重复 Destroy。
end

function OnStart()
    if building then return end
    building = true
    local ok, err = xpcall(Build, debug.traceback)
    building = false
    if not ok then
        local cleanupOk, cleanupErr = pcall(Clear)
        printerr("[图片绘制] " .. tostring(err) .. (cleanupOk and "" or (" | cleanup: " .. tostring(cleanupErr))))
    end
end

-- 编辑器回导数据：保留图元名称、文本框与素材库，请勿删除。
-- MILIASTRA_EDITOR_SCENE_V1 eyJ2ZXJzaW9uIjoxLCJkcmF3aW5nSGFzaCI6IjY2MjdmMmEwZWNkNWEyNjlmZjQ1ZjYyZDBiNmYzYTMzYzkwNzY3M2Y1ZjAzZWJlZjcwZDAzZGM2N2Q2YTgyZjAiLCJzY2VuZSI6eyJjYW52YXMiOnsid2lkdGgiOjgwMC4wLCJoZWlnaHQiOjM2MC4wLCJiYWNrZ3JvdW5kIjoidHJhbnNwYXJlbnQiLCJtYXNrIjp7IngiOjAuMCwieSI6MC4wLCJ3aWR0aCI6bnVsbCwiaGVpZ2h0IjpudWxsLCJzaGFwZVR5cGUiOjEsImVuYWJsZWQiOnRydWUsInByZXZpZXdPbkNhbnZhcyI6ZmFsc2V9fSwiZWxlbWVudHMiOlt7ImlkIjoiZ3JhZGllbnQtYmFzZSIsIm5hbWUiOiLlupXoibLmloflrZcgwrcg6JOdIiwidHlwZSI6InRleHRib3giLCJ4Ijo0MDAuMCwieSI6MTgwLjAsIndpZHRoIjo1NjAuMCwiaGVpZ2h0IjoxMzAuMCwicm90YXRpb24iOjAuMCwicm90YXRpb25YIjowLjAsInJvdGF0aW9uWSI6MC4wLCJjb2xvciI6IiM2ZjlhZmYiLCJvcGFjaXR5IjoxLjAsInpJbmRleCI6MCwiaXNCYWNrZ3JvdW5kIjpmYWxzZSwidGV4dEJveCI6eyJ0ZXh0Ijoi5pif6Ze05p2l5L+hIiwiZm9udFNpemUiOjcyLCJhdXRvU2l6ZSI6ZmFsc2UsIm1pbkZvbnRTaXplIjo3MiwidGV4dENvbG9yIjoiIzZmOWFmZiIsInRleHRPcGFjaXR5IjoxLjAsImJnQ29sb3IiOiIjZmZmZmZmIiwiYmdPcGFjaXR5IjowLjAsIm91dGxpbmVFbmFibGVkIjpmYWxzZSwib3V0bGluZUNvbG9yIjoiIzMzMzMzMyIsIm91dGxpbmVPcGFjaXR5IjowLjAsImFsaWduSCI6ImNlbnRlciIsImFsaWduViI6Im1pZGRsZSIsImFuY2hvclR5cGUiOiJjZW50ZXIiLCJ2aXNpYmxlIjp0cnVlLCJzY2FsZVgiOjEuMCwic2NhbGVZIjoxLjAsImFuY2hvck1pblgiOjAuNSwiYW5jaG9yTWluWSI6MC41LCJhbmNob3JNYXhYIjowLjUsImFuY2hvck1heFkiOjAuNSwicGl2b3RYIjowLjUsInBpdm90WSI6MC41fSwiaW1hZ2VBc3NldElkIjpudWxsLCJpbWFnZVRpbnQiOmZhbHNlLCJpbWFnZVR5cGUiOiJiYXNpYyIsInByZWZhYklkIjpudWxsLCJwcmVmYWJWYXJpYWJsZSI6bnVsbCwibHVhTWFzayI6bnVsbH0seyJpZCI6ImdyYWRpZW50LXRvcCIsIm5hbWUiOiLmuJDlhaXmloflrZcgwrcg6YeRIiwidHlwZSI6InRleHRib3giLCJ4Ijo0MDAuMCwieSI6MTgwLjAsIndpZHRoIjo1NjAuMCwiaGVpZ2h0IjoxMzAuMCwicm90YXRpb24iOjAuMCwicm90YXRpb25YIjowLjAsInJvdGF0aW9uWSI6MC4wLCJjb2xvciI6IiNmNWQ0OWMiLCJvcGFjaXR5IjoxLjAsInpJbmRleCI6MSwiaXNCYWNrZ3JvdW5kIjpmYWxzZSwidGV4dEJveCI6eyJ0ZXh0Ijoi5pif6Ze05p2l5L+hIiwiZm9udFNpemUiOjcyLCJhdXRvU2l6ZSI6ZmFsc2UsIm1pbkZvbnRTaXplIjo3MiwidGV4dENvbG9yIjoiI2Y1ZDQ5YyIsInRleHRPcGFjaXR5IjoxLjAsImJnQ29sb3IiOiIjZmZmZmZmIiwiYmdPcGFjaXR5IjowLjAsIm91dGxpbmVFbmFibGVkIjpmYWxzZSwib3V0bGluZUNvbG9yIjoiIzMzMzMzMyIsIm91dGxpbmVPcGFjaXR5IjowLjAsImFsaWduSCI6ImNlbnRlciIsImFsaWduViI6Im1pZGRsZSIsImFuY2hvclR5cGUiOiJjZW50ZXIiLCJ2aXNpYmxlIjp0cnVlLCJzY2FsZVgiOjEuMCwic2NhbGVZIjoxLjAsImFuY2hvck1pblgiOjAuNSwiYW5jaG9yTWluWSI6MC41LCJhbmNob3JNYXhYIjowLjUsImFuY2hvck1heFkiOjAuNSwicGl2b3RYIjowLjUsInBpdm90WSI6MC41fSwiaW1hZ2VBc3NldElkIjpudWxsLCJpbWFnZVRpbnQiOmZhbHNlLCJpbWFnZVR5cGUiOiJiYXNpYyIsInByZWZhYklkIjpudWxsLCJwcmVmYWJWYXJpYWJsZSI6bnVsbCwibHVhTWFzayI6eyJlbmFibGVkIjp0cnVlLCJvZmZzZXRYIjozMTAuMCwib2Zmc2V0WSI6MC4wLCJ3aWR0aCI6OTIwLjAsImhlaWdodCI6MjIwLjAsInJldmVyc2VNYXNrQXJlYSI6ZmFsc2UsImVuYWJsZVNvZnRFZGdlIjp0cnVlLCJzb2Z0RWRnZU1vZGUiOiJQaXhlbCIsInNvZnRFZGdlV2lkdGhYIjozMDAuMCwic29mdEVkZ2VXaWR0aFkiOjAuMCwiaG9yaXpvbnRhbFNvZnRSYW5nZSI6ODUuMCwidmVydGljYWxTb2Z0UmFuZ2UiOjg1LjB9fV0sIm1ldGEiOnsic291cmNlVHlwZSI6Impzb24iLCJzb3VyY2VOYW1lIjoiZ3JhZGllbnQtdGV4dCIsIndhcm5pbmdzIjpbXX0sImxpYnJhcnkiOnsiYWN0aXZlQ2F0ZWdvcnkiOiLln7rnoYDlvaLnirYiLCJjYXRlZ29yaWVzIjpbeyJrZXkiOiJmdW5jdGlvbi1pY29uLW1vbm8iLCJsYWJlbCI6IuWKn+iDveWbvuaghy3ljZXoibIiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6ImZ1bmN0aW9uLWljb24tY29sb3IiLCJsYWJlbCI6IuWKn+iDveWbvuaghy3lvanoibIiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6ImdhbWVwbGF5LWljb24tbW9ubyIsImxhYmVsIjoi546p5rOV5Zu+5qCHLeWNleiJsiIsInN1cHBvcnRlZCI6ZmFsc2V9LHsia2V5IjoiZ2FtZXBsYXktaWNvbi1jb2xvciIsImxhYmVsIjoi546p5rOV5Zu+5qCHLeW9qeiJsiIsInN1cHBvcnRlZCI6ZmFsc2V9LHsia2V5Ijoib3JuYW1lbnQtbW9ubyIsImxhYmVsIjoi6KOF6aWw5Zu+5qGILeWNleiJsiIsInN1cHBvcnRlZCI6ZmFsc2V9LHsia2V5Ijoib3JuYW1lbnQtY29sb3IiLCJsYWJlbCI6IuijhemlsOWbvuahiC3lvanoibIiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6ImZsb29yLW1vbm8iLCJsYWJlbCI6IuWcsOadvy3ljZXoibIiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6ImZsb29yLWNvbG9yIiwibGFiZWwiOiLlnLDmnb8t5b2p6ImyIiwic3VwcG9ydGVkIjpmYWxzZX0seyJrZXkiOiJiYXNpYy1zaGFwZSIsImxhYmVsIjoi5Z+656GA5b2i54q2Iiwic3VwcG9ydGVkIjp0cnVlfSx7ImtleSI6ImRpdmlkZXIiLCJsYWJlbCI6IuWIhuWJsue6vyIsInN1cHBvcnRlZCI6ZmFsc2V9LHsia2V5Ijoic2tpbGwtdGFsZW50IiwibGFiZWwiOiLmioDog73lpKnotYsiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6InNwZWNpYWwtY2hhcmFjdGVyIiwibGFiZWwiOiLnibnmrorlrZfnrKYiLCJzdXBwb3J0ZWQiOmZhbHNlfSx7ImtleSI6Iml0ZW0iLCJsYWJlbCI6IumBk+WFtyIsInN1cHBvcnRlZCI6ZmFsc2V9LHsia2V5IjoiY3JlYXRpb24iLCJsYWJlbCI6IumAoOeJqSIsInN1cHBvcnRlZCI6ZmFsc2V9XSwiYmFzZVNoYXBlUHJlc2V0cyI6W3sidHlwZSI6ImVsbGlwc2UiLCJjb2xvciI6IiMwZjc2NmUiLCJ3aWR0aCI6ODguMCwiaGVpZ2h0Ijo4OC4wfSx7InR5cGUiOiJyZWN0YW5nbGUiLCJjb2xvciI6IiNjMjQxMGMiLCJ3aWR0aCI6MTAyLjAsImhlaWdodCI6NzAuMH0seyJ0eXBlIjoidHJpYW5nbGUiLCJjb2xvciI6IiM3YzNhZWQiLCJ3aWR0aCI6OTYuMCwiaGVpZ2h0Ijo4Ni4wfSx7InR5cGUiOiJmb3VyX3BvaW50X3N0YXIiLCJjb2xvciI6IiMwZjRjODEiLCJ3aWR0aCI6OTAuMCwiaGVpZ2h0Ijo5MC4wfSx7InR5cGUiOiJmaXZlX3BvaW50X3N0YXIiLCJjb2xvciI6IiNiZTEyM2MiLCJ3aWR0aCI6OTIuMCwiaGVpZ2h0Ijo5Mi4wfSx7InR5cGUiOiJyaW5nIiwiY29sb3IiOiIjZjU5ZTBiIiwid2lkdGgiOjkyLjAsImhlaWdodCI6OTIuMH0seyJ0eXBlIjoidGV4dGJveCIsImNvbG9yIjoiI2ZmZmZmZiIsIndpZHRoIjoxODAuMCwiaGVpZ2h0Ijo0MC4wfV0sInNhdmVkSXRlbXMiOltdfX19
