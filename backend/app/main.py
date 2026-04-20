from __future__ import annotations

import importlib.util
import io
import json
import math
import re
from datetime import date
from pathlib import Path
from typing import Literal
from uuid import uuid4
from xml.etree import ElementTree as ET

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image, ImageColor, ImageDraw

ROOT_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT_DIR / "backend" / "app" / "static"
INDEX_FILE = STATIC_DIR / "index.html"
GIA_DIR = ROOT_DIR / "backend" / "vendor" / "gia"
GIA_PY_PATH = GIA_DIR / "json_to_gia.py"
GIA_TEMPLATE_PATH = GIA_DIR / "image_template.gia"

DEFAULT_CANVAS_WIDTH = 300
DEFAULT_CANVAS_HEIGHT = 300
DEFAULT_CANVAS_BACKGROUND = "#ffffff"
DEFAULT_SHAPE_SIZE = 80.0
HEX_COLOR_RE = re.compile(r"^[0-9a-f]+$")
TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)"

IMAGE_ASSET_REFS = {
    "rectangle": 100001,
    "ellipse": 100002,
    "triangle": 100003,
    "four_point_star": 100004,
    "five_point_star": 100005,
}

IMPORT_SOURCE_TYPES = {"json", "css", "svg"}
SHAPE_TYPES = {
    "ellipse",
    "rectangle",
    "triangle",
    "four_point_star",
    "five_point_star",
    "other",
}
GIA_SHAPE_TYPES = {
    "ellipse",
    "rectangle",
    "triangle",
    "four_point_star",
    "five_point_star",
}
LIBRARY_CATEGORY_DEFINITIONS = [
    {"key": "function-icon-mono", "label": "功能图标-单色", "supported": False},
    {"key": "function-icon-color", "label": "功能图标-彩色", "supported": False},
    {"key": "gameplay-icon-mono", "label": "玩法图标-单色", "supported": False},
    {"key": "gameplay-icon-color", "label": "玩法图标-彩色", "supported": False},
    {"key": "ornament-mono", "label": "装饰图案-单色", "supported": False},
    {"key": "ornament-color", "label": "装饰图案-彩色", "supported": False},
    {"key": "floor-mono", "label": "地板-单色", "supported": False},
    {"key": "floor-color", "label": "地板-彩色", "supported": False},
    {"key": "basic-shape", "label": "基础形状", "supported": True},
    {"key": "divider", "label": "分割线", "supported": False},
    {"key": "skill-talent", "label": "技能天赋", "supported": False},
    {"key": "special-character", "label": "特殊字符", "supported": False},
    {"key": "item", "label": "道具", "supported": False},
    {"key": "creation", "label": "造物", "supported": False},
]


def default_library_categories() -> list["LibraryCategoryModel"]:
    return [LibraryCategoryModel(**item) for item in LIBRARY_CATEGORY_DEFINITIONS]


def default_base_shape_presets() -> list["LibraryBaseShapePresetModel"]:
    return [
        LibraryBaseShapePresetModel(type="ellipse", color="#0f766e", width=88, height=88),
        LibraryBaseShapePresetModel(type="rectangle", color="#c2410c", width=102, height=70),
        LibraryBaseShapePresetModel(type="triangle", color="#7c3aed", width=96, height=86),
        LibraryBaseShapePresetModel(type="four_point_star", color="#0f4c81", width=90, height=90),
        LibraryBaseShapePresetModel(type="five_point_star", color="#be123c", width=92, height=92),
    ]


def default_gia_group_name() -> str:
    return date.today().strftime("%Y%m%d")


class CanvasModel(BaseModel):
    width: float = DEFAULT_CANVAS_WIDTH
    height: float = DEFAULT_CANVAS_HEIGHT
    background: str = DEFAULT_CANVAS_BACKGROUND


class MetaModel(BaseModel):
    sourceType: Literal["json", "css", "svg", "editor"] = "editor"
    sourceName: str = ""
    warnings: list[str] = Field(default_factory=list)


class LibraryCategoryModel(BaseModel):
    key: str
    label: str
    supported: bool = False


class SceneElementModel(BaseModel):
    id: str
    name: str = ""
    type: str
    x: float
    y: float
    width: float
    height: float
    rotation: float = 0.0
    color: str = "#4f46e5"
    opacity: float = 1.0
    zIndex: int = 0
    isBackground: bool = False


class LibraryBaseShapePresetModel(BaseModel):
    type: str
    color: str
    width: float
    height: float


class LibrarySavedItemModel(BaseModel):
    id: str
    name: str
    category: str = "基础形状"
    element: SceneElementModel


class SceneLibraryModel(BaseModel):
    activeCategory: str = "基础形状"
    categories: list[LibraryCategoryModel] = Field(default_factory=default_library_categories)
    baseShapePresets: list[LibraryBaseShapePresetModel] = Field(default_factory=default_base_shape_presets)
    savedItems: list[LibrarySavedItemModel] = Field(default_factory=list)


class SceneDocumentModel(BaseModel):
    canvas: CanvasModel = Field(default_factory=CanvasModel)
    elements: list[SceneElementModel] = Field(default_factory=list)
    meta: MetaModel = Field(default_factory=MetaModel)
    library: SceneLibraryModel = Field(default_factory=SceneLibraryModel)


class ImportRequest(BaseModel):
    sourceType: Literal["json", "css", "svg"]
    content: str
    sourceName: str = ""


class ImportResponse(BaseModel):
    scene: SceneDocumentModel
    warnings: list[str] = Field(default_factory=list)


class ExportRequest(BaseModel):
    scene: SceneDocumentModel
    giaGroupName: str = Field(default_factory=default_gia_group_name)


app = FastAPI(title="Miliastra Image Editor API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)


@app.post("/api/import", response_model=ImportResponse)
def import_scene(request: ImportRequest) -> ImportResponse:
    if request.sourceType not in IMPORT_SOURCE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported sourceType")

    if request.sourceType == "json":
        scene = parse_json_scene(request.content)
    elif request.sourceType == "css":
        scene = parse_css_scene(request.content)
    else:
        scene = parse_svg_scene(request.content)

    if request.sourceName:
        scene.meta.sourceName = request.sourceName

    return ImportResponse(scene=scene, warnings=scene.meta.warnings)


@app.post("/api/export/json")
def export_json(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    content = json.dumps(scene.model_dump(), ensure_ascii=False, indent=2)
    return download_text(content, "scene.json", "application/json; charset=utf-8")


@app.post("/api/export/css")
def export_css(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    return download_text(scene_to_css(scene), "scene.css", "text/css; charset=utf-8")


@app.post("/api/export/svg")
def export_svg(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    return download_text(scene_to_svg(scene), "scene.svg", "image/svg+xml; charset=utf-8")


@app.post("/api/export/png")
def export_png(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    png_bytes = scene_to_png_bytes(scene)
    headers = {"Content-Disposition": 'attachment; filename="scene.png"'}
    return Response(content=png_bytes, media_type="image/png", headers=headers)


@app.post("/api/export/gia")
def export_gia(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    gia_json = scene_to_gia_document(scene, request.giaGroupName)
    gia_bytes = convert_scene_to_gia_bytes(gia_json)
    headers = {"Content-Disposition": 'attachment; filename="scene.gia"'}
    return Response(content=gia_bytes, media_type="application/octet-stream", headers=headers)


def normalize_scene(scene: SceneDocumentModel) -> SceneDocumentModel:
    canvas = CanvasModel(
        width=max(1, scene.canvas.width),
        height=max(1, scene.canvas.height),
        background=normalize_color(scene.canvas.background or DEFAULT_CANVAS_BACKGROUND),
    )
    elements: list[SceneElementModel] = []
    sorted_elements = sorted(scene.elements, key=lambda item: item.zIndex)

    for index, element in enumerate(sorted_elements):
        shape_type = element.type if element.type in SHAPE_TYPES else "rectangle"
        elements.append(
            SceneElementModel(
                id=element.id or new_id(),
                name=element.name or "",
                type=shape_type,
                x=element.x,
                y=element.y,
                width=max(1.0, element.width),
                height=max(1.0, element.height),
                rotation=normalize_rotation(element.rotation),
                color=normalize_color(element.color),
                opacity=max(0.0, min(1.0, element.opacity)),
                zIndex=index,
                isBackground=element.isBackground,
            )
        )

    return SceneDocumentModel(
        canvas=canvas,
        elements=elements,
        meta=MetaModel(
            sourceType=scene.meta.sourceType,
            sourceName=scene.meta.sourceName,
            warnings=list(scene.meta.warnings),
        ),
        library=normalize_library(scene.library),
    )


def normalize_rotation(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    normalized = ((value + 180.0) % 360.0) - 180.0
    if abs(normalized + 180.0) < 1e-9 and value > 0:
        return 180.0
    return 0.0 if abs(normalized) < 1e-9 else normalized


def get_element_bounds(element: SceneElementModel) -> tuple[float, float, float, float]:
    radians = math.radians(element.rotation)
    cos_v = abs(math.cos(radians))
    sin_v = abs(math.sin(radians))
    bbox_width = element.width * cos_v + element.height * sin_v
    bbox_height = element.width * sin_v + element.height * cos_v
    return (
        element.x - bbox_width / 2,
        element.y - bbox_height / 2,
        element.x + bbox_width / 2,
        element.y + bbox_height / 2,
    )


def fit_scene_canvas_to_elements(
    scene: SceneDocumentModel,
    *,
    expand_only: bool = True,
    warning_message: str | None = None,
) -> SceneDocumentModel:
    if not scene.elements:
        return scene

    min_x = math.inf
    min_y = math.inf
    max_x = -math.inf
    max_y = -math.inf

    for element in scene.elements:
        left, top, right, bottom = get_element_bounds(element)
        min_x = min(min_x, left)
        min_y = min(min_y, top)
        max_x = max(max_x, right)
        max_y = max(max_y, bottom)

    shift_x = -min(0.0, min_x)
    shift_y = -min(0.0, min_y)
    fitted_width = max_x + shift_x
    fitted_height = max_y + shift_y

    target_width = fitted_width if not expand_only else max(scene.canvas.width, fitted_width)
    target_height = fitted_height if not expand_only else max(scene.canvas.height, fitted_height)

    should_shift = shift_x > 0.001 or shift_y > 0.001
    should_resize = abs(target_width - scene.canvas.width) > 0.001 or abs(target_height - scene.canvas.height) > 0.001

    if not should_shift and not should_resize:
        return scene

    shifted_elements = [
        SceneElementModel(
            id=element.id,
            name=element.name,
            type=element.type,
            x=element.x + shift_x,
            y=element.y + shift_y,
            width=element.width,
            height=element.height,
            rotation=element.rotation,
            color=element.color,
            opacity=element.opacity,
            zIndex=element.zIndex,
            isBackground=element.isBackground,
        )
        for element in scene.elements
    ]

    warnings = list(scene.meta.warnings)
    if warning_message and warning_message not in warnings:
        warnings.append(warning_message)

    return SceneDocumentModel(
        canvas=CanvasModel(
            width=target_width,
            height=target_height,
            background=scene.canvas.background,
        ),
        elements=shifted_elements,
        meta=MetaModel(
            sourceType=scene.meta.sourceType,
            sourceName=scene.meta.sourceName,
            warnings=warnings,
        ),
        library=scene.library,
    )


def normalize_library(library: SceneLibraryModel) -> SceneLibraryModel:
    default_map = {item["label"]: item for item in LIBRARY_CATEGORY_DEFINITIONS}
    categories: list[LibraryCategoryModel] = []
    seen_labels: set[str] = set()

    for category in library.categories:
        label = category.label or category.key
        definition = default_map.get(label)
        categories.append(
            LibraryCategoryModel(
                key=category.key or (definition["key"] if definition else label),
                label=label,
                supported=definition["supported"] if definition else bool(category.supported),
            )
        )
        seen_labels.add(label)

    for definition in LIBRARY_CATEGORY_DEFINITIONS:
        if definition["label"] not in seen_labels:
            categories.append(LibraryCategoryModel(**definition))

    saved_items: list[LibrarySavedItemModel] = []
    for index, item in enumerate(library.savedItems):
        shape_type = item.element.type if item.element.type in SHAPE_TYPES else "rectangle"
        saved_items.append(
            LibrarySavedItemModel(
                id=item.id or f"saved-{index}",
                name=item.name or f"{shape_type}-{index + 1}",
                category=item.category or "基础形状",
                element=SceneElementModel(
                    id=item.element.id or new_id(),
                    name=item.element.name or item.name or "",
                    type=shape_type,
                    x=item.element.x,
                    y=item.element.y,
                    width=max(1.0, item.element.width),
                    height=max(1.0, item.element.height),
                    rotation=item.element.rotation,
                    color=normalize_color(item.element.color),
                    opacity=max(0.0, min(1.0, item.element.opacity)),
                    zIndex=max(0, item.element.zIndex),
                    isBackground=item.element.isBackground,
                ),
            )
        )

    active_category = library.activeCategory or "基础形状"
    if active_category not in {category.label for category in categories}:
        active_category = "基础形状"

    presets_by_type = {
        preset.type: LibraryBaseShapePresetModel(
            type=preset.type,
            color=normalize_color(preset.color),
            width=max(1.0, preset.width),
            height=max(1.0, preset.height),
        )
        for preset in library.baseShapePresets
        if preset.type in SHAPE_TYPES
    }
    base_shape_presets = [
        presets_by_type.get(default_preset.type, default_preset)
        for default_preset in default_base_shape_presets()
    ]

    return SceneLibraryModel(
        activeCategory=active_category,
        categories=categories,
        baseShapePresets=base_shape_presets,
        savedItems=saved_items,
    )


def parse_json_scene(content: str) -> SceneDocumentModel:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"JSON 解析失败: {exc.msg}") from exc

    warnings: list[str] = []
    if isinstance(payload, dict) and "scene" in payload:
        payload = payload["scene"]

    if isinstance(payload, dict) and {"canvas", "elements"}.issubset(payload.keys()):
        scene = SceneDocumentModel.model_validate(
            {
                "canvas": payload.get("canvas", {}),
                "elements": payload.get("elements", []),
                "meta": payload.get("meta", {"sourceType": "json", "sourceName": "", "warnings": []}),
            }
        )
        scene.meta.sourceType = "json"
        return normalize_scene(scene)

    if isinstance(payload, dict) and "elements" in payload:
        elements = [convert_basic_json_element(item, index) for index, item in enumerate(payload["elements"])]
        scene = SceneDocumentModel(
            canvas=CanvasModel(),
            elements=elements,
            meta=MetaModel(sourceType="json", sourceName="", warnings=warnings),
        )
        return normalize_scene(
            fit_scene_canvas_to_elements(
                scene,
                expand_only=False,
                warning_message="JSON 未提供画布尺寸，已根据图元范围自动拟合画布。",
            )
        )

    if isinstance(payload, list):
        elements = [convert_basic_json_element(item, index) for index, item in enumerate(payload)]
        scene = SceneDocumentModel(
            canvas=CanvasModel(),
            elements=elements,
            meta=MetaModel(sourceType="json", sourceName="", warnings=warnings),
        )
        return normalize_scene(
            fit_scene_canvas_to_elements(
                scene,
                expand_only=False,
                warning_message="JSON 未提供画布尺寸，已根据图元范围自动拟合画布。",
            )
        )

    raise HTTPException(status_code=400, detail="不支持的 JSON 结构，期望为 SceneDocument 或 elements 数组")


def convert_basic_json_element(item: dict, index: int) -> SceneElementModel:
    if not isinstance(item, dict):
        raise HTTPException(status_code=400, detail="JSON elements 中存在非对象元素")

    shape_type = item.get("type", "rectangle")
    if shape_type not in SHAPE_TYPES:
        shape_type = "rectangle"

    return SceneElementModel(
        id=str(item.get("id") or new_id()),
        name=str(item.get("name", "")),
        type=shape_type,
        x=float(item.get("x", item.get("left", 150))),
        y=float(item.get("y", item.get("top", 150))),
        width=float(item.get("width", item.get("w", DEFAULT_SHAPE_SIZE))),
        height=float(item.get("height", item.get("h", DEFAULT_SHAPE_SIZE))),
        rotation=float(item.get("rotation", 0)),
        color=normalize_color(str(item.get("color", "#4f46e5"))),
        opacity=float(item.get("opacity", 1)),
        zIndex=int(item.get("zIndex", index)),
        isBackground=bool(item.get("isBackground", False)),
    )


def parse_css_scene(content: str) -> SceneDocumentModel:
    warnings: list[str] = []
    canvas_match = re.search(r"\.shaper-container\s*\{(?P<body>.*?)\}", content, re.S)
    width = DEFAULT_CANVAS_WIDTH
    height = DEFAULT_CANVAS_HEIGHT
    background = DEFAULT_CANVAS_BACKGROUND
    if canvas_match:
        body = canvas_match.group("body")
        width = parse_px(find_css_value(body, "width"), DEFAULT_CANVAS_WIDTH)
        height = parse_px(find_css_value(body, "height"), DEFAULT_CANVAS_HEIGHT)
        if find_css_value(body, "background") is not None or find_css_value(body, "background-color") is not None:
            warnings.append("已忽略 .shaper-container 的背景颜色；如需背景，请使用铺满画布的矩形图元表示。")
    pattern = re.compile(r"(?P<selector>[^{}]+)\{(?P<body>.*?)\}", re.S)
    elements: list[SceneElementModel] = []
    for match in pattern.finditer(content):
        selector = " ".join(match.group("selector").strip().split())
        body = match.group("body")
        if ".shaper-container" in selector:
            continue
        if find_css_value(body, "left") is None or find_css_value(body, "top") is None:
            continue
        if find_css_value(body, "width") is None or find_css_value(body, "height") is None:
            continue

        index = len(elements)
        triangle_border = parse_triangle_border(body)
        color = normalize_color(resolve_css_fill_color(body, DEFAULT_CANVAS_BACKGROUND))
        opacity = parse_float(find_css_value(body, "opacity"), 1.0)
        rotation = parse_rotation(find_css_value(body, "transform") or "")
        border_radius = (find_css_value(body, "border-radius") or "").strip()
        clip_path = normalize_clip_path(find_css_value(body, "clip-path"))
        if triangle_border is not None:
            shape_type = "triangle"
            shape_width = triangle_border["width"]
            shape_height = triangle_border["height"]
            color = normalize_color(triangle_border["color"])
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2) + shape_height / 2
        elif clip_path == TRIANGLE_CLIP_PATH:
            shape_type = "triangle"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
        elif border_radius == "50%":
            shape_type = "ellipse"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
        else:
            shape_type = "rectangle"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
        if index == 0 and shape_type == "rectangle":
            is_background = True
        else:
            is_background = False
        elements.append(
            SceneElementModel(
                id=f"css-{index}",
                name=selector_to_element_name(selector),
                type=shape_type,
                x=shape_x,
                y=shape_y,
                width=shape_width,
                height=shape_height,
                rotation=rotation,
                color=color,
                opacity=opacity,
                zIndex=int(parse_float(find_css_value(body, "z-index"), index)),
                isBackground=is_background,
            )
        )

    if not elements:
        raise HTTPException(status_code=400, detail="没有从 CSS 中解析出任何可定位图元")

    scene = SceneDocumentModel(
        canvas=CanvasModel(width=width, height=height, background=background),
        elements=elements,
        meta=MetaModel(sourceType="css", sourceName="", warnings=warnings),
    )

    if not canvas_match:
        scene.meta.warnings.append("未找到 .shaper-container，已根据图元范围自动拟合画布尺寸。")
        return normalize_scene(fit_scene_canvas_to_elements(scene, expand_only=False))

    has_overflow = False
    for element in elements:
        left, top, right, bottom = get_element_bounds(element)
        if left < 0 or top < 0 or right > width or bottom > height:
            has_overflow = True
            break

    if has_overflow:
        scene = fit_scene_canvas_to_elements(
            scene,
            expand_only=True,
            warning_message="检测到部分图元超出 CSS 容器范围，已自动扩展画布以容纳全部图元。",
        )

    return normalize_scene(scene)


def parse_svg_scene(content: str) -> SceneDocumentModel:
    warnings: list[str] = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail=f"SVG 解析失败: {exc}") from exc

    width = parse_svg_number(root.attrib.get("width"), DEFAULT_CANVAS_WIDTH)
    height = parse_svg_number(root.attrib.get("height"), DEFAULT_CANVAS_HEIGHT)
    view_box = root.attrib.get("viewBox")
    if view_box:
        parts = re.split(r"[\s,]+", view_box.strip())
        if len(parts) == 4:
            width = parse_float(parts[2], width)
            height = parse_float(parts[3], height)

    elements: list[SceneElementModel] = []
    unsupported_tags: list[str] = []
    for index, node in enumerate(root.iter()):
        tag = strip_ns(node.tag)
        if tag == "svg":
            continue

        fill = node.attrib.get("fill", "#4f46e5")
        opacity = parse_float(node.attrib.get("opacity"), 1.0)

        if tag == "rect":
            x = parse_svg_number(node.attrib.get("x"), 0.0)
            y = parse_svg_number(node.attrib.get("y"), 0.0)
            w = parse_svg_number(node.attrib.get("width"), DEFAULT_SHAPE_SIZE)
            h = parse_svg_number(node.attrib.get("height"), DEFAULT_SHAPE_SIZE)
            elements.append(
                SceneElementModel(
                    id=new_id(),
                    type="rectangle",
                    x=x + w / 2,
                    y=y + h / 2,
                    width=w,
                    height=h,
                    rotation=0,
                    color=normalize_color(fill),
                    opacity=opacity,
                    zIndex=index,
                    isBackground=index == 0,
                )
            )
        elif tag == "circle":
            cx = parse_svg_number(node.attrib.get("cx"), width / 2)
            cy = parse_svg_number(node.attrib.get("cy"), height / 2)
            r = parse_svg_number(node.attrib.get("r"), DEFAULT_SHAPE_SIZE / 2)
            elements.append(
                SceneElementModel(
                    id=new_id(),
                    type="ellipse",
                    x=cx,
                    y=cy,
                    width=r * 2,
                    height=r * 2,
                    rotation=0,
                    color=normalize_color(fill),
                    opacity=opacity,
                    zIndex=index,
                    isBackground=index == 0,
                )
            )
        elif tag == "ellipse":
            cx = parse_svg_number(node.attrib.get("cx"), width / 2)
            cy = parse_svg_number(node.attrib.get("cy"), height / 2)
            rx = parse_svg_number(node.attrib.get("rx"), DEFAULT_SHAPE_SIZE / 2)
            ry = parse_svg_number(node.attrib.get("ry"), DEFAULT_SHAPE_SIZE / 2)
            elements.append(
                SceneElementModel(
                    id=new_id(),
                    type="ellipse",
                    x=cx,
                    y=cy,
                    width=rx * 2,
                    height=ry * 2,
                    rotation=0,
                    color=normalize_color(fill),
                    opacity=opacity,
                    zIndex=index,
                    isBackground=index == 0,
                )
            )
        elif tag == "polygon":
            points = parse_polygon_points(node.attrib.get("points", ""))
            if len(points) == 3:
                min_x = min(point[0] for point in points)
                max_x = max(point[0] for point in points)
                min_y = min(point[1] for point in points)
                max_y = max(point[1] for point in points)
                elements.append(
                    SceneElementModel(
                        id=new_id(),
                        type="triangle",
                        x=(min_x + max_x) / 2,
                        y=(min_y + max_y) / 2,
                        width=max_x - min_x,
                        height=max_y - min_y,
                        rotation=0,
                        color=normalize_color(fill),
                        opacity=opacity,
                        zIndex=index,
                        isBackground=index == 0,
                    )
                )
            else:
                unsupported_tags.append("polygon")
        else:
            unsupported_tags.append(tag)

    if unsupported_tags:
        warnings.append(f"部分 SVG 节点未导入: {', '.join(sorted(set(unsupported_tags)))}")
    if not elements:
        raise HTTPException(status_code=400, detail="SVG 中没有可导入的基础图形")

    scene = SceneDocumentModel(
        canvas=CanvasModel(width=width, height=height, background=DEFAULT_CANVAS_BACKGROUND),
        elements=elements,
        meta=MetaModel(sourceType="svg", sourceName="", warnings=warnings),
    )
    return normalize_scene(scene)


def scene_to_css(scene: SceneDocumentModel) -> str:
    lines = [
        "/* Miliastra CSS Export */",
        ".shaper-container {",
        "  position: relative;",
        f"  width: {scene.canvas.width:.0f}px;",
        f"  height: {scene.canvas.height:.0f}px;",
        f"  background: {DEFAULT_CANVAS_BACKGROUND};",
        "  overflow: hidden;",
        "}",
        ".shaper-element {",
        "  position: absolute;",
        "  box-sizing: border-box;",
        "}",
    ]

    for index, element in enumerate(sorted(scene.elements, key=lambda item: item.zIndex)):
        lines.extend(
            [
                f".shaper-element.shaper-e{index} {{",
                f"  left: {element.x:.2f}px;",
                f"  top: {element.y:.2f}px;",
                f"  width: {element.width:.2f}px;",
                f"  height: {element.height:.2f}px;",
                f"  background: {element.color};",
                f"  opacity: {element.opacity:.4f};",
                f"  transform: translate(-50%, -50%) rotate({-element.rotation:.2f}deg);",
                "  transform-origin: 50% 50%;",
                f"  z-index: {element.zIndex};",
            ]
        )
        if element.type == "ellipse":
            lines.append("  border-radius: 50%;")
        if element.type == "triangle":
            lines.append(f"  clip-path: {TRIANGLE_CLIP_PATH};")
        lines.append("}")
    return "\n".join(lines)


def scene_to_svg(scene: SceneDocumentModel) -> str:
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{scene.canvas.width:.0f}" height="{scene.canvas.height:.0f}" viewBox="0 0 {scene.canvas.width:.0f} {scene.canvas.height:.0f}">',
        f'<rect x="0" y="0" width="{scene.canvas.width:.0f}" height="{scene.canvas.height:.0f}" fill="{scene.canvas.background}" />',
    ]

    for element in sorted(scene.elements, key=lambda item: item.zIndex):
        transform = f'rotate({-element.rotation:.2f} {element.x:.2f} {element.y:.2f})'
        opacity = f'{element.opacity:.4f}'
        if element.type == "ellipse":
            parts.append(
                f'<ellipse cx="{element.x:.2f}" cy="{element.y:.2f}" rx="{element.width / 2:.2f}" ry="{element.height / 2:.2f}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        elif element.type == "triangle":
            points = triangle_points(element.x, element.y, element.width, element.height)
            parts.append(
                f'<polygon points="{format_points(points)}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        elif element.type == "four_point_star":
            points = star_points(element.x, element.y, element.width, element.height, 4, 0.45)
            parts.append(
                f'<polygon points="{format_points(points)}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        elif element.type == "five_point_star":
            points = star_points(element.x, element.y, element.width, element.height, 5, 0.42)
            parts.append(
                f'<polygon points="{format_points(points)}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        else:
            parts.append(
                f'<rect x="{element.x - element.width / 2:.2f}" y="{element.y - element.height / 2:.2f}" width="{element.width:.2f}" height="{element.height:.2f}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )

    parts.append("</svg>")
    return "\n".join(parts)


def scene_to_png_bytes(scene: SceneDocumentModel) -> bytes:
    image = Image.new("RGBA", (int(scene.canvas.width), int(scene.canvas.height)), ImageColor.getrgb(scene.canvas.background) + (255,))
    draw = ImageDraw.Draw(image, "RGBA")

    for element in sorted(scene.elements, key=lambda item: item.zIndex):
        rgba = color_with_alpha(element.color, element.opacity)
        if element.type == "ellipse":
            draw_ellipse(draw, element, rgba)
        elif element.type == "triangle":
            draw_polygon(draw, triangle_points(element.x, element.y, element.width, element.height), rgba, element.rotation)
        elif element.type == "four_point_star":
            draw_polygon(draw, star_points(element.x, element.y, element.width, element.height, 4, 0.45), rgba, element.rotation)
        elif element.type == "five_point_star":
            draw_polygon(draw, star_points(element.x, element.y, element.width, element.height, 5, 0.42), rgba, element.rotation)
        else:
            draw_rect(draw, element, rgba)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def scene_to_gia_document(scene: SceneDocumentModel, group_name: str | None = None) -> dict:
    elements = []
    canvas_center_x = scene.canvas.width / 2
    canvas_center_y = scene.canvas.height / 2

    ordered_elements = sorted(scene.elements, key=lambda item: (0 if item.isBackground else 1, item.zIndex))
    for element in ordered_elements:
        if element.type not in GIA_SHAPE_TYPES:
            continue

        size: dict[str, float]
        if element.type == "ellipse":
            size = {"rx": round(element.width / 2, 4), "ry": round(element.height / 2, 4)}
        else:
            size = {"width": round(element.width, 4), "height": round(element.height, 4)}

        elements.append(
            {
                "type": element.type,
                "relative": {
                    "x": round(element.x - canvas_center_x, 4),
                    "y": round(canvas_center_y - element.y, 4),
                },
                "size": size,
                "rotation": {"x": 0, "y": 0, "z": round(element.rotation, 4)},
                "image_asset_ref": IMAGE_ASSET_REFS[element.type],
                "packed_color": to_packed_argb(element.color, element.opacity),
                "name": str(element.zIndex + 1),
                "is_background": element.isBackground,
            }
        )

    if not elements:
        raise HTTPException(status_code=400, detail="当前场景没有可导出的 GIA 基础图元")

    return {
        "group_name": normalize_gia_group_name(group_name),
        "elements": elements,
    }


def convert_scene_to_gia_bytes(gia_json: dict) -> bytes:
    if not GIA_PY_PATH.exists() or not GIA_TEMPLATE_PATH.exists():
        raise HTTPException(status_code=500, detail="未找到外部 GIA 导出脚本或模板文件")

    spec = importlib.util.spec_from_file_location("miliastra_gia_json_to_gia", GIA_PY_PATH)
    if spec is None or spec.loader is None:
        raise HTTPException(status_code=500, detail="无法加载 GIA 导出模块")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.convert_json_to_gia_bytes(
        json_data=gia_json,
        base_gia_path=str(GIA_TEMPLATE_PATH),
        verbose=False,
        mode=module.MODE_IMAGE,
    )


def download_text(content: str, filename: str, media_type: str) -> Response:
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=content.encode("utf-8"), media_type=media_type, headers=headers)


def normalize_gia_group_name(value: str | None) -> str:
    if not value:
        return default_gia_group_name()
    normalized = value.strip()
    return normalized or default_gia_group_name()


def find_css_value(body: str, property_name: str) -> str | None:
    match = re.search(rf"{re.escape(property_name)}\s*:\s*([^;]+);", body)
    return match.group(1).strip() if match else None


def selector_to_element_name(selector: str) -> str:
    primary = selector.split(",")[0].strip()
    primary = re.sub(r"\s+", " ", primary)
    primary = primary.replace("{", "").replace("}", "")
    return primary or "css-element"


def resolve_css_fill_color(body: str, default: str) -> str:
    background = find_css_value(body, "background")
    if background:
        return background
    background_color = find_css_value(body, "background-color")
    if background_color:
        return background_color
    return default


def normalize_clip_path(value: str | None) -> str:
    if not value:
        return ""
    return re.sub(r"\s+", " ", value).strip().lower()


def parse_border_shorthand(value: str | None) -> dict[str, str] | None:
    if not value:
        return None
    match = re.search(r"(-?\d+(\.\d+)?)px\s+\w+\s+(.+)", value.strip(), re.I)
    if not match:
        return None
    return {"width": match.group(1), "color": match.group(3).strip()}


def parse_triangle_border(body: str) -> dict[str, float | str] | None:
    border_left = parse_border_shorthand(find_css_value(body, "border-left"))
    border_right = parse_border_shorthand(find_css_value(body, "border-right"))
    border_bottom = parse_border_shorthand(find_css_value(body, "border-bottom"))
    if border_left is None or border_right is None or border_bottom is None:
        return None

    bottom_color = border_bottom["color"].strip().lower()
    if bottom_color == "transparent":
        return None

    left_width = max(0.0, float(border_left["width"]))
    right_width = max(0.0, float(border_right["width"]))
    bottom_width = max(0.0, float(border_bottom["width"]))
    if left_width <= 0 or right_width <= 0 or bottom_width <= 0:
        return None

    return {
        "width": left_width + right_width,
        "height": bottom_width,
        "color": border_bottom["color"],
    }


def parse_px(value: str | None, default: float) -> float:
    if not value:
        return default
    match = re.search(r"-?\d+(\.\d+)?", value)
    return float(match.group(0)) if match else default


def parse_float(value: str | None, default: float) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def parse_rotation(transform: str) -> float:
    match = re.search(r"rotate\((-?\d+(\.\d+)?)deg\)", transform)
    # Scene rotation uses CCW-positive semantics, so screen-space CSS needs the opposite sign.
    return -float(match.group(1)) if match else 0.0


def normalize_color(value: str) -> str:
    value = value.strip()
    if not value:
        return "#4f46e5"
    lowered = value.lower()
    if lowered.startswith("#"):
        hex_value = lowered[1:]
        if len(hex_value) in {3, 4} and HEX_COLOR_RE.fullmatch(hex_value):
            expanded = "".join(char * 2 for char in hex_value[:3])
            return f"#{expanded}"
        if len(hex_value) in {6, 8} and HEX_COLOR_RE.fullmatch(hex_value):
            return f"#{hex_value[:6]}"
        return "#4f46e5"
    if lowered.startswith("rgb"):
        try:
            return rgb_string_to_hex(lowered)
        except ValueError:
            return "#4f46e5"
    try:
        ImageColor.getrgb(lowered)
    except ValueError:
        return "#4f46e5"
    return lowered


def rgb_string_to_hex(value: str) -> str:
    numbers = [max(0, min(255, int(part))) for part in re.findall(r"-?\d+", value)[:3]]
    if len(numbers) != 3:
        raise ValueError("invalid rgb")
    return "#{:02x}{:02x}{:02x}".format(*numbers)


def parse_svg_number(value: str | None, default: float) -> float:
    if value is None:
        return default
    match = re.search(r"-?\d+(\.\d+)?", value)
    return float(match.group(0)) if match else default


def strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1]


def parse_polygon_points(value: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for pair in re.findall(r"(-?\d+(\.\d+)?),(-?\d+(\.\d+)?)", value):
        points.append((float(pair[0]), float(pair[2])))
    return points


def triangle_points(cx: float, cy: float, width: float, height: float) -> list[tuple[float, float]]:
    half_w = width / 2
    half_h = height / 2
    return [
        (cx, cy - half_h),
        (cx - half_w, cy + half_h),
        (cx + half_w, cy + half_h),
    ]


def star_points(cx: float, cy: float, width: float, height: float, points: int, inner_ratio: float) -> list[tuple[float, float]]:
    result: list[tuple[float, float]] = []
    outer_rx = width / 2
    outer_ry = height / 2
    inner_rx = outer_rx * inner_ratio
    inner_ry = outer_ry * inner_ratio
    total = points * 2

    for index in range(total):
        angle = -math.pi / 2 + index * math.pi / points
        radius_x = outer_rx if index % 2 == 0 else inner_rx
        radius_y = outer_ry if index % 2 == 0 else inner_ry
        result.append((cx + math.cos(angle) * radius_x, cy + math.sin(angle) * radius_y))
    return result


def format_points(points: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:.2f},{y:.2f}" for x, y in points)


def rotate_points(points: list[tuple[float, float]], cx: float, cy: float, degrees: float) -> list[tuple[float, float]]:
    radians = math.radians(degrees)
    cos_v = math.cos(radians)
    sin_v = math.sin(radians)
    rotated: list[tuple[float, float]] = []
    for x, y in points:
        dx = x - cx
        dy = y - cy
        rotated.append((cx + dx * cos_v - dy * sin_v, cy + dx * sin_v + dy * cos_v))
    return rotated


def draw_polygon(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], fill: tuple[int, int, int, int], rotation: float) -> None:
    cx = sum(point[0] for point in points) / len(points)
    cy = sum(point[1] for point in points) / len(points)
    # PIL drawing happens in screen coordinates, so invert CCW-positive scene rotation.
    draw.polygon(rotate_points(points, cx, cy, -rotation), fill=fill)


def draw_rect(draw: ImageDraw.ImageDraw, element: SceneElementModel, fill: tuple[int, int, int, int]) -> None:
    points = [
        (element.x - element.width / 2, element.y - element.height / 2),
        (element.x + element.width / 2, element.y - element.height / 2),
        (element.x + element.width / 2, element.y + element.height / 2),
        (element.x - element.width / 2, element.y + element.height / 2),
    ]
    draw_polygon(draw, points, fill, element.rotation)


def draw_ellipse(draw: ImageDraw.ImageDraw, element: SceneElementModel, fill: tuple[int, int, int, int]) -> None:
    left = element.x - element.width / 2
    top = element.y - element.height / 2
    right = element.x + element.width / 2
    bottom = element.y + element.height / 2
    if abs(element.rotation) < 0.001:
        draw.ellipse([left, top, right, bottom], fill=fill)
        return

    polygon: list[tuple[float, float]] = []
    for index in range(36):
        angle = math.tau * index / 36
        polygon.append(
            (
                element.x + math.cos(angle) * element.width / 2,
                element.y + math.sin(angle) * element.height / 2,
            )
        )
    draw_polygon(draw, polygon, fill, element.rotation)


def color_with_alpha(color: str, opacity: float) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(normalize_color(color))
    return r, g, b, max(0, min(255, round(opacity * 255)))


def to_packed_argb(color: str, opacity: float) -> int:
    r, g, b = ImageColor.getrgb(normalize_color(color))
    alpha = max(0, min(255, round(opacity * 255)))
    return (alpha << 24) | (r << 16) | (g << 8) | b


def new_id() -> str:
    return uuid4().hex[:8]


ASSETS_DIR = STATIC_DIR / "assets"
if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/{full_path:path}")
def serve_spa(full_path: str) -> Response:
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    if INDEX_FILE.exists():
        return FileResponse(INDEX_FILE)
    return Response(
        content="Frontend has not been built yet. Run `npm run build` in the frontend directory.",
        media_type="text/plain; charset=utf-8",
    )
