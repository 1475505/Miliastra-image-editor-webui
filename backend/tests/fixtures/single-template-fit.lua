-- =========================================================
-- shaper_result - 千星奇域图元拟合拼图
-- 由 Miliastra-toolbox-primitive-shape 自动导出
-- 模式: fill | 图元数: 3 (背景 0) | 原图: 200x200
-- =========================================================
--
-- 使用说明
-- 1. 准备一个客户端图片控件，设为「仅存为模板」，关闭遮罩/羽化。
-- 2. 必填：把 IMAGE_PREFAB_ID = 0 改为该控件的「控件模板索引ID」。
--    不是图片资产ID；只填这一处，脚本自动切换矩形、圆形与三角形图片。
-- 3. 挂载：将本文件作为客户端脚本挂到专用空客户端容器节点。
--    进入运行预览后在 OnStart 绘制；不要把创建逻辑移到 OnInit。
-- 可选：BASE_SCALE 缩放；OFFSET_X/Y 平移（Y向上）；SKIP_BACKGROUND 跳过背景。
-- 每个图元创建一个图片控件。控件容量与真机显示请在运行预览中确认。
-- =========================================================
-- ====================== 可调参数 ==========================

-- 必填：客户端图片控件模板索引ID
local IMAGE_PREFAB_ID = 0
-- 静态图片资产（无需修改）
local IMAGE_ID_BY_KIND = { [0] = 100001, [1] = 100002, [2] = 100003 }

local BASE_SCALE = 1.0 -- 整体缩放倍率
local FIT_TO_CANVAS = true -- 超出画布时自动缩小
local CANVAS_MARGIN = 0.9 -- 自适应时占画布宽高比例的上限
local OFFSET_X = 0 -- 图案中心相对父控件中心的水平偏移
local OFFSET_Y = 0 -- 图案中心相对父控件中心的竖直偏移(Y 向上)
local SKIP_BACKGROUND = false -- true 时跳过下面的背景图元
local ROTATION_BIAS = 0 -- 全局附加旋转角(度)，一般保持 0

-- ==================== 数据(勿手改) ========================

local IMG_WIDTH = 200 -- 原图宽度(像素)
local IMG_HEIGHT = 200 -- 原图高度(像素)
local BACKGROUND_COUNT = 0 -- 开头的背景图元数量

-- 调色板: RGB 0-255
local PALETTE = {
    [1] = {171, 205, 239},
}

-- 图元记录: {kind, cx, cy, w, h, rotZ, colorIndex, alpha}
--   kind: 0=矩形 1=椭圆(圆拉伸) 2=三角形
--   cx,cy: 图元中心，原图像素坐标，左下角原点、Y 向上
--   w,h:   矩形/三角形为宽高；椭圆为直径(2*rx, 2*ry)
--   rotZ:  旋转角(度)，绕各自身心；三角形轴心在其质心(0.5, 1/3)
--   colorIndex: PALETTE 下标;  alpha: 0-255
local ELEMENTS = {
    {0, 50.0, -50.0, 30.0, 40.0, 0.0, 1, 255},
    {1, 50.0, -50.0, 30.0, 40.0, 0.0, 1, 255},
    {2, 50.0, -50.0, 30.0, 40.0, 0.0, 1, 255},
}
-- ===================== 运行时逻辑 ==========================

local createdControls = {}
local warnedMissingPrefab = false

local function GetPrefabId(kind)
    local id = IMAGE_PREFAB_ID
    if type(id) == "number" and id > 0 and id % 1 == 0 then
        return id
    end
    if not warnedMissingPrefab then
        warnedMissingPrefab = true
        printerr("[图元拼图] 请填写 IMAGE_PREFAB_ID：客户端图片控件模板索引ID")
    end
    return nil
end

local function DestroyAll()
    for _, control in ipairs(createdControls) do
        pcall(function()
            game.DestroyClientUIControl(control)
        end)
    end
    createdControls = {}
end

local function DrawElement(parent, item, scale)
    local prefabId = GetPrefabId(item[1])
    if prefabId == nil then
        return
    end

    local image = game.InstantiateClientUIControl(prefabId, parent)
    if image == nil then
        return
    end

    -- 三角形质心在底边上方 1/3 高度处，其余形状为中心
    local pivotY = 0.5
    if item[1] == 2 then
        pivotY = 1 / 3
    end

    image:SetAnchorMin(0.5, 0.5)
    image:SetAnchorMax(0.5, 0.5)
    image:SetPivot(0.5, pivotY)
    image:SetImage(Enum.ImageSource.StaticReference, IMAGE_ID_BY_KIND[item[1]])
    pcall(function() image.imageType = Enum.ImageType.Stretch end)

    local color = PALETTE[item[7]]
    if color ~= nil then
        image.imageColor = Color.FromRGBA(color[1], color[2], color[3], item[8])
    end

    image:SetSizeDelta(item[4] * scale, item[5] * scale)

    local rotZ = item[6] + ROTATION_BIAS
    if rotZ ~= 0 then
        image:SetLocalRotation(0, 0, rotZ)
    end

    local px = (item[2] - IMG_WIDTH / 2) * scale + OFFSET_X
    local py = (item[3] - IMG_HEIGHT / 2) * scale + OFFSET_Y
    image:SetAnchoredPosition(px, py)

    image:SetAsLastSibling()
    table.insert(createdControls, image)
end

function OnStart()
    DestroyAll()

    local parent = script.object
    if parent == nil then
        printerr("[图元拼图] 取不到脚本宿主控件(script.object)，图元未创建")
        return
    end

    -- 计算最终缩放：BASE_SCALE 与画布自适应取小者
    local scale = BASE_SCALE
    if FIT_TO_CANVAS then
        local canvasWidth, canvasHeight = game.GetUICanvasSize()
        if canvasWidth and canvasHeight and canvasWidth > 0 and canvasHeight > 0 then
            local fitScale = math.min(canvasWidth / IMG_WIDTH, canvasHeight / IMG_HEIGHT) * CANVAS_MARGIN
            if fitScale > 0 and fitScale < scale then
                scale = fitScale
            end
        end
    end

    local startIndex = 1
    if SKIP_BACKGROUND then
        startIndex = BACKGROUND_COUNT + 1
    end

    for index = startIndex, #ELEMENTS do
        DrawElement(parent, ELEMENTS[index], scale)
    end
end

function OnDestroy()
    DestroyAll()
end
