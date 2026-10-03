"""Stateless OSS proxy for Prefab information; thumbnail IDs are entity IDs.

This library is separate from the six-digit UI sprite library. Production data
is read from OSS, with browser-owned caching and optional category translations.
"""

from __future__ import annotations

import hashlib
import json
import os
import re

from . import image_library
from .image_library import BundleResult, LibraryIdError, LibraryUpstreamError, UpstreamDocument


DEFAULT_OSS_BASE = "https://oss.070077.xyz/prefabs"
DOCUMENTS = (("catalog", "data.json"), ("zh-CN", "i18n/zh-cn.json"), ("en-US", "i18n/en-us.json"))
ID_RE = re.compile(r"[1-9][0-9]{0,9}")


def oss_base() -> str:
    return os.environ.get("MILIASTRA_PREFAB_OSS_BASE", DEFAULT_OSS_BASE).rstrip("/")


def normalize_prefab_id(value: str | int) -> str:
    candidate = str(value).strip()
    if candidate.lower().endswith(".png"):
        candidate = candidate[:-4]
    if not ID_RE.fullmatch(candidate) or int(candidate) > 0xFFFFFFFF:
        raise LibraryIdError("Prefab ID 必须是有效的正整数元件 ID")
    return candidate


def _fetch(path: str, conditional: str | None = None) -> UpstreamDocument:
    try:
        return image_library.fetch_document(path, if_none_match=conditional, base_url=oss_base(), max_bytes=8 * 1024 * 1024)
    except (LibraryUpstreamError, image_library.LibrarySizeError) as error:
        if path == "data.json":
            raise LibraryUpstreamError(str(error)) from error
        return UpstreamDocument(body=None, etag=None, missing=True)


def _decode(body: bytes | None, *, required: bool = False) -> dict:
    try:
        value = json.loads(body or b"{}")
        if isinstance(value, dict):
            return value
    except (UnicodeDecodeError, ValueError):
        pass
    if required:
        raise LibraryUpstreamError("Prefab data.json 不是合法的 JSON 对象")
    return {}


def _parse_etag(value: str | None) -> tuple[str, ...] | None:
    for candidate in (value or "").split(","):
        candidate = candidate.strip().removeprefix("W/").strip('"')
        parts = candidate.split(".")
        if len(parts) == 4 and parts[0] == "p1" and all(re.fullmatch(r"[0-9A-Za-z_-]+", p) for p in parts[1:]):
            return tuple(parts[1:])
    return None


def _bundle_etag(tokens: tuple[str, ...] | list[str]) -> str:
    return '"p1.' + ".".join(tokens) + '"'


def _positive_int(value) -> bool:
    return type(value) is int and 0 < value <= 0xFFFFFFFF


def _normalize_catalog(catalog: dict, names: dict[str, dict]) -> dict:
    raw_images = catalog.get("imageData")
    raw_categories = catalog.get("category")
    version = catalog.get("schemaVersion")
    if version not in (1, 2) or not isinstance(raw_images, dict) or not isinstance(raw_categories, dict):
        raise LibraryUpstreamError("Prefab data.json 的 schemaVersion/imageData/category 格式不正确")
    if version == 2 and catalog.get("rendering") != {"formats": ["lua"], "imageSource": "Prefab", "idVariableType": "PrefabId"}:
        raise LibraryUpstreamError("Prefab rendering 配置不正确")
    prefabs = {}
    for key, row in raw_images.items():
        if not isinstance(row, dict) or not _positive_int(row.get("id")) or str(row["id"]) != key:
            raise LibraryUpstreamError(f"Prefab 记录的 ID 不正确：{key}")
        image = row.get("img")
        if image is not None and image != f"sprite/{key}.png":
            raise LibraryUpstreamError(f"Prefab 缩略图路径与元件 ID 不匹配：{key}")
        if image and not all(_positive_int(row.get(field)) for field in ("width", "height")):
            raise LibraryUpstreamError(f"Prefab 缩略图尺寸不正确：{key}")
        if version == 2 and image is None and (row.get("width") is not None or row.get("height") is not None):
            raise LibraryUpstreamError(f"Prefab 缺图记录不能含缩略图尺寸：{key}")
        if row.get("entityType") not in {"Gadget", "Monster", "Level"}:
            raise LibraryUpstreamError(f"Prefab 实体类型不正确：{key}")
        for field in (("listIds", "categoryIds") if version == 1 else ("categoryIds",)):
            if not isinstance(row.get(field), list) or not all(_positive_int(v) for v in row[field]):
                raise LibraryUpstreamError(f"Prefab {field} 格式不正确：{key}")
        if not isinstance(row.get("names"), dict) or not all(isinstance(v, str) for v in row["names"].values()):
            raise LibraryUpstreamError(f"Prefab names 格式不正确：{key}")
        fields = ("id", "img", "width", "height", "names", "entityType", "categoryIds")
        record = {field: row.get(field) for field in fields} if version == 2 else dict(row)
        prefabs[key] = {**record, "imageUrl": f"{oss_base()}/{image}" if image else None}
    categories = {}
    for key, row in raw_categories.items():
        if not isinstance(row, dict) or not _positive_int(row.get("id")) or str(row["id"]) != key or not isinstance(row.get("images"), list):
            raise LibraryUpstreamError(f"Prefab 分类格式不正确：{key}")
        categories[key] = {"id": row["id"], "prefabIds": [i for i in row["images"] if _positive_int(i) and str(i) in prefabs],
                           "names": {lang: labels[key] for lang, labels in names.items() if isinstance(labels.get(key), str)}}
    payload = {"schemaVersion": version, "prefabs": prefabs, "categories": categories}
    if version == 2:
        payload.update(dataVersion=catalog.get("dataVersion"), rendering=catalog["rendering"], categoryLabelSource="curated")
    else:
        payload.update(source=catalog.get("source", {}), classification=catalog.get("classification", {}))
    return payload


def get_catalog_bundle(if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    expected = None if force else _parse_etag(if_none_match)
    documents = []
    for index, (_key, path) in enumerate(DOCUMENTS):
        conditional = f'"{expected[index]}"' if expected and expected[index] != "0" else None
        document = _fetch(path, conditional)
        if document.missing and path == "data.json":
            raise LibraryUpstreamError("上游缺少 Prefab data.json")
        documents.append(document)
    if expected and all(d.not_modified or (d.missing and expected[i] == "0") for i, d in enumerate(documents)):
        return BundleResult(payload=None, etag=_bundle_etag(expected), not_modified=True)
    bodies = {}
    tokens = []
    for (key, path), document in zip(DOCUMENTS, documents):
        if document.not_modified:
            document = _fetch(path)
        if document.missing and path == "data.json":
            raise LibraryUpstreamError("上游缺少 Prefab data.json")
        bodies[key] = document.body
        tokens.append(image_library._etag_token(document.etag))
    catalog = _decode(bodies["catalog"], required=True)
    names = {lang: _decode(bodies[lang]) for lang, _path in DOCUMENTS[1:]}
    payload = json.dumps(_normalize_catalog(catalog, names), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    # 上游没有 ETag 时不能依靠全零 token 返回 304；用正文摘要区分版本。
    if tokens[0] == "0":
        tokens[0] = hashlib.sha256(payload).hexdigest()[:48]
    return BundleResult(payload=payload, etag=_bundle_etag(tokens), not_modified=False)


def find_prefab(payload: dict, prefab_id: str | int) -> dict | None:
    key = normalize_prefab_id(prefab_id)
    record = payload["prefabs"].get(key)
    if record is None:
        return None
    categories = payload.get("categories", {})
    return {**record, "categories": [{"id": i, "names": categories[str(i)]["names"]} for i in record["categoryIds"] if str(i) in categories],
            "source": payload.get("source", {})}


def get_prefab_bundle(prefab_id: str | int, if_none_match: str | None = None, *, force: bool = False) -> BundleResult:
    key = normalize_prefab_id(prefab_id)
    catalog = get_catalog_bundle(force=force)
    info = find_prefab(json.loads(catalog.payload), key)
    if info is None:
        raise image_library.LibraryNotFoundError(f"未找到元件 ID：{key}")
    payload = json.dumps(info, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    etag = '"prefab.' + hashlib.sha256(payload).hexdigest() + '"'
    if not force and image_library.etag_matches(if_none_match, etag):
        return BundleResult(payload=None, etag=etag, not_modified=True)
    return BundleResult(payload=payload, etag=etag, not_modified=False)
