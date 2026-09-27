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

索引的 ETag 采用 `"m1.<data>.<zh>.<en>"` 结构，把三份上游 ETag 编码进去，
这样下次请求不必先回源就能知道该拿哪几个 ETag 去校验。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass

DEFAULT_OSS_BASE = "https://oss.070077.xyz/images"
# 与 OSS 自身的 cache-control: max-age=43200 对齐
DEFAULT_BROWSER_MAX_AGE = 12 * 60 * 60
DEFAULT_TIMEOUT_SECONDS = 15.0

CATALOG_PATH = "data.json"
CATEGORY_NAME_PATHS: tuple[tuple[str, str], ...] = (
    ("zh-CN", "i18n/zh-cn.json"),
    ("en-US", "i18n/en-us.json"),
)

IMAGE_ID_RE = re.compile(r"^\d{6}$")
UNSAFE_ETAG_CHARS_RE = re.compile(r"[^0-9A-Za-z_-]")


class LibraryUpstreamError(RuntimeError):
    """上游 OSS 不可用。"""


class LibraryNotFoundError(RuntimeError):
    """上游不存在该资源（例如无图条目没有 border 文件）。"""


class LibraryIdError(ValueError):
    """图片 ID 格式非法。"""


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
            return UpstreamDocument(body=response.read(), etag=response.headers.get("ETag"))
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


def build_bundle_etag(tokens: tuple[str, str, str]) -> str:
    return '"m1.' + ".".join(tokens) + '"'


def parse_bundle_etag(value: str | None) -> tuple[str, str, str] | None:
    """从 If-None-Match 中还原三份上游 ETag token。"""
    if not value:
        return None
    for candidate in value.split(","):
        normalized = candidate.strip()
        if normalized.startswith("W/"):
            normalized = normalized[2:]
        normalized = normalized.strip('"')
        parts = normalized.split(".")
        if len(parts) == 4 and parts[0] == "m1" and all(parts[1:]):
            return parts[1], parts[2], parts[3]
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


def get_catalog_bundle(if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    """合并索引与分类名，一次响应满足前端启动所需的全部元数据。"""
    specs: tuple[tuple[str, str], ...] = (("catalog", CATALOG_PATH), *CATEGORY_NAME_PATHS)
    expected = None if force else parse_bundle_etag(if_none_match)

    documents: dict[str, UpstreamDocument] = {}
    for index, (key, path) in enumerate(specs):
        conditional = _conditional_header(expected[index]) if expected else None
        document = fetch_document(path, if_none_match=conditional)
        if document.missing and path == CATALOG_PATH:
            raise LibraryUpstreamError(f"上游缺少索引文件：{path}")
        documents[key] = document

    if expected and all(document.not_modified for document in documents.values()):
        return BundleResult(payload=None, etag=build_bundle_etag(expected), not_modified=True)

    tokens: list[str] = []
    bodies: dict[str, bytes] = {}
    for key, path in specs:
        document = documents[key]
        if document.not_modified or document.missing:
            # 上游说没变、但同批里有别的文件变了，需要无条件重取一次才能组装新响应
            document = UpstreamDocument(body=None, etag=None) if document.missing else fetch_document(path)
        bodies[key] = document.body or b"{}"
        tokens.append(_etag_token(document.etag))

    catalog = _decode_json(UpstreamDocument(body=bodies["catalog"], etag=None))
    names: dict[str, dict] = {}
    for key, _path in CATEGORY_NAME_PATHS:
        names[key] = _decode_json(UpstreamDocument(body=bodies[key], etag=None))

    bundle = {
        "images": catalog.get("imageData") or {},
        "categories": catalog.get("category") or {},
        "names": names,
    }
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return BundleResult(payload=payload, etag=build_bundle_etag((tokens[0], tokens[1], tokens[2])), not_modified=False)


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
