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
    """基础形状与素材图片都会走 GIA 图片导出，其余图元只保留为编辑数据。"""
    if item.get("type") == "image":
        asset = item.get("imageAssetId")
        return isinstance(asset, int) and asset > 0
    if item.get("type") == "prefab":
        return type(item.get("prefabId")) is int and 0 < item["prefabId"] <= 0xFFFFFFFF
    return item.get("type") in ASSET_TYPES.values()


def dumps(scene, gia_data=None, name=""):
    """Use the unmodified upstream emitter, plus an inert editor-data comment."""
    # Validate all metadata too (json.dumps rejects non-finite numeric fields).
    json.dumps(scene, allow_nan=False)
    if any(item.get("type") == "prefab" for item in scene["elements"]):
        script = _prefab_script(scene, gia_data, name)
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
    # image_template.gia contains orphan references to deleted template nodes.
    # After verifying every current scene image is present, that upstream warning
    # describes the template, not missing user artwork; omit it from this export.
    script = re.sub(r"(?m)^-- 注意：原 GIA 有 \d+ 个没有图片实体的悬空引用[^\n]*\n", "", script)
    metadata = {"version": 1, "drawingHash": _digest(drawing), "scene": scene}
    payload = base64.b64encode(json.dumps(metadata, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).decode()
    preserved_only = sum(not _is_image_element(item) for item in scene["elements"])
    note = (f"-- 注意：{preserved_only} 个文本框/非图片图元仅保留为编辑数据，不在游戏中绘制。\n" if preserved_only else "")
    result = note + script + "\n-- 编辑器回导数据：保留图元名称、文本框与素材库，请勿删除。\n" + METADATA_PREFIX + payload + "\n"
    if len(result.encode("utf-8")) > MAX_CONTENT_SIZE:
        raise ValueError("Lua export exceeds the 10 MiB re-import limit")
    return result


def _prefab_script(scene, gia_data, name):
    """Extend the upstream runtime at its SetImage boundary; leave vendor files intact."""
    width, height = scene["canvas"]["width"], scene["canvas"]["height"]
    static = gia.parse_material_gia(gia_data) if gia_data is not None else None
    # Lua draws the complete canvas without the GIA crop; mixed and Prefab-only
    # scenes must use the same parent geometry even when the crop was resized.
    root = [0, 0, width, height, .5, .5, .5, .5, .5, .5, 1, 1, 0]
    static_rows = iter(static["records"] if static else [])
    rows, bindings = [], []
    variables = {}
    for item in sorted(scene["elements"], key=lambda item: item["zIndex"]):
        if not _is_image_element(item):
            continue
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
    lines = [f"-- {title}：元件图片 Lua 绘制脚本", "-- 1. 将 IMAGE_PREFAB_ID 填为图片控件的「控件模板索引ID」，模板设为仅存为模板。",
             "-- 2. 元件 ID 在下方 PREFAB_IDS 表中定义，可直接修改；无需创建客户端脚本参数。",
             "--    SetImage 的 imageId 使用整数；Enum.ImageSource.Prefab 指定图片来源为元件。",
             "-- 3. 挂到专用空客户端容器，OnStart 绘制；文本框只保留为编辑数据。",
              "local IMAGE_PREFAB_ID = 0 -- 客户端图片控件模板索引ID", "local BASE_SCALE = 1", "local OFFSET_X = 0", "local OFFSET_Y = 0",
              "local PREFAB_IDS = {"]
    lines += [f"    [{json.dumps(configuration, ensure_ascii=False)}] = {prefab_id}," for configuration, prefab_id in variables.items()]
    lines += ["}", "-- rowIndex,previewPrefabId,configurationName；绘制时读取 PREFAB_IDS。",
              "local PREFAB_BINDINGS = {"]
    lines += [f"    {{{index},{prefab_id},{json.dumps(configuration, ensure_ascii=False)}}}," for index, prefab_id, configuration in bindings]
    lines += ["}", "local ROOT = {" + ",".join(map(repr, root)) + "}", "local ELEMENTS = {"]
    lines += ["    {" + ",".join(map(repr, row)) + "}," for row in rows]
    lines.append("}")
    runtime = gia._RUNTIME
    before = '        for _, item in ipairs(ELEMENTS) do'
    after = '''        local prefabValues = {}
        for _, binding in ipairs(PREFAB_BINDINGS) do
            local value = PREFAB_IDS[binding[3]]
            if type(value) ~= "number" or value < 1 or value > 4294967295 or value ~= math.floor(value) then
                error("无效的元件 ID 配置：" .. binding[3])
            end
            prefabValues[binding[1]] = value
        end
        for index, item in ipairs(ELEMENTS) do'''
    setter = '            image:SetImage(Enum.ImageSource.StaticReference, item[1])'
    replacement = '''            if prefabValues[index] ~= nil then
                image:SetImage(Enum.ImageSource.Prefab, prefabValues[index])
            else
                image:SetImage(Enum.ImageSource.StaticReference, item[1])
            end'''
    if runtime.count(before) != 1 or runtime.count(setter) != 1:
        raise ValueError("Upstream Lua runtime changed; Prefab adapter needs review")
    lines.append(runtime.replace(before, after).replace(setter, replacement).replace("[GIA绘制]", "[图片绘制]"))
    return "\n".join(lines)


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
    warnings.append("Imported drawing data only; runtime template IDs, auto-fit, scale and offsets are not applied to the canvas.")
    return {"canvas": {"width": width, "height": height, "background": "#ffffff"}, "elements": elements,
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
