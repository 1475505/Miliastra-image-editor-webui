"""Adapt the primitive-shape exporters; import literal data without executing Lua."""

import base64
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re

MAX_CONTENT_SIZE = 10 * 1024 * 1024
MAX_DEPTH = 64
METADATA_PREFIX = "-- MILIASTRA_EDITOR_SCENE_V1 "
TOKEN = re.compile(
    r'(?P<space>\s+)|(?P<comment>--[^\r\n]*)'
    r'|(?P<string>"(?:[^"\\\r\n]|\\[^\r\n])*"|\'(?:[^\'\\\r\n]|\\[^\r\n])*\')'
    r'|(?P<number>-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)'
    r'|(?P<name>[A-Za-z_][A-Za-z_0-9]*)|(?P<symbol>[{}\[\]=,;])'
)
ESCAPES = {"n": "\n", "r": "\r", "t": "\t", "\\": "\\", '"': '"', "'": "'"}


def _upstream(name):
    path = Path(__file__).resolve().parents[1] / "vendor" / "primitive_shape" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"primitive_shape_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shaper = _upstream("lua_export")
gia = _upstream("gia_lua")
ASSET_TYPES = dict(zip(gia.ASSET_NAMES, ("rectangle", "ellipse", "triangle", "four_point_star", "five_point_star", "ring")))
KIND_ASSETS = {shaper.KIND_RECT: 100001, shaper.KIND_CIRCLE: 100002, shaper.KIND_TRIANGLE: 100003}


class LiteralParser:
    def __init__(self, content: str):
        if len(content.encode("utf-8")) > MAX_CONTENT_SIZE:
            raise ValueError("Lua scene exceeds the 10 MiB limit")
        self.content = content.lstrip("\ufeff")
        self.position = 0
        self.token = ("", "")
        self.advance()

    def advance(self):
        while self.position < len(self.content):
            match = TOKEN.match(self.content, self.position)
            if not match:
                raise ValueError(f"Unsupported Lua syntax near character {self.position + 1}; only exported scene data is accepted")
            self.position = match.end()
            if match.lastgroup not in ("space", "comment"):
                self.token = (match.lastgroup, match.group())
                return
        self.token = ("eof", "")

    def take(self, value: str):
        if self.token[1] != value:
            raise ValueError(f"Expected {value!r} near character {self.position}")
        self.advance()

    def string(self, value: str) -> str:
        chars = []
        index = 1
        while index < len(value) - 1:
            char = value[index]
            index += 1
            if char != "\\":
                chars.append(char)
                continue
            escaped = value[index]
            index += 1
            if escaped in ESCAPES:
                chars.append(ESCAPES[escaped])
            elif escaped in "0123456789":
                digits = escaped
                while index < len(value) - 1 and len(digits) < 3 and value[index] in "0123456789":
                    digits += value[index]
                    index += 1
                code = int(digits)
                if code > 127:
                    raise ValueError("Use literal UTF-8 text for non-ASCII characters")
                chars.append(chr(code))
            else:
                raise ValueError(f"Unsupported Lua string escape: \\{escaped}")
        return "".join(chars)

    def value(self, depth: int = 0):
        if depth > MAX_DEPTH:
            raise ValueError("Lua scene tables are nested too deeply")
        kind, value = self.token
        if value == "{":
            return self.table(depth + 1)
        self.advance()
        if kind == "string":
            return self.string(value)
        if kind == "number":
            number = float(value) if any(char in value for char in ".eE") else int(value)
            if not math.isfinite(number):
                raise ValueError("Lua scene numbers must be finite")
            return number
        if kind == "name" and value in ("true", "false", "nil"):
            return {"true": True, "false": False, "nil": None}[value]
        raise ValueError("Expected a literal Lua value; expressions and function calls are not supported")

    def table(self, depth: int):
        self.take("{")
        fields = {}
        items = []
        while self.token[1] != "}":
            key = None
            if self.token[1] == "[":
                self.advance()
                if self.token[0] == "string":
                    key = self.string(self.token[1])
                elif self.token[0] == "number" and self.token[1].isdigit():
                    key = int(self.token[1])
                else:
                    raise ValueError("Scene table keys must be strings or nonnegative integers")
                self.advance()
                self.take("]")
                self.take("=")
            elif self.token[0] == "name" and self.token[1] not in ("true", "false", "nil"):
                key = self.token[1]
                self.advance()
                self.take("=")
            value = self.value(depth)
            if key is not None:
                if items or key in fields:
                    raise ValueError("Mixed or duplicate Lua table keys are not supported")
                fields[key] = value
            else:
                if fields or value is None:
                    raise ValueError("Mixed or sparse Lua arrays are not supported")
                items.append(value)
            if self.token[1] in (",", ";"):
                self.advance()
            elif self.token[1] != "}":
                raise ValueError("Expected a comma between Lua table values")
        self.take("}")
        # Empty tables represent arrays in the scene schema.
        if fields and all(type(key) is int for key in fields) and set(fields) == set(range(1, len(fields) + 1)):
            return [fields[index] for index in range(1, len(fields) + 1)]
        return fields if fields else items


def _literal(source, name, *, required=True):
    # Only read exported declarations. The remaining runtime is never evaluated.
    matches = list(re.finditer(rf"(?m)^local\s+{name}\s*=\s*", source))
    if len(matches) != 1:
        if not matches and not required:
            return None
        raise ValueError(f"Expected exactly one local {name} declaration")
    parser = LiteralParser(source[matches[0].end():])
    return parser.value()


def _number(value):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError("Lua drawing records must contain finite numbers")
    return value


def _rows(value, width, label):
    if not isinstance(value, list):
        raise ValueError(f"{label} must be an array")
    for row in value:
        if not isinstance(row, list) or len(row) != width:
            raise ValueError(f"{label} records must contain {width} numbers")
        for item in row:
            _number(item)
    return value


def read_drawing(source):
    if len(source.encode("utf-8")) > MAX_CONTENT_SIZE:
        raise ValueError("Lua file exceeds the 10 MiB limit")
    source = source.lstrip("\ufeff")
    rows = _literal(source, "ELEMENTS")
    root = _literal(source, "ROOT", required=False)
    if root is not None:
        _rows([root], 13, "ROOT")
        if root[2] <= 0 or root[3] <= 0:
            raise ValueError("ROOT canvas dimensions must be positive")
        drawing = {"format": "gia", "root": root, "rows": _rows(rows, 18, "ELEMENTS")}
        bindings = _literal(source, "PREFAB_BINDINGS", required=False)
        if bindings is not None:
            if not isinstance(bindings, list):
                raise ValueError("PREFAB_BINDINGS must be an array")
            seen = set()
            variables = {}
            for binding in bindings:
                if not isinstance(binding, list) or len(binding) != 3:
                    raise ValueError("Prefab bindings require row index, preview ID and configuration name")
                index, prefab_id, name = binding
                if type(index) is not int or not 1 <= index <= len(rows) or index in seen or rows[index - 1][0] != 0:
                    raise ValueError("Invalid or duplicate Prefab row binding")
                if type(prefab_id) is not int or not 0 < prefab_id <= 0xFFFFFFFF:
                    raise ValueError("Invalid Prefab preview ID")
                if not isinstance(name, str) or not name.strip() or len(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name):
                    raise ValueError("Invalid Prefab configuration name")
                if name in variables and variables[name] != prefab_id:
                    raise ValueError(f"Prefab configuration {name!r} is assigned different IDs")
                seen.add(index)
                variables[name] = prefab_id
            if seen != {i + 1 for i, row in enumerate(rows) if row[0] == 0}:
                raise ValueError("Every Prefab row requires a configuration binding")
            drawing["prefabBindings"] = bindings
        elif any(row[0] == 0 for row in rows):
            raise ValueError("Prefab rows require PREFAB_BINDINGS")
        prefab_ids = _literal(source, "PREFAB_IDS", required=False)
        if prefab_ids is not None:
            if not isinstance(prefab_ids, dict) or bindings is None:
                raise ValueError("PREFAB_IDS must be a named ID table with PREFAB_BINDINGS")
            for name, prefab_id in prefab_ids.items():
                if not isinstance(name, str) or not name.strip() or len(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name):
                    raise ValueError("Invalid Prefab configuration name")
                if type(prefab_id) is not int or not 0 < prefab_id <= 0xFFFFFFFF:
                    raise ValueError("Prefab configuration IDs must be positive uint32 integers")
            if any(binding[2] not in prefab_ids for binding in bindings):
                raise ValueError("Every Prefab binding requires an ID configuration")
            drawing["prefabIds"] = prefab_ids
        textboxes = _literal(source, "TEXTBOXES", required=False)
        order = _literal(source, "DRAW_ORDER", required=False)
        if textboxes is not None or order is not None:
            drawing["textboxes"] = _textboxes(textboxes)
            drawing["order"] = _rows(order, 2, "DRAW_ORDER")
            expected = {(1, i + 1) for i in range(len(rows))} | {(2, i + 1) for i in range(len(textboxes))}
            references = []
            for kind, index in order:
                if type(kind) is not int or type(index) is not int:
                    raise ValueError("DRAW_ORDER requires integer control kinds and indices")
                references.append((kind, index))
            if len(references) != len(expected) or set(references) != expected:
                raise ValueError("DRAW_ORDER must reference every image and textbox exactly once")
        return drawing
    width, height = (_number(_literal(source, name)) for name in ("IMG_WIDTH", "IMG_HEIGHT"))
    if width <= 0 or height <= 0:
        raise ValueError("Lua image dimensions must be positive")
    palette = _rows(_literal(source, "PALETTE"), 3, "PALETTE")
    rows = _rows(rows, 8, "ELEMENTS")
    backgrounds = _number(_literal(source, "BACKGROUND_COUNT"))
    if int(backgrounds) != backgrounds or not 0 <= backgrounds <= len(rows):
        raise ValueError("BACKGROUND_COUNT is out of range")
    return {"format": "shaper", "width": width, "height": height,
            "palette": palette, "backgrounds": backgrounds, "rows": rows}


def _digest(drawing):
    return hashlib.sha256(json.dumps(drawing, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _is_image_element(item):
    """基础形状、素材图片和元件使用图片控件，文本框使用独立模板。"""
    if item.get("type") == "image":
        asset = item.get("imageAssetId")
        return isinstance(asset, int) and asset > 0
    if item.get("type") == "prefab":
        return type(item.get("prefabId")) is int and 0 < item["prefabId"] <= 0xFFFFFFFF
    return item.get("type") in ASSET_TYPES.values()


def dumps(scene, gia_data=None, name=""):
    """Adapt the upstream emitter and preserve the editor scene in an inert comment."""
    # Validate all metadata too (json.dumps rejects non-finite numeric fields).
    json.dumps(scene, allow_nan=False)
    if any(item.get("type") in ("prefab", "textbox") for item in scene["elements"]):
        script = _control_script(scene, gia_data, name)
    elif gia_data is not None:
        script = gia.build_gia_lua(gia_data, name or "千星图片编辑器")
    else:
        # The upstream GIA format requires at least one image; use its companion
        # primitive exporter for a valid empty drawing instead.
        script = shaper.build_lua_export_text({"image_size": scene["canvas"], "elements": [], "mode": "editor"}, name)
    drawing = read_drawing(script)
    expected_images = sum(_is_image_element(item) for item in scene["elements"])
    if len(drawing["rows"]) != expected_images:
        raise ValueError("Shared Lua conversion did not preserve every image element")
    if len(drawing.get("textboxes", [])) != sum(item.get("type") == "textbox" for item in scene["elements"]):
        raise ValueError("Lua conversion did not preserve every textbox")
    # image_template.gia contains orphan references to deleted template nodes.
    # After verifying every current scene image is present, that upstream warning
    # describes the template, not missing user artwork; omit it from this export.
    script = re.sub(r"(?m)^-- 注意：原 GIA 有 \d+ 个没有图片实体的悬空引用[^\n]*\n", "", script)
    metadata = {"version": 1, "drawingHash": _digest(drawing), "scene": scene}
    payload = base64.b64encode(json.dumps(metadata, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).decode()
    preserved_only = sum(not _is_image_element(item) and item.get("type") != "textbox" for item in scene["elements"])
    note = (f"-- 注意：{preserved_only} 个不支持的图元仅保留为编辑数据，不在游戏中绘制。\n" if preserved_only else "")
    result = note + script + "\n-- 编辑器回导数据：保留图元名称、文本框与素材库，请勿删除。\n" + METADATA_PREFIX + payload + "\n"
    if len(result.encode("utf-8")) > MAX_CONTENT_SIZE:
        raise ValueError("Lua export exceeds the 10 MiB re-import limit")
    return result


def _lua_literal(value):
    """Encode UTF-8 Lua literals, including NUL/control bytes followed by digits."""
    if isinstance(value, str):
        escaped = []
        for char in value:
            if char in ('"', "\\"):
                escaped.append("\\" + char)
            elif ord(char) < 32 or ord(char) == 127:
                escaped.append(f"\\{ord(char):03d}")
            else:
                escaped.append(char)
        return '"' + "".join(escaped) + '"'
    if type(value) is bool:
        return "true" if value else "false"
    if isinstance(value, dict):
        return "{" + ",".join(f"[{_lua_literal(key)}]={_lua_literal(item)}" for key, item in value.items()) + "}"
    if isinstance(value, list):
        return "{" + ",".join(map(_lua_literal, value)) + "}"
    return repr(_number(value))


def _textboxes(value):
    """Validate drawing data even when a saved editor snapshot is available."""
    if not isinstance(value, list):
        raise ValueError("TEXTBOXES must be an array")
    numeric = ("scaleX", "scaleY", "anchorMinX", "anchorMinY", "anchorMaxX", "anchorMaxY", "pivotX", "pivotY")
    booleans = ("autoSize", "outlineEnabled", "visible")
    settings = {"text", "fontSize", "minFontSize", "alignH", "alignV", "anchorType", *numeric, *booleans}
    settings.update(f"{prefix}{suffix}" for prefix in ("text", "bg", "outline") for suffix in ("Color", "Opacity"))
    for item in value:
        if not isinstance(item, dict) or set(item) != {"name", "x", "y", "width", "height", "rotation", "textBox"}:
            raise ValueError("Invalid TEXTBOXES record fields")
        if not isinstance(item["name"], str):
            raise ValueError("Textbox names must be strings")
        for field in ("x", "y", "width", "height", "rotation"):
            _number(item[field])
        if min(item["width"], item["height"]) < 1:
            raise ValueError("Textbox dimensions must be positive")
        box = item["textBox"]
        if not isinstance(box, dict) or set(box) != settings or not isinstance(box["text"], str):
            raise ValueError("Invalid TEXTBOXES text settings")
        for field in numeric:
            _number(box[field])
        for field in ("fontSize", "minFontSize"):
            if type(box[field]) is not int or box[field] < 1:
                raise ValueError("Textbox font sizes must be positive integers")
        if any(type(box[field]) is not bool for field in booleans):
            raise ValueError("Textbox switches must be booleans")
        if box["alignH"] not in ("left", "center", "right") or box["alignV"] not in ("top", "middle", "bottom") or box["anchorType"] not in ("center", "custom"):
            raise ValueError("Invalid textbox alignment or anchor type")
        for prefix in ("text", "bg", "outline"):
            color = box[f"{prefix}Color"]
            if not isinstance(color, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
                raise ValueError("Textbox colors must be six-digit hex strings")
            if not 0 <= _number(box[f"{prefix}Opacity"]) <= 1:
                raise ValueError("Textbox opacity must be between zero and one")
    return value


def _control_script(scene, gia_data, name):
    """Extend the upstream runtime for Prefabs and text; leave vendor files intact."""
    width, height = scene["canvas"]["width"], scene["canvas"]["height"]
    static = gia.parse_material_gia(gia_data) if gia_data is not None else None
    # Lua draws the complete canvas without the GIA crop; mixed and Prefab-only
    # scenes must use the same parent geometry even when the crop was resized.
    root = [0, 0, width, height, .5, .5, .5, .5, .5, .5, 1, 1, 0]
    static_rows = iter(static["records"] if static else [])
    rows, bindings, textboxes, order = [], [], [], []
    variables = {}
    for item in sorted(scene["elements"], key=lambda item: (0 if item["isBackground"] else 1, item["zIndex"])):
        if item["type"] == "textbox":
            textboxes.append({key: item[key] for key in ("name", "x", "y", "width", "height", "rotation", "textBox")})
            order.append([2, len(textboxes)])
            continue
        if not _is_image_element(item):
            continue
        order.append([1, len(rows) + 1])
        if item["type"] != "prefab":
            rows.append(next(static_rows))
            continue
        prefab_id = item["prefabId"]
        configuration = item.get("prefabVariable") or f"prefab_{prefab_id}"
        if configuration in variables and variables[configuration] != prefab_id:
            raise ValueError(f"Prefab configuration {configuration!r} is assigned different IDs")
        variables[configuration] = prefab_id
        rgb = [int(item["color"][i:i + 2], 16) for i in (1, 3, 5)]
        rows.append([0, item["x"] - width / 2, height / 2 - item["y"], item["width"], item["height"],
                     .5, .5, .5, .5, .5, .5, 1, 1, item["rotation"], *rgb, round(item["opacity"] * 255)])
        bindings.append([len(rows), prefab_id, configuration])
    title = str(name or "千星图片编辑器").replace("\r", " ").replace("\n", " ")
    lines = [f"-- {title}：图片与文本 Lua 绘制脚本",
             "-- 挂到专用空客户端容器，OnStart 绘制；模板设为仅存为模板。",
             "local IMAGE_PREFAB_ID = 0 -- 图片控件模板索引ID；没有图片时无需填写"]
    if textboxes:
        lines += ["local TEXTBOX_PREFAB_ID = 0 -- 必填：文本框控件模板索引ID",
                  "-- 字号自适应由每个文本框的 autoSize 显式设置，默认开启；minFontSize 为最小字号。"]
    lines += ["local BASE_SCALE = 1", "local OFFSET_X = 0", "local OFFSET_Y = 0"]
    if bindings:
        lines += ["-- 元件 ID 在 PREFAB_IDS 中定义，无需创建客户端脚本参数。", "local PREFAB_IDS = {"]
        lines += [f"    [{_lua_literal(configuration)}] = {prefab_id}," for configuration, prefab_id in variables.items()]
        lines += ["}", "-- rowIndex,previewPrefabId,configurationName；绘制时读取 PREFAB_IDS。", "local PREFAB_BINDINGS = {"]
        lines += [f"    {{{index},{prefab_id},{_lua_literal(configuration)}}}," for index, prefab_id, configuration in bindings]
        lines.append("}")
    lines += ["local ROOT = {" + ",".join(map(repr, root)) + "}", "local ELEMENTS = {"]
    lines += ["    {" + ",".join(map(repr, row)) + "}," for row in rows]
    lines.append("}")
    runtime = gia._RUNTIME
    if textboxes:
        lines += ["-- 文本框数据：位置使用编辑器画布坐标，textBox 保存完整文字与样式。", "local TEXTBOXES = {"]
        lines += ["    " + _lua_literal(item) + "," for item in textboxes]
        lines += ["}", "-- {1,图片序号} / {2,文本框序号}，从背景到前景绘制。", "local DRAW_ORDER = {"]
        lines += ["    " + _lua_literal(entry) + "," for entry in order]
        lines.append("}")
    before = '        for _, item in ipairs(ELEMENTS) do\n'
    end = '            image:SetAsLastSibling()\n        end'
    if runtime.count(before) != 1 or runtime.count(end) != 1:
        raise ValueError("Upstream Lua runtime changed; control adapter needs review")
    body_start = runtime.index(before) + len(before)
    body_end = runtime.index(end) + len('            image:SetAsLastSibling()')
    image_body = runtime[body_start:body_end]
    prefix = '''        local prefabValues = {}
        for _, binding in ipairs(PREFAB_BINDINGS) do
            local value = PREFAB_IDS[binding[3]]
            if type(value) ~= "number" or value < 1 or value > 4294967295 or value ~= math.floor(value) then
                error("无效的元件 ID 配置：" .. binding[3])
            end
            prefabValues[binding[1]] = value
        end
'''
    setter = '            image:SetImage(Enum.ImageSource.StaticReference, item[1])'
    replacement = '''            if prefabValues[index] ~= nil then
                image:SetImage(Enum.ImageSource.Prefab, prefabValues[index])
            else
                image:SetImage(Enum.ImageSource.StaticReference, item[1])
            end'''
    if bindings:
        if image_body.count(setter) != 1:
            raise ValueError("Upstream Lua runtime changed; Prefab adapter needs review")
        image_body = image_body.replace(setter, replacement)
    if textboxes:
        image_body = "\n".join("    " + line for line in image_body.splitlines())
        loop = '''        for _, entry in ipairs(DRAW_ORDER) do
            local index = entry[2]
            if entry[1] == 2 then
''' + _TEXTBOX_RUNTIME + '''
            else
                local item = ELEMENTS[index]
''' + image_body + '''
            end
        end'''
    else:
        loop = '        for index, item in ipairs(ELEMENTS) do\n' + image_body + '\n        end'
    runtime = runtime[:runtime.index(before)] + (prefix if bindings else "") + loop + runtime[body_end + len('\n        end'):]
    if textboxes:
        check = 'if type(IMAGE_PREFAB_ID) ~= "number" or IMAGE_PREFAB_ID <= 0 or IMAGE_PREFAB_ID % 1 ~= 0 then'
        runtime = runtime.replace(check, 'if #ELEMENTS > 0 and (type(IMAGE_PREFAB_ID) ~= "number" or IMAGE_PREFAB_ID <= 0 or IMAGE_PREFAB_ID % 1 ~= 0) then')
        runtime = runtime.replace('    local parent = script.object', '''    if type(TEXTBOX_PREFAB_ID) ~= "number" or TEXTBOX_PREFAB_ID <= 0 or TEXTBOX_PREFAB_ID % 1 ~= 0 then
        printerr("[GIA绘制] 请填写 TEXTBOX_PREFAB_ID：客户端文本框控件模板索引ID")
        return
    end
    local parent = script.object''')
        # Alignment names come from the documented client UI API, not GIA codes.
        runtime = '''local ALIGN_H = {left=Enum.TextHorizontalAlignment.Left, center=Enum.TextHorizontalAlignment.Middle, right=Enum.TextHorizontalAlignment.Right}
local ALIGN_V = {top=Enum.TextVerticalAlignment.Top, middle=Enum.TextVerticalAlignment.Middle, bottom=Enum.TextVerticalAlignment.Bottom}
local function TextColor(hex, opacity)
    return Color.FromRGBA(tonumber(string.sub(hex, 2, 3), 16), tonumber(string.sub(hex, 4, 5), 16), tonumber(string.sub(hex, 6, 7), 16), math.floor(opacity * 255))
end
''' + runtime
    lines.append(runtime.replace("[GIA绘制]", "[图片绘制]"))
    return "\n".join(lines)


_TEXTBOX_RUNTIME = '''                local item = TEXTBOXES[index]
                local box = item.textBox
                local text = game.InstantiateClientUIControl(TEXTBOX_PREFAB_ID, parent)
                if text == nil then error("文本框模板无法实例化，请确认已设为仅存为模板") end
                table.insert(created, text)
                text.name = item.name
                text:SetAnchorMin(box.anchorMinX, box.anchorMinY)
                text:SetAnchorMax(box.anchorMaxX, box.anchorMaxY)
                text:SetPivot(box.pivotX, box.pivotY)
                text:SetSizeDelta(item.width, item.height)
                text:SetLocalScale(box.scaleX, box.scaleY, 1)
                text:SetLocalRotation(0, 0, item.rotation)
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
                text:SetActive(true)
                text:SetVisible(box.visible)
                text:SetAsLastSibling()'''


def drawing_to_scene(drawing):
    warnings = []
    elements = []
    if drawing["format"] == "gia":
        root = drawing["root"]
        width, height = root[2:4]
        if root[10:13] != [1, 1, 0]:
            warnings.append("Imported the original group canvas; runtime group scale and rotation were not applied.")
        rows = drawing["rows"]
    else:
        width, height = drawing["width"], drawing["height"]
        rows = []
        # Upstream fitted JSON stores center.y = -screen_y. Older exports keep
        # these negative coordinates. Restore artwork space, not runtime offset.
        negative_y = any(item[2] < 0 for item in drawing["rows"])
        for kind, cx, cy, w, h, angle, color_index, alpha in drawing["rows"]:
            if kind not in KIND_ASSETS or int(color_index) != color_index or not 1 <= color_index <= len(drawing["palette"]):
                raise ValueError("Unknown primitive kind or palette index")
            color = drawing["palette"][int(color_index) - 1]
            rows.append([KIND_ASSETS[kind], cx - width / 2, (cy + height / 2 if negative_y else cy - height / 2),
                         w, h, .5, 1 / 3 if kind == shaper.KIND_TRIANGLE else .5,
                         .5, .5, .5, .5, 1, 1, angle, *color, alpha])
    prefab_bindings = {binding[0]: binding for binding in drawing.get("prefabBindings", [])}
    for index, row in enumerate(rows):
        asset, x, y, w, h, px, py, aminx, aminy, amaxx, amaxy, sx, sy, angle, r, g, b, alpha = row
        if min(w, h) <= 0 or sx == 0 or sy == 0 or not all(0 <= value <= 255 for value in (r, g, b, alpha)):
            raise ValueError("Invalid image size, scale, color or opacity")
        # Unity anchors and pivots -> the editor's center coordinate; preserve
        # triangle centroid pivots, rotated offsets and reflected shapes.
        w += width * (amaxx - aminx)
        h += height * (amaxy - aminy)
        if min(w, h) <= 0:
            raise ValueError("Stretched image size must be positive")
        dx, dy = (.5 - px) * w * sx, (.5 - py) * h * sy
        radians = math.radians(angle)
        cx = width * (aminx + (amaxx - aminx) * px) + x + dx * math.cos(radians) - dy * math.sin(radians)
        cy = height * (aminy + (amaxy - aminy) * py) + y + dx * math.sin(radians) + dy * math.cos(radians)
        color = f"#{round(r):02x}{round(g):02x}{round(b):02x}"
        binding = prefab_bindings.get(index + 1)
        if binding is not None:
            prefab_id = drawing.get("prefabIds", {}).get(binding[2], binding[1])
            elements.append({"id": f"lua-{index + 1}", "name": f"元件 {prefab_id}", "type": "prefab",
                             "x": cx, "y": height - cy, "width": abs(w * sx), "height": abs(h * sy),
                             "rotation": angle, "color": color, "opacity": alpha / 255, "zIndex": index,
                             "isBackground": False, "prefabId": prefab_id, "prefabVariable": binding[2]})
            continue
        if asset not in ASSET_TYPES:
            # 素材库 sprite：白色代表未染色，其余颜色视为单色素材的染色
            elements.append({"id": f"lua-{index + 1}", "name": f"素材 {asset}", "type": "image",
                             "x": cx, "y": height - cy, "width": abs(w * sx), "height": abs(h * sy),
                             "rotation": angle, "color": color,
                             "opacity": alpha / 255, "zIndex": index,
                             "isBackground": drawing["format"] == "shaper" and index < drawing["backgrounds"],
                             "imageAssetId": int(asset), "imageTint": color.lower() != "#ffffff"})
            continue
        shape = ASSET_TYPES[asset]
        if sy < 0 and shape in ("triangle", "five_point_star"):
            angle += 180
        elements.append({"id": f"lua-{index + 1}", "name": gia.ASSET_NAMES[asset], "type": shape,
                         "x": cx, "y": height - cy, "width": abs(w * sx), "height": abs(h * sy),
                         "rotation": angle, "color": color,
                         "opacity": alpha / 255, "zIndex": index,
                         "isBackground": drawing["format"] == "shaper" and index < drawing["backgrounds"]})
    if "textboxes" in drawing:
        text_elements = []
        for index, item in enumerate(drawing["textboxes"]):
            box = item["textBox"]
            text_elements.append({**item, "id": f"lua-text-{index + 1}", "type": "textbox",
                                  "color": box["textColor"], "opacity": box["textOpacity"],
                                  "zIndex": index, "isBackground": False})
        controls = {1: elements, 2: text_elements}
        elements = [controls[kind][index - 1] for kind, index in drawing["order"]]
        for index, item in enumerate(elements):
            item["zIndex"] = index
    warnings.append("Imported drawing data only; runtime template IDs, auto-fit, scale and offsets are not applied to the canvas.")
    return {"canvas": {"width": width, "height": height, "background": "transparent"}, "elements": elements,
            "meta": {"sourceType": "lua", "warnings": warnings}}


def loads(content):
    drawing = read_drawing(content)
    # Validate the records even when an editor metadata block is present.
    reconstructed = drawing_to_scene(drawing)
    blocks = re.findall(r"(?m)^-- MILIASTRA_EDITOR_SCENE_V1 (\S+)\s*$", content)
    if len(blocks) > 1:
        raise ValueError("Duplicate editor metadata blocks")
    if blocks:
        try:
            metadata = json.loads(base64.b64decode(blocks[0], validate=True))
            if not isinstance(metadata, dict) or type(metadata.get("version")) is not int or metadata["version"] != 1 or not isinstance(metadata.get("scene"), dict):
                raise ValueError("Unsupported editor metadata")
            if metadata.get("drawingHash") == _digest(drawing):
                return metadata["scene"]
            reconstructed["meta"]["warnings"].append("Lua drawing data was edited; reconstructed the current records instead of using the saved editor snapshot.")
            if "library" in metadata["scene"]:
                reconstructed["library"] = metadata["scene"]["library"]
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise ValueError(f"Invalid Lua editor metadata: {exc}") from exc
    return reconstructed
