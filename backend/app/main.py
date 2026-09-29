from __future__ import annotations

import importlib.util
import io
import json
import math
import re
import urllib.error
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Literal
from uuid import uuid4
from xml.etree import ElementTree as ET

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageFont, PngImagePlugin

from . import image_library, lua_scene
from .image_library import fetch_sprite_bytes, sprite_url

ROOT_DIR = Path(__file__).resolve().parents[2]
STATIC_DIR = ROOT_DIR / "backend" / "app" / "static"
INDEX_FILE = STATIC_DIR / "index.html"
GIA_DIR = ROOT_DIR / "backend" / "vendor" / "gia"
GIA_PY_PATH = GIA_DIR / "json_to_gia.py"
GIA_TEMPLATE_PATH = GIA_DIR / "image_template.gia"

DEFAULT_CANVAS_WIDTH = 300
DEFAULT_CANVAS_HEIGHT = 300
DEFAULT_CANVAS_BACKGROUND = "#ffffff"
# 画布透明哨兵值：前端画棋盘格、PNG 导出留 alpha、SVG 不画底、CSS 用 transparent
TRANSPARENT_BACKGROUND = "transparent"
DEFAULT_SHAPE_SIZE = 80.0
HEX_COLOR_RE = re.compile(r"^[0-9a-f]+$")
TRIANGLE_CLIP_PATH = "polygon(50% 0%, 0% 100%, 100% 100%)"
# 与 frontend/src/styles.css 的星形 clip-path 相同，以图元尺寸盒为坐标系。
STAR_VERTICES = {
    4: [(50, 0), (62, 38), (100, 50), (62, 62), (50, 100), (38, 62), (0, 50), (38, 38)],
    5: [(50, 0), (61, 35), (98, 35), (68, 57), (79, 92), (50, 71), (21, 92), (32, 57), (2, 35), (39, 35)],
}
STAR_CLIP_PATHS = {
    f"{name}_point_star": "polygon(" + ", ".join(f"{x}% {y}%" for x, y in STAR_VERTICES[count]) + ")"
    for name, count in (("four", 4), ("five", 5))
}
RING_INNER_RATIO = 0.8
RING_GRADIENT_RE = re.compile(
    r"radial-gradient\([^)]*transparent\s+[\d.]+%\s*,\s*(#[0-9a-f]{3,8}|rgb\([^)]*\)|[a-z]+)\s*[\d.]+%"
)

IMAGE_ASSET_REFS = {
    "rectangle": 100001,
    "ellipse": 100002,
    "triangle": 100003,
    "four_point_star": 100004,
    "five_point_star": 100005,
    "ring": 100006,
}

# SVG 导入时从贴图直链里反解素材 id
SPRITE_URL_RE = re.compile(r"/sprite/(\d{6})\.png")

# PNG 导出并发预取素材贴图的工作线程数
SPRITE_PREFETCH_WORKERS = 4

IMPORT_SOURCE_TYPES = {"json", "css", "svg", "lua"}
SHAPE_TYPES = {
    "ellipse",
    "rectangle",
    "triangle",
    "four_point_star",
    "five_point_star",
    "ring",
    "textbox",
    "image",
    "other",
}
GIA_SHAPE_TYPES = {
    "ellipse",
    "rectangle",
    "triangle",
    "four_point_star",
    "five_point_star",
    "ring",
    "textbox",
    "image",
}
AlignH = Literal["left", "center", "right"]
AlignV = Literal["top", "middle", "bottom"]
AnchorType = Literal["center", "custom"]
TEXTBOX_STYLE_ID = 260326
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


def element_asset_id(element: "SceneElementModel") -> int | None:
    """图元对应的素材库 sprite id：基础形状查表，图片图元用自带 id。"""
    if element.type == "image":
        return element.imageAssetId
    return IMAGE_ASSET_REFS.get(element.type)


def default_base_shape_presets() -> list["LibraryBaseShapePresetModel"]:
    return [
        LibraryBaseShapePresetModel(type="ellipse", color="#0f766e", width=88, height=88),
        LibraryBaseShapePresetModel(type="rectangle", color="#c2410c", width=102, height=70),
        LibraryBaseShapePresetModel(type="triangle", color="#7c3aed", width=96, height=86),
        LibraryBaseShapePresetModel(type="four_point_star", color="#0f4c81", width=90, height=90),
        LibraryBaseShapePresetModel(type="five_point_star", color="#be123c", width=92, height=92),
        LibraryBaseShapePresetModel(type="ring", color="#f59e0b", width=92, height=92),
        LibraryBaseShapePresetModel(type="textbox", color="#ffffff", width=180, height=40),
    ]


def default_gia_group_name() -> str:
    return date.today().strftime("%Y%m%d")


class CanvasModel(BaseModel):
    width: float = DEFAULT_CANVAS_WIDTH
    height: float = DEFAULT_CANVAS_HEIGHT
    background: str = DEFAULT_CANVAS_BACKGROUND


class MetaModel(BaseModel):
    sourceType: Literal["json", "css", "svg", "lua", "editor"] = "editor"
    sourceName: str = ""
    warnings: list[str] = Field(default_factory=list)


class LibraryCategoryModel(BaseModel):
    key: str
    label: str
    supported: bool = False


class TextBoxModel(BaseModel):
    text: str = ""
    fontSize: int = 20
    autoSize: bool = True
    minFontSize: int = 12
    textColor: str = "#ffffff"
    textOpacity: float = 1.0
    bgColor: str = "#ffffff"
    bgOpacity: float = 0.0
    outlineEnabled: bool = True
    outlineColor: str = "#333333"
    outlineOpacity: float = 0.2
    alignH: AlignH = "left"
    alignV: AlignV = "top"
    anchorType: AnchorType = "center"
    visible: bool = True
    scaleX: float = 1.0
    scaleY: float = 1.0
    anchorMinX: float = 0.5
    anchorMinY: float = 0.5
    anchorMaxX: float = 0.5
    anchorMaxY: float = 0.5
    pivotX: float = 0.5
    pivotY: float = 0.5


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
    textBox: TextBoxModel | None = None
    # type == "image" 时生效：素材库 sprite id，以及是否用 color 参与染色（所有素材均支持）
    imageAssetId: int | None = None
    imageTint: bool = False


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
    sourceType: Literal["json", "css", "svg", "lua"]
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


def library_proxy_response(
    result: image_library.BundleResult,
    media_type: str = "application/json; charset=utf-8",
) -> Response:
    """把上游条件请求的结果透传给浏览器，复用完全靠浏览器的 HTTP 缓存。"""
    headers = {
        "ETag": result.etag,
        # 与 OSS 自身的 max-age 对齐，浏览器在该窗口内不必回访本服务
        "Cache-Control": f"public, max-age={image_library.browser_max_age()}",
    }
    if result.not_modified or result.payload is None:
        return Response(status_code=304, headers=headers)
    return Response(content=result.payload, media_type=media_type, headers=headers)


@app.get("/api/library/catalog")
def library_catalog(request: Request, refresh: bool = False) -> Response:
    """图片素材库索引（data.json + 中英分类名合并后的单一响应）。"""
    try:
        result = image_library.get_catalog_bundle(request.headers.get("if-none-match"), force=refresh)
    except image_library.LibraryUpstreamError as error:
        raise HTTPException(status_code=502, detail=f"图片素材库索引不可用：{error}") from error
    return library_proxy_response(result)


@app.get("/api/library/meta/{image_id}")
def library_image_meta(image_id: str, request: Request, refresh: bool = False) -> Response:
    """单个素材的 Sprite 元数据（尺寸 / 九宫格），按需请求。"""
    try:
        result = image_library.get_image_meta(
            image_id,
            request.headers.get("if-none-match"),
            force=refresh,
        )
    except image_library.LibraryIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except image_library.LibraryNotFoundError:
        raise HTTPException(status_code=404, detail=f"该素材没有元数据文件：border/{image_id}.json") from None
    except image_library.LibraryUpstreamError as error:
        raise HTTPException(status_code=502, detail=f"素材元数据不可用：{error}") from error
    return library_proxy_response(result)


@app.get("/api/library/sprite/{image_id}")
def library_sprite(image_id: str, request: Request, refresh: bool = False) -> Response:
    """素材贴图代理：单色素材的 CSS 遮罩要求同源，跨域遮罩会让元素整块消失。

    只在需要染色时使用；彩色素材在前端仍然直连 OSS，不消耗后端带宽。
    """
    try:
        result = image_library.get_sprite(image_id, request.headers.get("if-none-match"), force=refresh)
    except image_library.LibraryIdError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except image_library.LibraryNotFoundError:
        raise HTTPException(status_code=404, detail=f"素材不存在：sprite/{image_id}.png") from None
    except image_library.LibraryUpstreamError as error:
        raise HTTPException(status_code=502, detail=f"素材贴图不可用：{error}") from error
    return library_proxy_response(result, media_type="image/png")


@app.post("/api/import", response_model=ImportResponse)
def import_scene(request: ImportRequest) -> ImportResponse:
    if request.sourceType not in IMPORT_SOURCE_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported sourceType")

    if request.sourceType == "json":
        scene = parse_json_scene(request.content)
    elif request.sourceType == "css":
        scene = parse_css_scene(request.content)
    elif request.sourceType == "lua":
        scene = parse_lua_scene(request.content)
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


@app.post("/api/export/lua")
def export_lua(request: ExportRequest) -> Response:
    scene = normalize_scene(request.scene)
    image_scene = scene.model_copy(update={
        "elements": [element for element in scene.elements if element_asset_id(element) is not None]
    })
    try:
        gia_bytes = None
        if image_scene.elements:
            gia_document = scene_to_gia_document(image_scene, request.giaGroupName)
            # The editor canvas allows overflowing art; remove the base GIA
            # template's mask before handing it to the shared Lua converter.
            gia_document["mask"] = {"enabled": False}
            gia_bytes = convert_scene_to_gia_bytes(gia_document)
        content = lua_scene.dumps(scene.model_dump(), gia_bytes, request.giaGroupName)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return download_text(content, "scene.lua", "text/plain; charset=utf-8")


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


def default_textbox() -> TextBoxModel:
    return TextBoxModel()


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def normalize_align_h(value: str | None) -> AlignH:
    if value in ("left", "center", "right"):
        return value
    return "center"


def normalize_align_v(value: str | None) -> AlignV:
    if value in ("top", "middle", "bottom"):
        return value
    return "middle"


def normalize_anchor_type(value: str | None) -> AnchorType:
    if value == "custom":
        return "custom"
    return "center"


def normalize_textbox(text_box: TextBoxModel | None, *, color: str, opacity: float) -> TextBoxModel | None:
    if text_box is None:
        return None
    text_color = normalize_color(text_box.textColor or color)
    text_opacity = clamp01(text_box.textOpacity if text_box.textOpacity is not None else opacity)
    return TextBoxModel(
        text=text_box.text if text_box.text is not None else "文本",
        fontSize=max(1, int(text_box.fontSize or 20)),
        autoSize=bool(text_box.autoSize),
        minFontSize=max(1, int(text_box.minFontSize or 12)),
        textColor=text_color,
        textOpacity=text_opacity,
        bgColor=normalize_color(text_box.bgColor or "#ffffff"),
        bgOpacity=clamp01(text_box.bgOpacity),
        outlineEnabled=bool(text_box.outlineEnabled),
        outlineColor=normalize_color(text_box.outlineColor or "#111111"),
        outlineOpacity=clamp01(text_box.outlineOpacity),
        alignH=normalize_align_h(text_box.alignH),
        alignV=normalize_align_v(text_box.alignV),
        anchorType=normalize_anchor_type(getattr(text_box, "anchorType", None)),
        visible=bool(text_box.visible),
        scaleX=float(text_box.scaleX or 1.0),
        scaleY=float(text_box.scaleY or 1.0),
        anchorMinX=0.5 if normalize_anchor_type(getattr(text_box, "anchorType", None)) == "center" else float(text_box.anchorMinX),
        anchorMinY=0.5 if normalize_anchor_type(getattr(text_box, "anchorType", None)) == "center" else float(text_box.anchorMinY),
        anchorMaxX=0.5 if normalize_anchor_type(getattr(text_box, "anchorType", None)) == "center" else float(text_box.anchorMaxX),
        anchorMaxY=0.5 if normalize_anchor_type(getattr(text_box, "anchorType", None)) == "center" else float(text_box.anchorMaxY),
        pivotX=float(text_box.pivotX if text_box.pivotX is not None else 0.5),
        pivotY=float(text_box.pivotY if text_box.pivotY is not None else 0.5),
    )


def ensure_textbox(element: SceneElementModel) -> TextBoxModel | None:
    if element.type != "textbox":
        return None
    if element.textBox is not None:
        return normalize_textbox(element.textBox, color=element.color, opacity=element.opacity)
    return normalize_textbox(
        TextBoxModel(textColor=element.color, textOpacity=element.opacity),
        color=element.color,
        opacity=element.opacity,
    )


def copy_element(element: SceneElementModel, **overrides) -> SceneElementModel:
    payload = element.model_dump()
    payload.update(overrides)
    return SceneElementModel.model_validate(payload)


def normalize_canvas_background(value: str | None) -> str:
    """画布背景允许透明；其余按颜色归一化，空值回落默认白。"""
    lowered = (value or "").strip().lower()
    if lowered in {"transparent", "none"}:
        return TRANSPARENT_BACKGROUND
    if not lowered:
        return DEFAULT_CANVAS_BACKGROUND
    return normalize_color(value or DEFAULT_CANVAS_BACKGROUND)


def normalize_scene(scene: SceneDocumentModel) -> SceneDocumentModel:
    canvas = CanvasModel(
        width=max(1, scene.canvas.width),
        height=max(1, scene.canvas.height),
        background=normalize_canvas_background(scene.canvas.background),
    )
    elements: list[SceneElementModel] = []
    sorted_elements = sorted(scene.elements, key=lambda item: item.zIndex)

    for index, element in enumerate(sorted_elements):
        shape_type = element.type if element.type in SHAPE_TYPES else "rectangle"
        image_asset_id: int | None = None
        image_tint = False
        if shape_type == "image":
            candidate = element.imageAssetId
            if isinstance(candidate, int) and 0 < candidate < 10_000_000:
                image_asset_id = candidate
                image_tint = bool(element.imageTint)
            else:
                # 缺少素材 id 的图片图元无法导出，退化为基础形状
                shape_type = "rectangle"
        color = normalize_color(element.color)
        opacity = clamp01(element.opacity)
        text_box = ensure_textbox(
            SceneElementModel(
                id=element.id or new_id(),
                name=element.name or "",
                type=shape_type,
                x=element.x,
                y=element.y,
                width=max(1.0, element.width),
                height=max(1.0, element.height),
                rotation=normalize_rotation(element.rotation),
                color=color,
                opacity=opacity,
                zIndex=index,
                isBackground=element.isBackground,
                textBox=element.textBox,
                imageAssetId=image_asset_id,
                imageTint=image_tint,
            )
        )
        if shape_type == "textbox" and text_box is not None:
            color = text_box.textColor
            opacity = text_box.textOpacity
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
                color=color,
                opacity=opacity,
                zIndex=index,
                isBackground=element.isBackground,
                textBox=text_box,
                imageAssetId=image_asset_id,
                imageTint=image_tint,
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
        copy_element(element, x=element.x + shift_x, y=element.y + shift_y)
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
        saved_asset_id = item.element.imageAssetId if shape_type == "image" else None
        if shape_type == "image" and not (isinstance(saved_asset_id, int) and 0 < saved_asset_id < 10_000_000):
            shape_type = "rectangle"
            saved_asset_id = None
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
                    textBox=ensure_textbox(item.element) if shape_type == "textbox" else None,
                    imageAssetId=saved_asset_id,
                    imageTint=bool(item.element.imageTint) if shape_type == "image" else False,
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


def parse_lua_scene(content: str) -> SceneDocumentModel:
    try:
        scene = SceneDocumentModel.model_validate(lua_scene.loads(content))
        # Lua has no NaN/Infinity literals; reject numeric strings that bypass the parser.
        json.dumps(scene.model_dump(), allow_nan=False)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(status_code=400, detail=f"Lua import failed: {exc}") from exc
    scene.meta.sourceType = "lua"
    return normalize_scene(scene)


def parse_json_scene(content: str) -> SceneDocumentModel:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"JSON parse failed: {exc.msg}") from exc

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
                warning_message="JSON did not provide a canvas size; the canvas was auto-fitted to the element bounds.",
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
                warning_message="JSON did not provide a canvas size; the canvas was auto-fitted to the element bounds.",
            )
        )

    raise HTTPException(status_code=400, detail="Unsupported JSON structure; expected a SceneDocument or an elements array")


def convert_basic_json_element(item: dict, index: int) -> SceneElementModel:
    if not isinstance(item, dict):
        raise HTTPException(status_code=400, detail="JSON elements contains a non-object item")

    shape_type = item.get("type", "rectangle")
    if shape_type not in SHAPE_TYPES:
        shape_type = "rectangle"

    color = normalize_color(str(item.get("color", "#4f46e5")))
    opacity = float(item.get("opacity", 1))
    image_asset_id = None
    image_tint = False
    if shape_type == "image":
        raw_asset = item.get("imageAssetId", item.get("image_asset_id", item.get("assetId")))
        try:
            image_asset_id = int(raw_asset)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            image_asset_id = None
        image_tint = bool(item.get("imageTint", item.get("image_tint", False)))
    text_box = None
    if shape_type == "textbox":
        raw_box = item.get("textBox") or item.get("textbox") or {}
        if not isinstance(raw_box, dict):
            raw_box = {}
        text_box = TextBoxModel.model_validate(
            {
                "text": item.get("text", raw_box.get("text", "文本")),
                **raw_box,
            }
        )
        color = normalize_color(text_box.textColor or color)
        opacity = text_box.textOpacity
    return SceneElementModel(
        id=str(item.get("id") or new_id()),
        name=str(item.get("name", "")),
        type=shape_type,
        x=float(item.get("x", item.get("left", 150))),
        y=float(item.get("y", item.get("top", 150))),
        width=float(item.get("width", item.get("w", DEFAULT_SHAPE_SIZE))),
        height=float(item.get("height", item.get("h", DEFAULT_SHAPE_SIZE))),
        rotation=float(item.get("rotation", 0)),
        color=color,
        opacity=opacity,
        zIndex=int(item.get("zIndex", index)),
        isBackground=bool(item.get("isBackground", False)),
        textBox=text_box,
        imageAssetId=image_asset_id,
        imageTint=image_tint,
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
        container_background = find_css_value(body, "background") or find_css_value(body, "background-color")
        if container_background is not None:
            if container_background.strip().lower() in {"transparent", "none"}:
                background = TRANSPARENT_BACKGROUND
            else:
                warnings.append("Ignored the .shaper-container background color; use a canvas-filling rectangle element for backgrounds.")
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
        element_background = find_css_value(body, "background") or ""
        ring_gradient = (
            RING_GRADIENT_RE.search(element_background.lower())
            if "radial-gradient" in element_background.lower()
            else None
        )
        color = normalize_color(resolve_css_fill_color(body, DEFAULT_CANVAS_BACKGROUND))
        opacity = parse_float(find_css_value(body, "opacity"), 1.0)
        rotation = parse_rotation(find_css_value(body, "transform") or "")
        border_radius = (find_css_value(body, "border-radius") or "").strip()
        clip_path = normalize_clip_path(find_css_value(body, "clip-path"))
        declared_type = (find_css_value(body, "-miliastra-type") or "").strip().lower()
        text_content = parse_css_quoted(find_css_value(body, "-miliastra-text") or find_css_value(body, "content"))
        image_asset_id = None
        image_tint = False
        raw_image_asset = find_css_value(body, "-miliastra-image")
        if raw_image_asset is not None:
            try:
                image_asset_id = int(round(parse_px(raw_image_asset, 0)))
            except (TypeError, ValueError):
                image_asset_id = None
        if image_asset_id:
            shape_type = "image"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
            image_tint = parse_css_bool(find_css_value(body, "-miliastra-image-tint"), False)
            color = normalize_color(find_css_value(body, "background-color") or "#ffffff")
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
                    isBackground=False,
                    imageAssetId=image_asset_id,
                    imageTint=image_tint,
                )
            )
            continue
        if declared_type == "textbox" or text_content is not None:
            shape_type = "textbox"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
            text_color = normalize_color(find_css_value(body, "color") or color)
            text_opacity = parse_float(find_css_value(body, "-miliastra-text-opacity"), opacity)
            bg_color = normalize_color(resolve_css_fill_color(body, "#ffffff"))
            bg_opacity = parse_float(find_css_value(body, "-miliastra-bg-opacity"), 1.0)
            outline_color = normalize_color(find_css_value(body, "-miliastra-outline-color") or "#111111")
            outline_opacity = parse_float(find_css_value(body, "-miliastra-outline-opacity"), 1.0)
            outline_enabled = parse_css_bool(find_css_value(body, "-miliastra-outline"), True)
            auto_size = parse_css_bool(find_css_value(body, "-miliastra-auto-size"), True)
            align_h = css_text_align_h(find_css_value(body, "text-align"))
            align_v = css_text_align_v(find_css_value(body, "-miliastra-align-v"))
            text_box = TextBoxModel(
                text=text_content or "文本",
                fontSize=int(parse_px(find_css_value(body, "font-size"), 20)),
                autoSize=auto_size,
                minFontSize=int(parse_px(find_css_value(body, "-miliastra-min-font-size"), 12)),
                textColor=text_color,
                textOpacity=clamp01(text_opacity),
                bgColor=bg_color,
                bgOpacity=clamp01(bg_opacity),
                outlineEnabled=outline_enabled,
                outlineColor=outline_color,
                outlineOpacity=clamp01(outline_opacity),
                alignH=align_h,
                alignV=align_v,
                anchorType=normalize_anchor_type(find_css_value(body, "-miliastra-anchor-type")),
                visible=parse_css_bool(find_css_value(body, "-miliastra-visible"), True),
                scaleX=parse_float(find_css_value(body, "-miliastra-scale-x"), 1.0),
                scaleY=parse_float(find_css_value(body, "-miliastra-scale-y"), 1.0),
                anchorMinX=parse_float(find_css_value(body, "-miliastra-anchor-min-x"), 0.5),
                anchorMinY=parse_float(find_css_value(body, "-miliastra-anchor-min-y"), 0.5),
                anchorMaxX=parse_float(find_css_value(body, "-miliastra-anchor-max-x"), 0.5),
                anchorMaxY=parse_float(find_css_value(body, "-miliastra-anchor-max-y"), 0.5),
            )
            color = text_box.textColor
            opacity = text_box.textOpacity
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
                    isBackground=False,
                    textBox=text_box,
                )
            )
            continue
        if triangle_border is not None:
            shape_type = "triangle"
            shape_width = triangle_border["width"]
            shape_height = triangle_border["height"]
            color = normalize_color(triangle_border["color"])
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2) + shape_height / 2
        elif clip_path == TRIANGLE_CLIP_PATH or clip_path in STAR_CLIP_PATHS.values():
            shape_type = next((kind for kind, path in STAR_CLIP_PATHS.items() if path == clip_path), "triangle")
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
        elif ring_gradient is not None:
            shape_type = "ring"
            shape_width = parse_px(find_css_value(body, "width"), DEFAULT_SHAPE_SIZE)
            shape_height = parse_px(find_css_value(body, "height"), DEFAULT_SHAPE_SIZE)
            shape_x = parse_px(find_css_value(body, "left"), width / 2)
            shape_y = parse_px(find_css_value(body, "top"), height / 2)
            color = normalize_color(ring_gradient.group(1))
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
                imageAssetId=image_asset_id,
                imageTint=image_tint,
            )
        )

    if not elements:
        raise HTTPException(status_code=400, detail="No positionable elements could be parsed from the CSS")

    scene = SceneDocumentModel(
        canvas=CanvasModel(width=width, height=height, background=background),
        elements=elements,
        meta=MetaModel(sourceType="css", sourceName="", warnings=warnings),
    )

    if not canvas_match:
        scene.meta.warnings.append(".shaper-container not found; the canvas size was auto-fitted to the element bounds.")
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
            warning_message="Some elements exceeded the CSS container bounds; the canvas was auto-expanded to fit all elements.",
        )

    return normalize_scene(scene)


SVG_ROTATE_RE = re.compile(r"rotate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+))?\s*\)")


def parse_svg_rotation(value: str | None, default_x: float, default_y: float) -> tuple[float, float, float]:
    """解析 rotate(a cx cy)；场景旋转为逆时针正方向，SVG 为顺时针，故取负。"""
    match = SVG_ROTATE_RE.search(value or "")
    if not match:
        return 0.0, default_x, default_y
    angle = -parse_float(match.group(1), 0.0)
    return angle, parse_float(match.group(2), default_x), parse_float(match.group(3), default_y)


def svg_has_background_rect(root, width: float, height: float) -> bool:
    """SVG 顶层若有一张铺满画布的 rect，就认为它带了底色；否则画布视为透明。"""
    for node in root:
        if strip_ns(node.tag) != "rect":
            continue
        if parse_svg_number(node.attrib.get("x"), 0.0) != 0 or parse_svg_number(node.attrib.get("y"), 0.0) != 0:
            continue
        rect_width = parse_svg_number(node.attrib.get("width"), 0.0)
        rect_height = parse_svg_number(node.attrib.get("height"), 0.0)
        if abs(rect_width - width) < 0.5 and abs(rect_height - height) < 0.5:
            return True
    return False


def parse_svg_scene(content: str) -> SceneDocumentModel:
    warnings: list[str] = []
    try:
        root = ET.fromstring(content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail=f"SVG parse failed: {exc}") from exc

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
        elif tag == "image":
            raw_asset = (node.attrib.get("data-miliastra-image") or "").strip()
            asset_id: int | None = None
            if raw_asset.isdigit():
                asset_id = int(raw_asset)
            else:
                href = node.attrib.get("href") or node.attrib.get("{http://www.w3.org/1999/xlink}href") or ""
                match = SPRITE_URL_RE.search(href)
                if match:
                    asset_id = int(match.group(1))
            if asset_id is None:
                unsupported_tags.append("image (素材 ID 无法识别)")
                continue
            x = parse_svg_number(node.attrib.get("x"), 0.0)
            y = parse_svg_number(node.attrib.get("y"), 0.0)
            w = parse_svg_number(node.attrib.get("width"), DEFAULT_SHAPE_SIZE)
            h = parse_svg_number(node.attrib.get("height"), DEFAULT_SHAPE_SIZE)
            rotation, cx, cy = parse_svg_rotation(
                node.attrib.get("transform"), x + w / 2, y + h / 2
            )
            elements.append(
                SceneElementModel(
                    id=new_id(),
                    type="image",
                    x=cx,
                    y=cy,
                    width=w,
                    height=h,
                    rotation=rotation,
                    color="#ffffff",
                    opacity=opacity,
                    zIndex=index,
                    isBackground=False,
                    imageAssetId=asset_id,
                    imageTint=False,
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
        elif tag == "text":
            x = parse_svg_number(node.attrib.get("x"), width / 2)
            y = parse_svg_number(node.attrib.get("y"), height / 2)
            font_size = parse_svg_number(node.attrib.get("font-size"), 20)
            content = "".join(node.itertext()).strip() or "文本"
            text_color = normalize_color(fill)
            text_box = TextBoxModel(
                text=content,
                fontSize=max(1, int(font_size)),
                textColor=text_color,
                textOpacity=opacity,
            )
            elements.append(
                SceneElementModel(
                    id=new_id(),
                    name="textbox",
                    type="textbox",
                    x=x,
                    y=y,
                    width=max(font_size * max(1, len(content)) * 0.6, 40),
                    height=max(font_size * 1.4, 24),
                    rotation=0,
                    color=text_color,
                    opacity=opacity,
                    zIndex=index,
                    isBackground=False,
                    textBox=text_box,
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
        warnings.append(f"Some SVG nodes were not imported: {', '.join(sorted(set(unsupported_tags)))}")
    if not elements:
        raise HTTPException(status_code=400, detail="No importable basic shapes found in the SVG")

    scene = SceneDocumentModel(
        canvas=CanvasModel(
            width=width,
            height=height,
            background=(
                DEFAULT_CANVAS_BACKGROUND
                if svg_has_background_rect(root, width, height)
                else TRANSPARENT_BACKGROUND
            ),
        ),
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
        f"  background: {scene.canvas.background};",
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
            ]
        )
        if element.type == "image" and element.imageAssetId:
            tint_color = element.color if element.imageTint else "#ffffff"
            lines.extend(
                [
                    "  -miliastra-type: image;",
                    f"  -miliastra-image: {element.imageAssetId};",
                    f"  -miliastra-image-tint: {'true' if element.imageTint else 'false'};",
                    f"  background-color: {tint_color};",
                    f"  background-image: url({sprite_url(element.imageAssetId)});",
                    "  background-size: 100% 100%;",
                    "  background-repeat: no-repeat;",
                    "  background-position: center;",
                ]
            )
        elif element.type == "textbox":
            box = ensure_textbox(element) or default_textbox()
            lines.extend(
                [
                    "  -miliastra-type: textbox;",
                    f"  -miliastra-text: {css_quote(box.text)};",
                    f"  font-size: {box.fontSize}px;",
                    f"  color: {box.textColor};",
                    f"  background: {box.bgColor};",
                    f"  text-align: {box.alignH};",
                    f"  -miliastra-align-v: {box.alignV};",
                    f"  -miliastra-auto-size: {'true' if box.autoSize else 'false'};",
                    f"  -miliastra-min-font-size: {box.minFontSize}px;",
                    f"  -miliastra-text-opacity: {box.textOpacity:.4f};",
                    f"  -miliastra-bg-opacity: {box.bgOpacity:.4f};",
                    f"  -miliastra-outline: {'true' if box.outlineEnabled else 'false'};",
                    f"  -miliastra-outline-color: {box.outlineColor};",
                    f"  -miliastra-outline-opacity: {box.outlineOpacity:.4f};",
                    f"  -miliastra-visible: {'true' if box.visible else 'false'};",
                    f"  -miliastra-scale-x: {box.scaleX:.4f};",
                    f"  -miliastra-scale-y: {box.scaleY:.4f};",
                    f"  -miliastra-anchor-type: {box.anchorType};",
                    f"  -miliastra-anchor-min-x: {box.anchorMinX:.4f};",
                    f"  -miliastra-anchor-min-y: {box.anchorMinY:.4f};",
                    f"  -miliastra-anchor-max-x: {box.anchorMaxX:.4f};",
                    f"  -miliastra-anchor-max-y: {box.anchorMaxY:.4f};",
                ]
            )
        elif element.type == "ring":
            lines.append(
                f"  background: radial-gradient(closest-side, transparent 79.5%, {element.color} 80.5%, {element.color} 100%, transparent 100%);"
            )
        else:
            lines.append(f"  background: {element.color};")
        lines.extend(
            [
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
        if element.type in STAR_CLIP_PATHS:
            lines.append(f"  clip-path: {STAR_CLIP_PATHS[element.type]};")
        lines.append("}")
    return "\n".join(lines)


def scene_to_svg(scene: SceneDocumentModel) -> str:
    sorted_elements = sorted(scene.elements, key=lambda item: item.zIndex)
    ring_count = sum(1 for element in sorted_elements if element.type == "ring")
    tinted_count = sum(1 for element in sorted_elements if element.type == "image" and element.imageTint)
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{scene.canvas.width:.0f}" height="{scene.canvas.height:.0f}" viewBox="0 0 {scene.canvas.width:.0f} {scene.canvas.height:.0f}">',
    ]
    if scene.canvas.background != TRANSPARENT_BACKGROUND:
        parts.append(
            f'<rect x="0" y="0" width="{scene.canvas.width:.0f}" height="{scene.canvas.height:.0f}" fill="{scene.canvas.background}" />'
        )
    if ring_count:
        parts.append(
            f'<!-- Miliastra-Warning: SVG 导出已忽略 {ring_count} 个圆环图元；如需圆环，请改用 CSS 或 JSON 导出。 -->'
        )
    if tinted_count:
        parts.append(
            f'<!-- Miliastra-Warning: SVG 无法表现 {tinted_count} 个素材的染色，导出为原始贴图；染色请改用 CSS、PNG 或 Lua 导出。 -->'
        )

    for element in sorted_elements:
        if element.type == "ring":
            continue
        transform = f'rotate({-element.rotation:.2f} {element.x:.2f} {element.y:.2f})'
        opacity = f'{element.opacity:.4f}'
        if element.type == "textbox":
            box = ensure_textbox(element) or default_textbox()
            anchor = {"left": "start", "center": "middle", "right": "end"}[box.alignH]
            baseline = {"top": "hanging", "middle": "middle", "bottom": "text-after-edge"}[box.alignV]
            tspans = []
            for span in parse_rich_text(box.text or ""):
                escaped = (
                    span["text"].replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                )
                attrs = []
                if span.get("color"):
                    attrs.append(f'fill="{span["color"]}"')
                if span.get("italic"):
                    attrs.append('font-style="italic"')
                if span.get("size"):
                    attrs.append(f'font-size="{span["size"]}"')
                attr = (" " + " ".join(attrs)) if attrs else ""
                tspans.append(f"<tspan{attr}>{escaped}</tspan>")
            inner = "".join(tspans) if tspans else ""
            parts.append(
                f'<rect x="{element.x - element.width / 2:.2f}" y="{element.y - element.height / 2:.2f}" width="{element.width:.2f}" height="{element.height:.2f}" fill="{box.bgColor}" fill-opacity="{box.bgOpacity:.4f}" transform="{transform}" />'
            )
            parts.append(
                f'<text x="{element.x:.2f}" y="{element.y:.2f}" fill="{box.textColor}" fill-opacity="{box.textOpacity:.4f}" font-size="{box.fontSize}" text-anchor="{anchor}" dominant-baseline="{baseline}" transform="{transform}">{inner}</text>'
            )
            continue
        if element.type == "image" and element.imageAssetId:
            asset_id = element.imageAssetId
            parts.append(
                f'<image data-miliastra-image="{asset_id}" href="{sprite_url(asset_id)}"'
                f' x="{element.x - element.width / 2:.2f}" y="{element.y - element.height / 2:.2f}"'
                f' width="{element.width:.2f}" height="{element.height:.2f}"'
                f' preserveAspectRatio="none" opacity="{opacity}" transform="{transform}" />'
            )
            continue
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
            points = star_points(element.x, element.y, element.width, element.height, 4)
            parts.append(
                f'<polygon points="{format_points(points)}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        elif element.type == "five_point_star":
            points = star_points(element.x, element.y, element.width, element.height, 5)
            parts.append(
                f'<polygon points="{format_points(points)}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )
        else:
            parts.append(
                f'<rect x="{element.x - element.width / 2:.2f}" y="{element.y - element.height / 2:.2f}" width="{element.width:.2f}" height="{element.height:.2f}" fill="{element.color}" opacity="{opacity}" transform="{transform}" />'
            )

    parts.append("</svg>")
    return "\n".join(parts)


def load_sprite_image(asset_id: int) -> Image.Image | None:
    """下载并解码单个素材贴图；失败返回 None（由调用方计入 skipped）。"""
    try:
        return Image.open(io.BytesIO(fetch_sprite_bytes(asset_id))).convert("RGBA")
    except (
        image_library.LibraryUpstreamError,
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
    ):
        return None


def load_sprite_images(elements: list[SceneElementModel]) -> dict[int, Image.Image]:
    """并发预取场景里用到的素材贴图；同一素材只下载一次，失败的 id 不进结果。"""
    asset_ids = sorted(
        {
            element.imageAssetId
            for element in elements
            if element.type == "image" and element.imageAssetId
        }
    )
    sprites: dict[int, Image.Image] = {}
    if not asset_ids:
        return sprites
    with ThreadPoolExecutor(max_workers=SPRITE_PREFETCH_WORKERS) as pool:
        for asset_id, sprite in zip(asset_ids, pool.map(load_sprite_image, asset_ids)):
            if sprite is not None:
                sprites[asset_id] = sprite
    return sprites


def paste_sprite(image: Image.Image, element: SceneElementModel, sprite: Image.Image) -> None:
    """把素材贴图按图元宽高直接拉伸，再应用旋转。

    sprite 是本请求内共享的解码缓存，先拷贝再改，避免染色/透明度污染原贴图。
    """
    sprite = sprite.copy()
    opacity = clamp01(element.opacity)
    if element.imageTint:
        rgba = color_with_alpha(element.color, 1.0)
        layer = ImageChops.multiply(sprite.convert("RGB"), Image.new("RGB", sprite.size, rgba[:3])).convert("RGBA")
        alpha = sprite.getchannel("A")
        if opacity < 1:
            alpha = alpha.point(lambda value: int(value * opacity))
        layer.putalpha(alpha)
        sprite = layer
    elif opacity < 1:
        sprite.putalpha(sprite.getchannel("A").point(lambda value: int(value * opacity)))

    box_width = max(1, int(round(element.width)))
    box_height = max(1, int(round(element.height)))
    target = (box_width, box_height)
    if target != sprite.size:
        sprite = sprite.resize(target, Image.LANCZOS)
    if abs(element.rotation) > 0.001:
        # 场景旋转为逆时针正方向，与 Pillow rotate() 的方向一致
        sprite = sprite.rotate(element.rotation, expand=True, resample=Image.BICUBIC)

    left = int(round(element.x - sprite.width / 2))
    top = int(round(element.y - sprite.height / 2))
    image.alpha_composite(sprite, (left, top))


def scene_to_png_bytes(scene: SceneDocumentModel) -> bytes:
    canvas_fill = (
        (0, 0, 0, 0)
        if scene.canvas.background == TRANSPARENT_BACKGROUND
        else ImageColor.getrgb(scene.canvas.background) + (255,)
    )
    image = Image.new("RGBA", (int(scene.canvas.width), int(scene.canvas.height)), canvas_fill)
    skipped_assets: list[int] = []

    ordered_elements = sorted(scene.elements, key=lambda item: item.zIndex)
    sprites = load_sprite_images(ordered_elements)

    for element in ordered_elements:
        rgba = color_with_alpha(element.color, element.opacity)
        if element.type == "image" and element.imageAssetId:
            sprite = sprites.get(element.imageAssetId)
            if sprite is None:
                skipped_assets.append(element.imageAssetId)
            else:
                paste_sprite(image, element, sprite)
            continue
        if element.type == "textbox":
            layer = Image.new("RGBA", image.size)
            draw_textbox(layer, ImageDraw.Draw(layer, "RGBA"), element)
            image.alpha_composite(layer)
            continue

        # ImageDraw 在 RGBA 画布上直接写入 alpha，不会执行 source-over。
        # 仅为当前图元的可见外接框分配透明层，再正确叠加到已有内容上。
        left, top, right, bottom = get_element_bounds(element)
        x0, y0 = max(0, math.floor(left)), max(0, math.floor(top))
        x1, y1 = min(image.width, math.ceil(right) + 1), min(image.height, math.ceil(bottom) + 1)
        if x1 <= x0 or y1 <= y0:
            continue
        layer = Image.new("RGBA", (x1 - x0, y1 - y0))
        draw = ImageDraw.Draw(layer, "RGBA")
        local = element.model_copy(update={"x": element.x - x0, "y": element.y - y0})
        if local.type == "ellipse":
            draw_ellipse(draw, local, rgba)
        elif local.type == "triangle":
            draw_polygon(draw, triangle_points(local.x, local.y, local.width, local.height), rgba, local)
        elif local.type in {"four_point_star", "five_point_star"}:
            points = 4 if local.type == "four_point_star" else 5
            draw_polygon(draw, star_points(local.x, local.y, local.width, local.height, points), rgba, local)
        elif local.type == "ring":
            draw_ring(layer, local, rgba)
        else:
            draw_rect(draw, local, rgba)
        image.alpha_composite(layer, (x0, y0))

    buffer = io.BytesIO()
    info = PngImagePlugin.PngInfo()
    if skipped_assets:
        unique = "、".join(str(asset) for asset in sorted(set(skipped_assets)))
        info.add_text("Warning", f"以下素材贴图下载失败，未绘制：{unique}")
    image.save(buffer, format="PNG", pnginfo=info)
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

        payload: dict = {
            "type": element.type,
            "relative": {
                "x": round(element.x - canvas_center_x, 4),
                "y": round(canvas_center_y - element.y, 4),
            },
            "size": size,
            "rotation": {"x": 0, "y": 0, "z": round(element.rotation, 4)},
            "name": (element.name if element.type == "textbox" else str(element.zIndex + 1)),
            "is_background": element.isBackground,
        }
        if element.type == "textbox":
            box = ensure_textbox(element) or default_textbox()
            payload["scale"] = {"x": round(box.scaleX, 4), "y": round(box.scaleY, 4)}
            payload["anchor_min"] = {"x": round(box.anchorMinX, 4), "y": round(box.anchorMinY, 4)}
            payload["anchor_max"] = {"x": round(box.anchorMaxX, 4), "y": round(box.anchorMaxY, 4)}
            payload["pivot"] = {"x": round(box.pivotX, 4), "y": round(box.pivotY, 4)}
            payload["textbox"] = {
                "text": box.text,
                "font_size": box.fontSize,
                "auto_size": box.autoSize,
                "min_font_size": box.minFontSize,
                "outline_enabled": box.outlineEnabled,
                "visible": box.visible,
                "packed_color": to_packed_argb(box.textColor, box.textOpacity, truncate=True),
                "packed_bg_color": to_packed_argb(box.bgColor, box.bgOpacity, truncate=True),
                "packed_outline_color": to_packed_argb(box.outlineColor, box.outlineOpacity, truncate=True),
                "align_h": textbox_align_h_code(box.alignH),
                "align_v": textbox_align_v_code(box.alignV),
                "style_id": TEXTBOX_STYLE_ID,
            }
            payload["packed_color"] = to_packed_argb(box.textColor, box.textOpacity, truncate=True)
        else:
            asset_id = element_asset_id(element)
            if asset_id is None:
                continue
            payload["image_asset_ref"] = asset_id
            # 彩色素材不能被染色，用白色作为中性色；单色素材才使用图元颜色
            tint = element.color if (element.type != "image" or element.imageTint) else "#ffffff"
            payload["packed_color"] = to_packed_argb(tint, element.opacity)
        elements.append(payload)

    if not elements:
        raise HTTPException(status_code=400, detail="The current scene has no GIA-exportable basic elements")

    return {
        "group_name": normalize_gia_group_name(group_name),
        "canvas": {"width": scene.canvas.width, "height": scene.canvas.height},
        "elements": elements,
    }


def convert_scene_to_gia_bytes(gia_json: dict) -> bytes:
    if not GIA_PY_PATH.exists() or not GIA_TEMPLATE_PATH.exists():
        raise HTTPException(status_code=500, detail="External GIA export script or template file not found")

    spec = importlib.util.spec_from_file_location("miliastra_gia_json_to_gia", GIA_PY_PATH)
    if spec is None or spec.loader is None:
        raise HTTPException(status_code=500, detail="Failed to load the GIA export module")
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


def css_quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def parse_css_quoted(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text or text.lower() in {"none", "normal"}:
        return None
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {'"', "'"}:
        return text[1:-1]
    return text


def parse_css_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return default


def css_text_align_h(value: str | None) -> AlignH:
    lowered = (value or "").strip().lower()
    if lowered in {"left", "start"}:
        return "left"
    if lowered in {"right", "end"}:
        return "right"
    if lowered in {"center", "middle"}:
        return "center"
    return "left"


def css_text_align_v(value: str | None) -> AlignV:
    lowered = (value or "").strip().lower()
    if lowered in {"top", "start", "flex-start"}:
        return "top"
    if lowered in {"bottom", "end", "flex-end"}:
        return "bottom"
    if lowered in {"middle", "center"}:
        return "middle"
    return "top"


def textbox_align_h_code(align_h: AlignH) -> int:
    # 7.0.51: omit/0 = left, 1 = center, 2 = right
    return {"left": 0, "center": 1, "right": 2}[align_h]


def textbox_align_v_code(align_v: AlignV) -> int:
    # omit/0 = top, 1 = middle, 2 = bottom (same pattern as horizontal 508)
    return {"top": 0, "middle": 1, "bottom": 2}[align_v]


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


def star_points(cx: float, cy: float, width: float, height: float, points: int) -> list[tuple[float, float]]:
    return [(cx - width / 2 + x * width / 100, cy - height / 2 + y * height / 100) for x, y in STAR_VERTICES[points]]


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


def draw_polygon(draw: ImageDraw.ImageDraw, points: list[tuple[float, float]], fill: tuple[int, int, int, int], element: SceneElementModel) -> None:
    # 使用尺寸盒中心；顶点均值是三角形的重心，旋转 180° 会错位 height/3。
    # PIL drawing happens in screen coordinates, so invert CCW-positive scene rotation.
    draw.polygon(rotate_points(points, element.x, element.y, -element.rotation), fill=fill)


def draw_rect(draw: ImageDraw.ImageDraw, element: SceneElementModel, fill: tuple[int, int, int, int]) -> None:
    points = [
        (element.x - element.width / 2, element.y - element.height / 2),
        (element.x + element.width / 2, element.y - element.height / 2),
        (element.x + element.width / 2, element.y + element.height / 2),
        (element.x - element.width / 2, element.y + element.height / 2),
    ]
    draw_polygon(draw, points, fill, element)


def draw_ellipse(draw: ImageDraw.ImageDraw, element: SceneElementModel, fill: tuple[int, int, int, int]) -> None:
    left = element.x - element.width / 2
    top = element.y - element.height / 2
    right = element.x + element.width / 2
    bottom = element.y + element.height / 2
    if abs(element.rotation) < 0.001:
        draw.ellipse([left, top, right, bottom], fill=fill)
        return
    draw_polygon(draw, ellipse_points(element.x, element.y, element.width, element.height), fill, element)


def ellipse_points(
    cx: float,
    cy: float,
    width: float,
    height: float,
    ratio: float = 1.0,
    segments: int = 36,
) -> list[tuple[float, float]]:
    return [
        (
            cx + math.cos(math.tau * index / segments) * width / 2 * ratio,
            cy + math.sin(math.tau * index / segments) * height / 2 * ratio,
        )
        for index in range(segments)
    ]


RICH_COLOR_NAMES = {
    "red": "#ff0000",
    "green": "#00ff00",
    "blue": "#0000ff",
    "black": "#000000",
    "white": "#ffffff",
    "yellow": "#ffff00",
    "cyan": "#00ffff",
    "magenta": "#ff00ff",
    "orange": "#ffa500",
    "gray": "#808080",
    "grey": "#808080",
}
RICH_TOKEN_RE = re.compile(r"</?(?:color|i|size)(?:\s*=\s*[^>]*)?>", re.I)


def parse_rich_color_name(value: str) -> str | None:
    raw = value.strip().lower()
    if not raw:
        return None
    named = RICH_COLOR_NAMES.get(raw)
    if named:
        return named
    if re.fullmatch(r"#?[0-9a-f]{6}", raw):
        return raw if raw.startswith("#") else f"#{raw}"
    if re.fullmatch(r"#?[0-9a-f]{3}", raw):
        hex_value = raw.lstrip("#")
        return f"#{hex_value[0] * 2}{hex_value[1] * 2}{hex_value[2] * 2}"
    return None


def parse_rich_text(source: str) -> list[dict]:
    spans: list[dict] = []
    color_stack: list[str] = []
    size_stack: list[float] = []
    italic = 0
    last = 0

    def push_text(text: str) -> None:
        if not text:
            return
        spans.append(
            {
                "text": text,
                "color": color_stack[-1] if color_stack else None,
                "italic": italic > 0,
                "size": size_stack[-1] if size_stack else None,
            }
        )

    for match in RICH_TOKEN_RE.finditer(source or ""):
        push_text(source[last:match.start()])
        token = match.group(0)
        closing = token.startswith("</")
        inner = token[2:-1] if closing else token[1:-1]
        name, _, raw_value = inner.partition("=")
        name = name.strip().lower()
        value = raw_value.strip()
        if name == "color":
            if closing:
                if color_stack:
                    color_stack.pop()
            else:
                color = parse_rich_color_name(value)
                if color:
                    color_stack.append(color)
        elif name == "i":
            italic = max(0, italic - 1) if closing else italic + 1
        elif name == "size":
            if closing:
                if size_stack:
                    size_stack.pop()
            else:
                try:
                    size = float(value)
                except ValueError:
                    size = 0
                if size > 0:
                    size_stack.append(size)
        last = match.end()
    push_text((source or "")[last:])
    return spans or [{"text": source or "", "color": None, "italic": False, "size": None}]


def load_textbox_font(size: int):
    candidates = [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\msyh.ttf"),
        Path(r"C:\Windows\Fonts\simhei.ttf"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc"),
        Path("/System/Library/Fonts/PingFang.ttc"),
    ]
    for path in candidates:
        if path.exists():
            try:
                return ImageFont.truetype(str(path), size)
            except OSError:
                continue
    return ImageFont.load_default()


def draw_textbox(_image: Image.Image, draw: ImageDraw.ImageDraw, element: SceneElementModel) -> None:
    box = ensure_textbox(element) or default_textbox()
    if not box.visible:
        return
    bg = color_with_alpha(box.bgColor, box.bgOpacity)
    draw_rect(draw, element, bg)
    spans = parse_rich_text(box.text or "")
    left = element.x - element.width / 2
    top = element.y - element.height / 2
    pieces: list[tuple[str, object, tuple[int, int, int, int], int]] = []
    total_w = 0.0
    max_h = 0.0
    for span in spans:
        size = max(1, int(span["size"] or box.fontSize))
        font = load_textbox_font(size)
        text = span["text"]
        bbox = draw.textbbox((0, 0), text, font=font)
        total_w += bbox[2] - bbox[0]
        max_h = max(max_h, bbox[3] - bbox[1])
        fill = color_with_alpha(span["color"] or box.textColor, box.textOpacity)
        pieces.append((text, font, fill, 1 if box.outlineEnabled else 0))
    if box.alignH == "left":
        tx = left
    elif box.alignH == "right":
        tx = left + element.width - total_w
    else:
        tx = element.x - total_w / 2
    if box.alignV == "top":
        ty = top
    elif box.alignV == "bottom":
        ty = top + element.height - max_h
    else:
        ty = element.y - max_h / 2
    stroke_fill = color_with_alpha(box.outlineColor, box.outlineOpacity)
    cursor = tx
    for text, font, fill, stroke_width in pieces:
        draw.text(
            (cursor, ty),
            text,
            font=font,
            fill=fill,
            stroke_width=stroke_width,
            stroke_fill=stroke_fill if stroke_width else None,
        )
        bbox = draw.textbbox((0, 0), text, font=font)
        cursor += bbox[2] - bbox[0]


def draw_ring(image: Image.Image, element: SceneElementModel, fill: tuple[int, int, int, int]) -> None:
    layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    layer_draw = ImageDraw.Draw(layer, "RGBA")
    draw_polygon(layer_draw, ellipse_points(element.x, element.y, element.width, element.height), fill, element)
    draw_polygon(
        layer_draw,
        ellipse_points(element.x, element.y, element.width, element.height, RING_INNER_RATIO),
        (0, 0, 0, 0),
        element,
    )
    image.alpha_composite(layer)


def color_with_alpha(color: str, opacity: float) -> tuple[int, int, int, int]:
    r, g, b = ImageColor.getrgb(normalize_color(color))
    return r, g, b, max(0, min(255, round(opacity * 255)))


def to_packed_argb(color: str, opacity: float, *, truncate: bool = False) -> int:
    r, g, b = ImageColor.getrgb(normalize_color(color))
    raw = opacity * 255
    alpha = int(raw) if truncate else round(raw)
    alpha = max(0, min(255, alpha))
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
