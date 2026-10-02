"""图片素材库（Public/CustomUIImage）的 OSS 读取代理。

为什么需要这层代理：`oss.070077.xyz` 不返回 Access-Control-Allow-Origin，
浏览器能显示 <img>，但 fetch() 取 data.json 会被 CORS 拦掉。因此索引与元数据
统一走后端；图片本体在前端直连 OSS，只有 PNG 导出合成与单色染色代理会在
服务端取贴图字节（`fetch_sprite_bytes`，同样不落盘不缓存）。

设计约束：**后端无状态、不落盘、不缓存**。复用全部交给浏览器：
- 响应带 OSS 的 ETag 与 `Cache-Control: max-age=43200`（与 OSS 自身一致）
- 浏览器回访时带 If-None-Match，本层把请求「转译」成对各上游文件的条件请求，
  上游全部 304 就直接回 304，一个字节的正文都不会传输
- 前端另有 localStorage 副本，用于首屏瞬时渲染

索引的 ETag 采用 `"m2.<data>.<zh>.<en>.<desc>.<uses>"` 结构，把五份上游 ETag 编码进去，
这样下次请求不必先回源就能知道该拿哪几个 ETag 去校验。
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import math
import os
import re
import threading
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

DEFAULT_OSS_BASE = "https://oss.070077.xyz/images"
# 与 OSS 自身的 cache-control: max-age=43200 对齐
DEFAULT_BROWSER_MAX_AGE = 12 * 60 * 60
DEFAULT_TIMEOUT_SECONDS = 15.0

CATALOG_PATH = "data.json"
CATEGORY_NAME_PATHS: tuple[tuple[str, str], ...] = (
    ("zh-CN", "i18n/zh-cn.json"),
    ("en-US", "i18n/en-us.json"),
)
ANNOTATION_PATHS = (("descriptions", "desc.json"), ("useTaxonomy", "category.json"))
LOGGER = logging.getLogger(__name__)

IMAGE_ID_RE = re.compile(r"^\d{6}$")
UNSAFE_ETAG_CHARS_RE = re.compile(r"[^0-9A-Za-z_-]")
PACK_DOWNLOAD_WORKERS = 6
MAX_SPRITE_BYTES = 16 * 1024 * 1024
MAX_PACK_BYTES = 256 * 1024 * 1024
MAX_SPRITE_PIXELS = 16 * 1024 * 1024
CONTACT_SHEET_MAX_ASSETS = 48
CONTACT_SHEET_COLUMNS = 8
CONTACT_SHEET_CELL_WIDTH = 160
CONTACT_SHEET_CELL_HEIGHT = 184
CONTACT_SHEET_PREVIEW_SIZE = 136


class LibraryUpstreamError(RuntimeError):
    """上游 OSS 不可用。"""


class LibraryNotFoundError(RuntimeError):
    """上游不存在该资源（例如无图条目没有 border 文件）。"""


class LibraryIdError(ValueError):
    """图片 ID 格式非法。"""


class LibrarySelectionError(ValueError):
    """批量素材选择为空、非法或包含无图 ID。"""


class LibrarySizeError(ValueError):
    """素材下载、解码或打包超出请求资源上限。"""


@dataclass(frozen=True)
class UpstreamDocument:
    body: bytes | None
    etag: str | None
    not_modified: bool = False
    missing: bool = False


@dataclass(frozen=True)
class BundleResult:
    payload: bytes | None
    etag: str
    not_modified: bool


def oss_base() -> str:
    return os.environ.get("MILIASTRA_LIBRARY_OSS_BASE", DEFAULT_OSS_BASE).rstrip("/")


def sprite_url(asset_id: int) -> str:
    """素材贴图的 OSS 地址（前端 <img> 直连、SVG/CSS 导出引用都用它）。"""
    return f"{oss_base()}/sprite/{asset_id}.png"


def fetch_sprite_bytes(asset_id: int) -> bytes:
    """素材贴图的原始字节，供服务端 PNG 合成使用（后端不缓存，每次直取上游）。"""
    document = fetch_document(f"sprite/{int(asset_id)}.png", accept="image/png, image/*, */*")
    if document.missing:
        raise LibraryUpstreamError(f"素材不存在：sprite/{asset_id}.png")
    return document.body or b""


def browser_max_age() -> int:
    raw = os.environ.get("MILIASTRA_LIBRARY_BROWSER_MAX_AGE")
    if not raw:
        return DEFAULT_BROWSER_MAX_AGE
    try:
        return max(0, int(raw))
    except ValueError:
        return DEFAULT_BROWSER_MAX_AGE


def user_agent() -> str:
    return os.environ.get(
        "MILIASTRA_LIBRARY_USER_AGENT",
        "MiliastraImageEditor/0.1 (+https://github.com/miliastra-image-editor)",
    )


def normalize_image_id(value: str | int) -> str:
    """接受 `106001` 或 `106001.png` 两种写法（贴图端点常用带扩展名的形式）。"""
    candidate = str(value).strip()
    if candidate.lower().endswith(".png"):
        candidate = candidate[:-4]
    if not IMAGE_ID_RE.match(candidate):
        raise LibraryIdError(f"非法的图片 ID：{value!r}")
    return candidate


def fetch_document(
    path: str,
    *,
    if_none_match: str | None = None,
    accept: str = "application/json, */*",
    max_bytes: int | None = None,
) -> UpstreamDocument:
    """取一份上游资源（索引 JSON 或素材贴图），可选带上条件请求头。"""
    headers = {
        # 上游会拒绝默认的 Python-urllib UA，必须显式声明
        "User-Agent": user_agent(),
        "Accept": accept,
    }
    if if_none_match:
        headers["If-None-Match"] = if_none_match
    request = urllib.request.Request(f"{oss_base()}/{path.lstrip('/')}", headers=headers)
    timeout = DEFAULT_TIMEOUT_SECONDS
    configured_timeout = os.environ.get("MILIASTRA_LIBRARY_TIMEOUT")
    if configured_timeout:
        try:
            timeout = float(configured_timeout)
        except ValueError:
            pass
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if max_bytes is not None:
                declared_size = response.headers.get("Content-Length", "")
                if declared_size.isdigit() and int(declared_size) > max_bytes:
                    raise LibrarySizeError(f"素材文件超过 {max_bytes} 字节：{path}")
            body = response.read() if max_bytes is None else response.read(max_bytes + 1)
            if max_bytes is not None and len(body) > max_bytes:
                raise LibrarySizeError(f"素材文件超过 {max_bytes} 字节：{path}")
            return UpstreamDocument(body=body, etag=response.headers.get("ETag"))
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return UpstreamDocument(body=None, etag=error.headers.get("ETag") or if_none_match, not_modified=True)
        if error.code == 404:
            return UpstreamDocument(body=None, etag=None, missing=True)
        raise LibraryUpstreamError(f"上游返回 {error.code}：{path}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise LibraryUpstreamError(f"上游请求失败：{path}（{error}）") from error


def _etag_token(etag: str | None) -> str:
    """把上游 ETag 压成可安全放进响应头的 token。"""
    if not etag:
        return "0"
    stripped = etag.strip()
    if stripped.startswith("W/"):
        stripped = stripped[2:]
    stripped = stripped.strip('"')
    safe = UNSAFE_ETAG_CHARS_RE.sub("", stripped)
    if not safe:
        return hashlib.md5(stripped.encode("utf-8")).hexdigest()
    return safe[:48]


def build_bundle_etag(tokens: tuple[str, ...]) -> str:
    return '"m2.' + ".".join(tokens) + '"'


def parse_bundle_etag(value: str | None) -> tuple[str, ...] | None:
    """从 If-None-Match 中还原五份上游 ETag token；旧版本重新取全量。"""
    if not value:
        return None
    for candidate in value.split(","):
        normalized = candidate.strip()
        if normalized.startswith("W/"):
            normalized = normalized[2:]
        normalized = normalized.strip('"')
        parts = normalized.split(".")
        if len(parts) == 6 and parts[0] == "m2" and all(parts[1:]):
            return tuple(parts[1:])
    return None


def _conditional_header(token: str) -> str | None:
    return None if token == "0" else f'"{token}"'


def _decode_json(document: UpstreamDocument) -> dict:
    if document.body is None:
        return {}
    try:
        parsed = json.loads(document.body.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as error:
        raise LibraryUpstreamError(f"上游返回的不是合法 JSON：{error}") from error
    return parsed if isinstance(parsed, dict) else {}


def _fetch_catalog_document(path: str, conditional: str | None = None) -> UpstreamDocument:
    try:
        return fetch_document(path, if_none_match=conditional)
    except LibraryUpstreamError:
        if path not in {item[1] for item in ANNOTATION_PATHS}:
            raise
        LOGGER.warning("素材用途文件暂不可用：%s", path)
        return UpstreamDocument(body=None, etag=None, missing=True)


def _annotations(bodies: dict[str, bytes], images: dict) -> tuple[dict, dict]:
    """独立用途补充数据；无图、未知 ID 或不完整标签不会进入检索。"""
    decoded = {}
    for key, path in ANNOTATION_PATHS:
        try:
            decoded[key] = json.loads(bodies[key])
        except (UnicodeDecodeError, ValueError):
            LOGGER.warning("素材用途文件不是合法 JSON：%s", path)
            decoded[key] = None
    raw = decoded.get("useTaxonomy")
    raw = raw if isinstance(raw, dict) and raw.get("schemaVersion") == 1 else {}
    groups = [g for g in raw.get("groups", []) if isinstance(g, dict)
              and isinstance(g.get("id"), str) and isinstance(g.get("label"), str)] if isinstance(raw.get("groups"), list) else []
    group_ids = {g["id"] for g in groups}
    definitions = raw.get("uses") if isinstance(raw.get("uses"), dict) else {}
    uses = {}
    for code, definition in definitions.items():
        if not isinstance(definition, dict) or not isinstance(definition.get("group"), str) or definition["group"] not in group_ids or not isinstance(definition.get("label"), str):
            continue
        keywords = definition.get("keywords")
        uses[code] = {"group": definition["group"], "label": definition["label"],
                      "keywords": [k for k in keywords if isinstance(k, str)] if isinstance(keywords, list) else []}
    taxonomy = {"schemaVersion": 1, "groups": groups, "uses": uses}
    if isinstance(raw.get("filters"), dict):
        filters = {}
        for code, definition in raw["filters"].items():
            if not isinstance(definition, dict) or not isinstance(definition.get("group"), str) or definition["group"] not in group_ids or not isinstance(definition.get("label"), str):
                continue
            source_codes = definition.get("uses")
            source_codes = list(dict.fromkeys(u for u in source_codes if isinstance(u, str) and u in uses)) if isinstance(source_codes, list) else []
            if not source_codes:
                continue
            keywords = definition.get("keywords")
            filters[code] = {"group": definition["group"], "label": definition["label"],
                             "keywords": [k for k in keywords if isinstance(k, str)] if isinstance(keywords, list) else [],
                             "uses": source_codes}
        taxonomy["filters"] = filters
    descriptions = {}
    rows = decoded.get("descriptions")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict) or not isinstance(row.get("description"), str):
            continue
        asset_id = str(row.get("assetID", ""))
        image = images.get(asset_id)
        if not IMAGE_ID_RE.fullmatch(asset_id) or not isinstance(image, dict) or not image.get("img"):
            continue
        codes = row.get("uses")
        descriptions[asset_id] = {"description": row["description"],
                                  "uses": list(dict.fromkeys(u for u in codes if isinstance(u, str) and u in uses)) if isinstance(codes, list) else []}
    return descriptions, taxonomy


def get_catalog_bundle(if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    """合并索引、分类名与可选用途文件；描述未发布时仍可浏览图片。"""
    specs: tuple[tuple[str, str], ...] = (("catalog", CATALOG_PATH), *CATEGORY_NAME_PATHS, *ANNOTATION_PATHS)
    expected = None if force else parse_bundle_etag(if_none_match)

    documents: dict[str, UpstreamDocument] = {}
    for index, (key, path) in enumerate(specs):
        conditional = _conditional_header(expected[index]) if expected else None
        document = _fetch_catalog_document(path, conditional)
        if document.missing and path == CATALOG_PATH:
            raise LibraryUpstreamError(f"上游缺少索引文件：{path}")
        documents[key] = document

    if expected and all(document.not_modified or (document.missing and expected[index] == "0")
                        for index, document in enumerate(documents.values())):
        return BundleResult(payload=None, etag=build_bundle_etag(expected), not_modified=True)

    tokens: list[str] = []
    bodies: dict[str, bytes] = {}
    for key, path in specs:
        document = documents[key]
        if document.not_modified or document.missing:
            # 上游说没变、但同批里有别的文件变了，需要无条件重取一次才能组装新响应
            document = UpstreamDocument(body=None, etag=None) if document.missing else _fetch_catalog_document(path)
        bodies[key] = document.body or b"{}"
        tokens.append(_etag_token(document.etag))

    catalog = _decode_json(UpstreamDocument(body=bodies["catalog"], etag=None))
    names: dict[str, dict] = {}
    for key, _path in CATEGORY_NAME_PATHS:
        names[key] = _decode_json(UpstreamDocument(body=bodies[key], etag=None))

    images = catalog.get("imageData") or {}
    descriptions, taxonomy = _annotations(bodies, images)
    bundle = {
        "images": images,
        "categories": catalog.get("category") or {},
        "names": names,
        "descriptions": descriptions,
        "useTaxonomy": taxonomy,
    }
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return BundleResult(payload=payload, etag=build_bundle_etag(tuple(tokens)), not_modified=False)


def get_image_meta(image_id: str | int, if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    """按需读取单个素材的 Unity Sprite 元数据（尺寸 / 九宫格）。"""
    normalized = normalize_image_id(image_id)
    document = fetch_document(
        f"border/{normalized}.json",
        if_none_match=None if force else if_none_match,
    )
    if document.missing:
        raise LibraryNotFoundError(f"border/{normalized}.json")
    if document.not_modified:
        return BundleResult(payload=None, etag=document.etag or (if_none_match or ""), not_modified=True)

    meta = normalize_sprite_meta(normalized, _decode_json(document))
    payload = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return BundleResult(payload=payload, etag=document.etag or "", not_modified=False)


def get_sprite(image_id: str | int, if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    """贴图本体代理。

    单色素材要靠 CSS mask 染色，而 CSS 遮罩要求资源 CORS-same-origin，
    跨域遮罩会让元素**整块消失**（实测：跨域 mask 的元素像素全透明）。
    因此前端只在需要染色时改走本代理，彩色素材仍然直连 OSS。
    """
    normalized = normalize_image_id(image_id)
    document = fetch_document(
        f"sprite/{normalized}.png",
        if_none_match=None if force else if_none_match,
        accept="image/png, image/*, */*",
    )
    if document.missing:
        raise LibraryNotFoundError(f"sprite/{normalized}.png")
    if document.not_modified:
        return BundleResult(payload=None, etag=document.etag or (if_none_match or ""), not_modified=True)
    return BundleResult(payload=document.body or b"", etag=document.etag or "", not_modified=False)


def select_asset_ids(
    catalog: dict,
    ids: list[int] | None = None,
    all_assets: bool = False,
    max_ids: int | None = None,
) -> list[int]:
    """以有图索引校验选择；候选顺序保留，全量按 ID 排序。"""
    if not isinstance(all_assets, bool) or (ids is not None and all_assets):
        raise LibrarySelectionError("ids 与 all=true 不能同时提供")
    if ids is None and not all_assets:
        raise LibrarySelectionError("请提供非空 ids，或指定 all=true")
    images = catalog.get("images")
    if not isinstance(images, dict):
        raise LibraryUpstreamError("素材索引缺少 images 字典")
    available = {
        int(key) for key, image in images.items()
        if isinstance(key, str) and IMAGE_ID_RE.fullmatch(key)
        and isinstance(image, dict) and isinstance(image.get("img"), str) and image["img"]
    }
    if all_assets:
        selected = sorted(available)
    else:
        if not isinstance(ids, list) or not ids:
            raise LibrarySelectionError("ids 必须是非空的素材 ID 数组")
        selected = []
        seen = set()
        for asset_id in ids:
            if type(asset_id) is not int or not IMAGE_ID_RE.fullmatch(str(asset_id)):
                raise LibrarySelectionError(f"素材 ID 必须是六位整数：{asset_id!r}")
            if asset_id not in available:
                raise LibrarySelectionError(f"该素材不存在或没有图片：{asset_id}")
            if asset_id not in seen:
                selected.append(asset_id)
                seen.add(asset_id)
    if not selected:
        raise LibrarySelectionError("素材索引没有可用图片")
    if max_ids is not None and len(selected) > max_ids:
        raise LibrarySelectionError(f"单张拼接预览最多支持 {max_ids} 张素材")
    return selected


def _pack_catalog() -> dict:
    result = get_catalog_bundle()
    try:
        catalog = json.loads(result.payload or b"{}")
    except (ValueError, UnicodeDecodeError) as error:
        raise LibraryUpstreamError("素材索引不是合法 JSON") from error
    if not isinstance(catalog, dict):
        raise LibraryUpstreamError("素材索引不是 JSON 对象")
    return catalog


def _fetch_pack_sprite(asset_id: int) -> bytes:
    document = fetch_document(f"sprite/{asset_id}.png", accept="image/png, image/*, */*", max_bytes=MAX_SPRITE_BYTES)
    if document.missing:
        raise LibraryNotFoundError(f"素材不存在：sprite/{asset_id}.png")
    return document.body or b""


class _PackBudget:
    def __init__(self):
        self.total = 0
        self.lock = threading.Lock()

    def consume(self, amount: int) -> None:
        with self.lock:
            self.total += amount
            if self.total > MAX_PACK_BYTES:
                raise LibrarySizeError(f"素材下载总量超过 {MAX_PACK_BYTES} 字节")


def _download_pack_sprite(asset_id: int, budget: _PackBudget) -> tuple[bytes | None, str | None]:
    for attempt in range(2):
        try:
            body = _fetch_pack_sprite(asset_id)
            if len(body) > MAX_SPRITE_BYTES:
                raise LibrarySizeError(f"素材文件过大：{asset_id}")
            budget.consume(len(body))
            return body, None
        except LibrarySizeError:
            raise
        except (LibraryNotFoundError, ValueError) as error:
            return None, str(error)[:240] or type(error).__name__
        except (LibraryUpstreamError, urllib.error.URLError, TimeoutError, OSError) as error:
            if attempt == 1:
                return None, str(error)[:240] or type(error).__name__
    raise AssertionError("素材下载重试未返回结果")


def _sheet_canvas(count: int) -> Image.Image:
    columns = min(CONTACT_SHEET_COLUMNS, count)
    rows = math.ceil(count / columns)
    sheet = Image.new("RGB", (columns * CONTACT_SHEET_CELL_WIDTH, rows * CONTACT_SHEET_CELL_HEIGHT), "#f3f4f6")
    draw = ImageDraw.Draw(sheet)
    for index in range(count):
        left = (index % columns) * CONTACT_SHEET_CELL_WIDTH + 12
        top = (index // columns) * CONTACT_SHEET_CELL_HEIGHT + 10
        for y in range(0, CONTACT_SHEET_PREVIEW_SIZE, 8):
            for x in range(0, CONTACT_SHEET_PREVIEW_SIZE, 8):
                shade = 210 if (x // 8 + y // 8) % 2 else 245
                edge = CONTACT_SHEET_PREVIEW_SIZE - 1
                draw.rectangle((left + x, top + y, left + min(x + 7, edge), top + min(y + 7, edge)), fill=(shade,) * 3)
    return sheet


def _sheet_asset(sheet: Image.Image, index: int, asset_id: int, body: bytes | None, error: str | None) -> tuple[int | None, int | None, str | None]:
    """逐张解码，缩略后立即关闭原图；预览保留透明及宽高比。"""
    columns = sheet.width // CONTACT_SHEET_CELL_WIDTH
    left = (index % columns) * CONTACT_SHEET_CELL_WIDTH + 12
    top = (index // columns) * CONTACT_SHEET_CELL_HEIGHT + 10
    width = height = None
    if body is not None:
        try:
            with Image.open(io.BytesIO(body)) as source:
                if source.format != "PNG":
                    raise ValueError("贴图不是 PNG 文件")
                width, height = source.size
                if width * height > MAX_SPRITE_PIXELS:
                    raise LibrarySizeError(f"素材解码像素过大：{asset_id} ({width}x{height})")
                source.load()
                scale = min(CONTACT_SHEET_PREVIEW_SIZE / width, CONTACT_SHEET_PREVIEW_SIZE / height)
                target = (max(1, round(width * scale)), max(1, round(height * scale)))
                with source.convert("RGBA") as rgba:
                    with rgba.resize(target, Image.Resampling.LANCZOS) as thumbnail:
                        sheet.paste(thumbnail, (left + (CONTACT_SHEET_PREVIEW_SIZE - target[0]) // 2,
                                               top + (CONTACT_SHEET_PREVIEW_SIZE - target[1]) // 2), thumbnail)
        except LibrarySizeError:
            raise
        except Image.DecompressionBombError as invalid:
            raise LibrarySizeError(f"素材解码像素过大：{asset_id}") from invalid
        except (OSError, ValueError) as invalid:
            width = height = None
            error = str(invalid)[:240] or type(invalid).__name__
    draw = ImageDraw.Draw(sheet)
    draw.text((left, top + 143), str(asset_id), fill="#111827", font=ImageFont.load_default(size=16))
    if error is not None:
        draw.line((left + 22, top + 22, left + 114, top + 114), fill="#dc2626", width=3)
        draw.line((left + 114, top + 22, left + 22, top + 114), fill="#dc2626", width=3)
        draw.text((left + 37, top + 60), "FAILED", fill="#991b1b", font=ImageFont.load_default(size=14))
    else:
        draw.text((left, top + 163), f"{width} x {height}", fill="#4b5563", font=ImageFont.load_default(size=11))
    return width, height, error


def _sheet_bytes(sheet: Image.Image, ids: list[int], failed: list[int]) -> bytes:
    output = io.BytesIO()
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("AssetIDs", ",".join(map(str, ids)))
    if failed:
        metadata.add_text("FailedAssetIDs", ",".join(map(str, failed)))
    sheet.save(output, "PNG", pnginfo=metadata)
    return output.getvalue()


def _asset_category_ids(catalog: dict, selected: list[int]) -> dict[int, list]:
    result = {asset_id: [] for asset_id in selected}
    categories = catalog.get("categories")
    for key, category in categories.items() if isinstance(categories, dict) else []:
        if not isinstance(category, dict) or not isinstance(category.get("images"), list):
            continue
        members = {str(value) for value in category["images"]}
        for asset_id in selected:
            category_id = category.get("id", key)
            if str(asset_id) in members and category_id not in result[asset_id]:
                result[asset_id].append(category_id)
    return result


def build_asset_pack(ids: list[int] | None = None, all_assets: bool = False) -> bytes:
    """请求内打包原始 PNG、检索清单和逐页预览，不存盘或长期缓存。"""
    catalog = _pack_catalog()
    selected = select_asset_ids(catalog, ids, all_assets)
    category_ids = _asset_category_ids(catalog, selected)
    descriptions = catalog.get("descriptions")
    descriptions = descriptions if isinstance(descriptions, dict) else {}
    manifest = {"schemaVersion": 1, "assets": [], "contactSheets": [],
                "counts": {"requested": len(selected), "ok": 0, "failed": 0}}
    output = io.BytesIO()
    budget = _PackBudget()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for start in range(0, len(selected), CONTACT_SHEET_MAX_ASSETS):
            page_ids = selected[start:start + CONTACT_SHEET_MAX_ASSETS]
            sheet_path = f"contact-sheets/{start // CONTACT_SHEET_MAX_ASSETS + 1:03d}.png"
            sheet = _sheet_canvas(len(page_ids))
            failed = []
            try:
                with ThreadPoolExecutor(max_workers=PACK_DOWNLOAD_WORKERS) as pool:
                    downloads = pool.map(lambda asset_id: _download_pack_sprite(asset_id, budget), page_ids)
                    for index, (asset_id, (body, error)) in enumerate(zip(page_ids, downloads)):
                        width, height, error = _sheet_asset(sheet, index, asset_id, body, error)
                        path = None if error else f"images/{asset_id}.png"
                        if path is not None:
                            archive.writestr(path, body)
                            manifest["counts"]["ok"] += 1
                        else:
                            failed.append(asset_id)
                            manifest["counts"]["failed"] += 1
                        annotation = descriptions.get(str(asset_id))
                        annotation = annotation if isinstance(annotation, dict) else {}
                        manifest["assets"].append({
                            "id": asset_id, "path": path, "imageUrl": sprite_url(asset_id),
                            "description": annotation.get("description", ""), "uses": annotation.get("uses", []),
                            "categoryIds": category_ids[asset_id], "width": width, "height": height,
                            "status": "failed" if error else "ok", "error": error,
                            "contactSheet": {"path": sheet_path, "index": index},
                        })
                archive.writestr(sheet_path, _sheet_bytes(sheet, page_ids, failed))
                manifest["contactSheets"].append({"path": sheet_path, "ids": page_ids})
            finally:
                sheet.close()
            if output.tell() > MAX_PACK_BYTES:
                raise LibrarySizeError(f"素材 ZIP 超过 {MAX_PACK_BYTES} 字节")
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"))
    if output.tell() > MAX_PACK_BYTES:
        raise LibrarySizeError(f"素材 ZIP 超过 {MAX_PACK_BYTES} 字节")
    return output.getvalue()


def build_contact_sheet(ids: list[int]) -> bytes:
    catalog = _pack_catalog()
    selected = select_asset_ids(catalog, ids, max_ids=CONTACT_SHEET_MAX_ASSETS)
    sheet = _sheet_canvas(len(selected))
    failed = []
    budget = _PackBudget()
    try:
        with ThreadPoolExecutor(max_workers=PACK_DOWNLOAD_WORKERS) as pool:
            downloads = pool.map(lambda asset_id: _download_pack_sprite(asset_id, budget), selected)
            for index, (asset_id, (body, error)) in enumerate(zip(selected, downloads)):
                _width, _height, error = _sheet_asset(sheet, index, asset_id, body, error)
                if error:
                    failed.append(asset_id)
        return _sheet_bytes(sheet, selected, failed)
    finally:
        sheet.close()


def _as_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def normalize_sprite_meta(image_id: str, raw: dict) -> dict:
    """把 Unity 的 meta 压成前端直接可用的形状。"""
    rect = raw.get("m_Rect") if isinstance(raw.get("m_Rect"), dict) else {}
    border = raw.get("m_Border") if isinstance(raw.get("m_Border"), dict) else {}
    pivot = raw.get("m_Pivot") if isinstance(raw.get("m_Pivot"), dict) else {}

    left = _as_float(border.get("X"))
    bottom = _as_float(border.get("Y"))
    right = _as_float(border.get("Z"))
    top = _as_float(border.get("W"))

    return {
        "id": int(image_id),
        "width": round(_as_float(rect.get("width")), 4),
        "height": round(_as_float(rect.get("height")), 4),
        "stretchable": any(value > 0 for value in (left, bottom, right, top)),
        "border": {"left": left, "bottom": bottom, "right": right, "top": top},
        "pivot": {"x": _as_float(pivot.get("X"), 0.5), "y": _as_float(pivot.get("Y"), 0.5)},
        "pixelsToUnits": _as_float(raw.get("m_PixelsToUnits"), 1.0),
    }


def etag_matches(header_value: str | None, etag: str | None) -> bool:
    """比较 If-None-Match 与当前 ETag，兼容弱校验与多值形式。"""
    if not header_value or not etag:
        return False
    expected = etag.strip()
    if expected.startswith("W/"):
        expected = expected[2:]
    for candidate in header_value.split(","):
        normalized = candidate.strip()
        if normalized == "*":
            return True
        if normalized.startswith("W/"):
            normalized = normalized[2:]
        if normalized == expected:
            return True
    return False
