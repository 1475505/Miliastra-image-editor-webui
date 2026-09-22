-- gia_synthetic：超限素材组 Lua 绘制脚本
-- 图片数量：2；静态图片资产：2 种
-- 1. 准备一个客户端图片控件，设为「仅存为模板」。关闭模板遮罩/羽化。
-- 2. 必填：将下面 IMAGE_PREFAB_ID = 0 改为该图片控件的「控件模板索引ID」。
--    不是图片资产ID；只填这一处，脚本会自动切换每个图元的静态图片。
-- 3. 挂载：创建专用空客户端容器节点，将本文件作为客户端脚本挂到该节点。
--    进入运行预览即绘制（OnStart）。脚本会设置该节点尺寸，请不要挂在已有界面的根节点上。
-- 可选：BASE_SCALE 缩放；OFFSET_X/Y 平移（Y向上）。自定义图片需在当前关卡可用。
-- 保留键鼠布局；不转换嵌套组、文本、动态引用及组遮罩。

local IMAGE_PREFAB_ID = 0 -- 必填：客户端图片控件模板索引ID
local BASE_SCALE = 1
local OFFSET_X = 0
local OFFSET_Y = 0
-- 数据顺序：图片资产,x,y,w,h,pivotX,pivotY,anchorMinX,anchorMinY,anchorMaxX,anchorMaxY,scaleX,scaleY,rotZ,r,g,b,a
local ROOT = {0,0,183.9230466659933,203.92305155128082,0.5,0.5,0.5,0.5,0.5,0.5,1,1,0}
local ELEMENTS = {
    {100001,30.0,-20.0,40.0,60.0,0.25,0.3333333432674408,0.5,0.5,0.5,0.5,-2.0,3.0,30.0,171,205,239,255},
    {100003,20.0,-20.0,40.0,60.0,0.25,0.3333333432674408,0.5,0.5,0.5,0.5,-2.0,3.0,30.0,18,52,86,128},
}

local created = {}
local function Clear()
    for i = #created, 1, -1 do
        game.DestroyClientUIControl(created[i])
    end
    created = {}
end

function OnStart()
    Clear()
    if type(IMAGE_PREFAB_ID) ~= "number" or IMAGE_PREFAB_ID <= 0 or IMAGE_PREFAB_ID % 1 ~= 0 then
        printerr("[GIA绘制] 请填写 IMAGE_PREFAB_ID：客户端图片控件模板索引ID")
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
        for _, item in ipairs(ELEMENTS) do
            local image = game.InstantiateClientUIControl(IMAGE_PREFAB_ID, parent)
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
            image:SetAsLastSibling()
        end
    end)
    if not ok then
        Clear()
        printerr("[GIA绘制] " .. tostring(err))
    end
end

function OnDestroy()
    Clear()
end
