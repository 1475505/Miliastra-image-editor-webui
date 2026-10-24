"""场景 → 客户端「容器节点」控件模板 GIA（纯 Python）。

协议来源：qxqy-lua/knowledge/ui/{gia.proto,01..05} 与 ugc-tool 的
`ClientUIAnimationEditor/giaExporter.ts`，编码骨架移植自
Miliastra-toolbox-primitive-shape 的 `client_ui_export.py`。

与素材组 GIA（`json_to_gia.py`）的差异：
- 根资产是 UIControlTemplate(70)，不是服务端 UIControlGroup(21)；
- 客户端 sibling 按底→顶写入，不能套用素材组 GIA 的反序规则；
- 坐标直接落在控件空间：原点在容器中心，Y 向上，Z 逆时针；
- 容器宽高为画布像素尺寸，使用中心锚点。
"""

import math
import struct

FIRST_GUID = 1073741825
GAME_VERSION = "7.1.0"
# 基础图元对应的静态图片资产；图片图元使用自带的素材 id。
_ASSETS = {
    "rectangle": 100001,
    "ellipse": 100002,
    "triangle": 100003,
    "four_point_star": 100004,
    "five_point_star": 100005,
    "ring": 100006,
}
# 容器节点只承载图片类图元；文本框需要原生文本控件字段，暂不支持。
_IMAGE_TYPES = frozenset(_ASSETS) | {"image"}
# tag: (Data.field501, Data.field502, Details.field501)
_SLOTS = {73: (63, 83, 65), 77: (67, 90, 69),
          78: (68, 91, 70), 83: (73, 96, 75), 84: (74, 97, 76)}


def _varint(value):
    value = int(value)
    if not 0 <= value <= 0xFFFFFFFFFFFFFFFF:
        raise ValueError("GIA 整数超出范围")
    data = bytearray()
    while value >= 128:
        data.append((value & 127) | 128)
        value >>= 7
    data.append(value)
    return bytes(data)


def _uint(tag, value):
    return _varint(tag << 3) + _varint(value)


def _blob(tag, value=b""):
    return _varint((tag << 3) | 2) + _varint(len(value)) + value


def _text(tag, value):
    return _blob(tag, value.encode("utf-8"))


def _number(value, label, positive=False):
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} 必须是有限数值") from exc
    if not math.isfinite(number) or abs(number) > 3.4028234663852886e38:
        raise ValueError(f"{label} 必须是有限的 float32 数值")
    if positive and number <= 0:
        raise ValueError(f"{label} 必须大于 0")
    return number


def _vector(values, tags=(501, 502)):
    # 向量本身保留显式空 message，零分量依 proto3 省略。
    return b"".join(_varint((tag << 3) | 5) + struct.pack("<f", _number(value, "布局"))
                    for tag, value in zip(tags, values) if value != 0)


def _identity(guid):
    return _uint(2, 1) + _uint(3, 8) + _uint(4, guid)


def _details(guid, first, kind, value):
    return (value + _uint(501, first) + _uint(502, kind)
            + _uint(503, 1) + _blob(504, _identity(guid)))


def _slot(guid, tag, value=b""):
    first, kind, inner = _SLOTS[tag]
    return (_blob(tag) + _uint(501, first) + _uint(502, kind)
            + _blob(503, _details(guid, inner, kind, _blob(tag + 1, value))))


def _name_component(name):
    return _blob(12, _text(501, name)) + _uint(501, 2) + _uint(502, 15)


def _type_component(guid):
    value = _blob(17) + _uint(501, 7)
    kind = 86
    return (_blob(14, value) + _uint(501, 4) + _uint(502, kind)
            + _blob(503, _details(guid, 5, kind, _blob(14, value))))


def _transform(guid, preset, offset=(0, 0), size=(0, 0), pivot=(.5, .5),
               rotation=(0, 0, 0)):
    rect = b"".join(_blob(tag, _vector(values, axes)) for tag, values, axes in (
        (501, (1, 1, 1), (1, 2, 3)),
        (502, (.5, .5), (501, 502)),
        (503, (.5, .5), (501, 502)),
        (504, offset, (501, 502)), (505, size, (501, 502)),
        (506, pivot, (501, 502)), (508, rotation, (1, 2, 3)),
    ))
    platforms = b"".join(_blob(501, (_uint(501, device) if device else b"") + _blob(502, rect))
                         for device in range(4))
    transform = _blob(12, platforms + _uint(502, preset) + _uint(504, 1)) + _uint(501, 2)
    return (_blob(11, _blob(12) + _uint(501, 2)) + _uint(501, 1) + _uint(502, 12)
            + _blob(503, _details(guid, 4, 12, _blob(13, transform))))


def _image_config(mask=False):
    # 保留原生图片 B 槽默认值；图元关闭遮罩、羽化、进度填充。
    values = {502: 1, 504: 1, 505: 1, 507: 2, 508: 100, 510: 1, 515: 1}
    return ((_uint(501, 1) if mask else b"")
            + b"".join(_uint(tag, value) for tag, value in values.items())
            + _blob(511, _vector((8, 8)))
            + _vector((85, 85), (512, 513)))


def _unit(guid, name, components, children=(), parent=None, template=False):
    info = _blob(11, _uint(501, guid)) + _uint(501, 1) + _uint(502, 5)
    content = _uint(501, guid) + _blob(502, info)
    # 每个新建根/子控件登记独立资产编号，不能按图片类型复用编号。
    asset_index = guid - FIRST_GUID + 1
    content += _blob(502, _blob(12, _uint(501, asset_index)) + _uint(501, 2) + _uint(502, 6))
    if template:
        # 新模板没有外部伴生资源，不复制其他模板的关联 GUID。
        content += _blob(502, _blob(14) + _uint(501, 4) + _uint(502, 4))
    if children:
        content += _blob(503, b"".join(_varint(child) for child in children))
    if parent is not None:
        content += _uint(504, parent)
    content += b"".join(_blob(505, component) for component in components)
    return (_blob(1, _identity(guid))
            + b"".join(_blob(2, _identity(child)) for child in children)
            + _text(3, name) + _uint(5, 70 if template else 15)
            + _blob(19, _blob(1, content)))


def _control(guid, name, tag, children=(), parent=None, offset=(0, 0), size=(0, 0),
             pivot=(.5, .5), rotation=(0, 0, 0), color=0xFFFFFFFF, asset=100001, mask=False,
             template=False):
    components = [_name_component(name), _type_component(guid),
                  _transform(guid, 25 if tag == 78 else 23, offset, size, pivot, rotation),
                  _slot(guid, 73)]
    if tag == 83:
        # A.504=Stretch，依据 ugc-tool 原生图片字段映射（不在旧 proto 快照中）。
        components += [_slot(guid, 83, _uint(502, color) + _uint(503, asset) + _uint(504, 1)),
                       _slot(guid, 84, _image_config(mask))]
    else:
        components.append(_slot(guid, 78))
    components.append(_slot(guid, 77))
    return _unit(guid, name, components, children, parent, template=template)


def _color_to_rgb(value):
    text = str(value or "").strip().lstrip("#")
    if len(text) in (3, 4):  # #RGB / #RGBA：客户端颜色只取 RGB。
        text = "".join(ch * 2 for ch in text[:3])
    elif len(text) == 8:  # #RRGGBBAA
        text = text[:6]
    if len(text) != 6:
        raise ValueError(f"无法解析图元颜色：{value}")
    try:
        return int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16)
    except ValueError as exc:
        raise ValueError(f"无法解析图元颜色：{value}") from exc


def _packed_color(element):
    tint = element.get("color", "#ffffff")
    if element.get("type") == "image" and not element.get("imageTint"):
        # 彩色素材不能被染色，与素材组 GIA 一样使用白色中性色。
        tint = "#ffffff"
    r, g, b = _color_to_rgb(tint)
    alpha = max(0.0, min(1.0, _number(element.get("opacity", 1), "透明度")))
    return (int(math.floor(alpha * 255 + .5)) << 24) | (r << 16) | (g << 8) | b


def _rotation(element):
    return tuple(_number(element.get(axis, 0) or 0, "旋转角度")
                 for axis in ("rotationX", "rotationY", "rotation"))


def _element_geometry(element, canvas_width, canvas_height, index):
    """返回控件空间 (cx, cy, w, h)：原点在容器中心，Y 向上。"""
    x = _number(element.get("x", 0), f"第 {index} 个图元中心 X")
    y = _number(element.get("y", 0), f"第 {index} 个图元中心 Y")
    width = abs(_number(element.get("width", 0), f"第 {index} 个图元宽度", positive=True))
    height = abs(_number(element.get("height", 0), f"第 {index} 个图元高度", positive=True))
    return x - canvas_width / 2, canvas_height / 2 - y, width, height


def build_container_node_gia(scene, name=""):
    """把场景文档生成为客户端「容器节点」控件模板 GIA 字节。

    scene 采用 `SceneDocumentModel.model_dump()` 结构；不修改入参。
    """
    canvas = scene.get("canvas") or {}
    width = _number(canvas.get("width", 0), "画布宽度", positive=True)
    height = _number(canvas.get("height", 0), "画布高度", positive=True)
    label = str(name or "").strip() or "scene"

    ordered = sorted(scene.get("elements") or [],
                     key=lambda item: (0 if item.get("isBackground") else 1, item.get("zIndex") or 0))
    mask = canvas.get("mask") or {}
    masked = bool(mask.get("enabled"))
    if masked and int(mask.get("shapeType") or 1) != 1:
        raise ValueError("容器节点导出目前只支持矩形裁剪")
    if not ordered:
        raise ValueError("当前场景没有可导出的图元")
    unsupported = [item.get("name") or item.get("id") or "" for item in ordered
                   if item.get("type") not in _IMAGE_TYPES]
    if unsupported:
        raise ValueError("容器节点暂不支持以下图元：" + "、".join(str(value) for value in unsupported)
                         + "（文本框等需改用 Lua 或素材组 GIA）")

    # 图元尺寸必须是正数；先统一校验，避免生成后才发现缺字段。
    for index, element in enumerate(ordered, 1):
        _element_geometry(element, width, height, index)
        if element.get("type") == "image":
            asset = element.get("imageAssetId")
            if isinstance(asset, bool) or not isinstance(asset, int) or not 0 < asset <= 0xFFFFFFFF:
                raise ValueError(f"第 {index} 个图元的素材 ID 无效")

    root_id = FIRST_GUID
    parent_id = root_id + 1 if masked else root_id
    first_image_id = parent_id + 1
    image_ids = [first_image_id + index for index in range(len(ordered))]
    if image_ids[-1] > 2147483647:
        raise ValueError("图元数量超出 GIA 控件编号范围")

    root_children = [parent_id] if masked else image_ids
    units = [_control(root_id, label, 78, children=root_children, size=(width, height),
                      template=True)]
    mask_x, mask_y = 0.0, 0.0
    if masked:
        mask_x = _number(mask.get("x", 0), "裁剪中心 X")
        mask_y = _number(mask.get("y", 0), "裁剪中心 Y")
        mask_size = (
            _number(width if mask.get("width") is None else mask["width"], "裁剪宽度", positive=True),
            _number(height if mask.get("height") is None else mask["height"], "裁剪高度", positive=True),
        )
        # 透明图片仍可遮罩后代，不引入可见的白色裁剪背景。
        units.append(_control(parent_id, "裁剪区域", 83, children=image_ids, parent=root_id,
                              offset=(mask_x, mask_y), size=mask_size,
                              color=0x00FFFFFF, mask=True))

    for index, (guid, element) in enumerate(zip(image_ids, ordered), 1):
        cx, cy, w, h = _element_geometry(element, width, height, index)
        asset = element.get("imageAssetId") if element.get("type") == "image" else _ASSETS[element["type"]]
        units.append(_control(guid, str(index), 83, parent=parent_id,
                              offset=(cx - mask_x, cy - mask_y), size=(w, h),
                              rotation=_rotation(element), color=_packed_color(element),
                              asset=asset))

    # 主资产就是容器节点模板；附件只含它的后代，不添加服务端包装层。
    payload = (_blob(1, units[0]) + b"".join(_blob(2, unit) for unit in units[1:])
               + _text(5, GAME_VERSION))
    return struct.pack(">5I", len(payload) + 20, 1, 0x326, 3, len(payload)) + payload + struct.pack(">I", 0x679)
