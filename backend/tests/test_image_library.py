import json
import re
import unittest
from pathlib import Path
from unittest import mock

from fastapi import HTTPException
from starlette.requests import Request

from app import image_library
from app.main import library_catalog, library_image_meta, library_sprite

CATALOG = {
    "imageData": {
        "106001": {"id": 106001, "img": "sprite/106001.png", "border": "border/106001.json"},
    },
    "category": {"1": {"id": 1, "images": [106001]}},
}
NAMES_ZH = {"1": "底板-单色"}
NAMES_EN = {"1": "Surface - Monochrome"}


def make_request(headers: dict | None = None) -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request({"type": "http", "method": "GET", "path": "/", "headers": raw})


class FakeUpstream:
    """模拟 OSS：支持 ETag 与 If-None-Match 条件请求，并记录调用。"""

    def __init__(self, files: dict[str, tuple[object, str]], *, failing: bool = False):
        self.files = files
        self.failing = failing
        self.calls: list[tuple[str, str | None]] = []
        self.accepts: list[str] = []

    def __call__(
        self,
        path: str,
        *,
        if_none_match: str | None = None,
        accept: str = "application/json, */*",
    ) -> image_library.UpstreamDocument:
        self.calls.append((path, if_none_match))
        self.accepts.append(accept)
        if self.failing:
            raise image_library.LibraryUpstreamError(path)
        if path not in self.files:
            return image_library.UpstreamDocument(body=None, etag=None, missing=True)
        payload, etag = self.files[path]
        if if_none_match and if_none_match.strip('"') == etag:
            return image_library.UpstreamDocument(body=None, etag=f'"{etag}"', not_modified=True)
        body = payload if isinstance(payload, (bytes, bytearray)) else json.dumps(payload).encode("utf-8")
        return image_library.UpstreamDocument(body=body, etag=f'"{etag}"')

    def paths(self) -> list[str]:
        return [path for path, _ in self.calls]


def standard_files(zh_etag: str = "zh111") -> dict[str, tuple[object, str]]:
    return {
        "data.json": (CATALOG, "cat111"),
        "i18n/zh-cn.json": (NAMES_ZH, zh_etag),
        "i18n/en-us.json": (NAMES_EN, "en111"),
    }


class HelperTests(unittest.TestCase):
    def test_normalize_image_id(self):
        self.assertEqual(image_library.normalize_image_id(106001), "106001")
        self.assertEqual(image_library.normalize_image_id(" 100001 "), "100001")
        # 贴图端点常带 .png 后缀
        self.assertEqual(image_library.normalize_image_id("106001.png"), "106001")
        self.assertEqual(image_library.normalize_image_id("106001.PNG"), "106001")
        for bad in ("../secret", "10600", "1060011", "abcdef", "", "106001/../x", "106001.png.exe"):
            with self.subTest(bad=bad), self.assertRaises(image_library.LibraryIdError):
                image_library.normalize_image_id(bad)

    def test_normalize_sprite_meta_detects_nine_slice(self):
        stretchable = image_library.normalize_sprite_meta(
            "106001",
            {
                "m_Rect": {"width": 8.0, "height": 8.0},
                "m_Border": {"X": 4.0, "Y": 4.0, "Z": 4.0, "W": 4.0},
                "m_Pivot": {"X": 0.5, "Y": 0.5},
            },
        )
        self.assertEqual((stretchable["width"], stretchable["height"]), (8.0, 8.0))
        self.assertTrue(stretchable["stretchable"])
        self.assertEqual(stretchable["border"], {"left": 4.0, "bottom": 4.0, "right": 4.0, "top": 4.0})

        flat = image_library.normalize_sprite_meta(
            "100101", {"m_Rect": {"width": 32, "height": 32}, "m_Border": {"X": 0, "Y": 0, "Z": 0, "W": 0}}
        )
        self.assertFalse(flat["stretchable"])
        self.assertEqual(flat["pivot"], {"x": 0.5, "y": 0.5})

    def test_normalize_sprite_meta_tolerates_garbage(self):
        meta = image_library.normalize_sprite_meta("106001", {"m_Rect": "broken", "m_Border": None})
        self.assertEqual(meta["width"], 0.0)
        self.assertFalse(meta["stretchable"])

    def test_bundle_etag_round_trip(self):
        etag = image_library.build_bundle_etag(("cat111", "zh111", "en111"))
        self.assertEqual(etag, '"m1.cat111.zh111.en111"')
        self.assertEqual(image_library.parse_bundle_etag(etag), ("cat111", "zh111", "en111"))
        self.assertEqual(image_library.parse_bundle_etag('W/"m1.a.b.c"'), ("a", "b", "c"))
        self.assertEqual(image_library.parse_bundle_etag('"other", "m1.a.b.c"'), ("a", "b", "c"))

    def test_parse_bundle_etag_rejects_garbage(self):
        for bad in (None, "", '"m1..b.c"', '"m2.a.b.c"', '"m1.a.b"', "not-an-etag"):
            with self.subTest(bad=bad):
                self.assertIsNone(image_library.parse_bundle_etag(bad))

    def test_etag_matches_handles_weak_and_multi_values(self):
        self.assertTrue(image_library.etag_matches('"abc"', '"abc"'))
        self.assertTrue(image_library.etag_matches('W/"abc"', '"abc"'))
        self.assertTrue(image_library.etag_matches('"other", "abc"', '"abc"'))
        self.assertTrue(image_library.etag_matches("*", '"abc"'))
        self.assertFalse(image_library.etag_matches('"nope"', '"abc"'))
        self.assertFalse(image_library.etag_matches(None, '"abc"'))

    def test_module_performs_no_disk_writes(self):
        """守住「后端不缓存」这条约束：模块里不允许出现任何落盘调用。"""
        source = Path(image_library.__file__).read_text(encoding="utf-8")
        for forbidden in ("write_text", "write_bytes", "mkdir", "tempfile", "TemporaryFile"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, source)
        self.assertIsNone(re.search(r"(?<!url)\bopen\(", source), "只允许 urllib 的 urlopen，不允许直接开文件")


class CatalogTests(unittest.TestCase):
    def run_bundle(self, upstream: FakeUpstream, **kwargs) -> image_library.BundleResult:
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            return image_library.get_catalog_bundle(**kwargs)

    def test_cold_request_fetches_every_document(self):
        upstream = FakeUpstream(standard_files())
        result = self.run_bundle(upstream)

        self.assertFalse(result.not_modified)
        self.assertEqual(upstream.paths(), ["data.json", "i18n/zh-cn.json", "i18n/en-us.json"])
        self.assertIsNone(upstream.calls[0][1], "冷请求不应带 If-None-Match")
        self.assertEqual(result.etag, '"m1.cat111.zh111.en111"')

        bundle = json.loads(result.payload)
        self.assertIn("106001", bundle["images"])
        self.assertEqual(bundle["categories"]["1"]["images"], [106001])
        self.assertEqual(bundle["names"]["zh-CN"], NAMES_ZH)
        self.assertEqual(bundle["names"]["en-US"], NAMES_EN)

    def test_revalidation_hit_transfers_no_body(self):
        upstream = FakeUpstream(standard_files())
        first = self.run_bundle(upstream)

        upstream.calls.clear()
        second = self.run_bundle(upstream, if_none_match=first.etag)

        self.assertTrue(second.not_modified)
        self.assertIsNone(second.payload)
        self.assertEqual(second.etag, first.etag)
        self.assertEqual(len(upstream.calls), 3)
        for path, header in upstream.calls:
            with self.subTest(path=path):
                self.assertIsNotNone(header, "校验请求必须带上上游 ETag")

    def test_revalidation_refetches_only_the_changed_document(self):
        upstream = FakeUpstream(standard_files())
        first = self.run_bundle(upstream)

        upstream.files["i18n/zh-cn.json"] = ({"1": "底板-彩色"}, "zh222")
        upstream.calls.clear()
        second = self.run_bundle(upstream, if_none_match=first.etag)

        self.assertFalse(second.not_modified)
        self.assertNotEqual(second.etag, first.etag)
        self.assertEqual(second.etag, '"m1.cat111.zh222.en111"')
        bundle = json.loads(second.payload)
        self.assertEqual(bundle["names"]["zh-CN"], {"1": "底板-彩色"})
        self.assertEqual(bundle["names"]["en-US"], NAMES_EN)
        # 变更文件条件请求直接拿到正文；未变更的被 304 后仍需无条件重取一次以组装新响应
        self.assertEqual(upstream.paths().count("i18n/zh-cn.json"), 1)
        self.assertEqual(upstream.paths().count("data.json"), 2)
        self.assertEqual(upstream.paths().count("i18n/en-us.json"), 2)

    def test_force_refresh_skips_conditional_headers(self):
        upstream = FakeUpstream(standard_files())
        first = self.run_bundle(upstream)
        upstream.calls.clear()

        result = self.run_bundle(upstream, if_none_match=first.etag, force=True)

        self.assertFalse(result.not_modified)
        self.assertTrue(all(header is None for _path, header in upstream.calls))

    def test_missing_i18n_is_tolerated(self):
        files = standard_files()
        files.pop("i18n/zh-cn.json")
        upstream = FakeUpstream(files)
        result = self.run_bundle(upstream)

        bundle = json.loads(result.payload)
        self.assertEqual(bundle["names"]["zh-CN"], {})
        self.assertEqual(bundle["names"]["en-US"], NAMES_EN)
        self.assertIn("106001", bundle["images"])

    def test_missing_catalog_is_an_error(self):
        files = standard_files()
        files.pop("data.json")
        with self.assertRaises(image_library.LibraryUpstreamError):
            self.run_bundle(FakeUpstream(files))

    def test_upstream_failure_propagates(self):
        with self.assertRaises(image_library.LibraryUpstreamError):
            self.run_bundle(FakeUpstream({}, failing=True))

    def test_invalid_upstream_json_is_an_error(self):
        upstream = FakeUpstream(standard_files())
        upstream.files["data.json"] = (b'{"imageData": ', "cat111")
        with self.assertRaises(image_library.LibraryUpstreamError):
            self.run_bundle(upstream)


class MetaTests(unittest.TestCase):
    def test_meta_is_normalized_and_etag_passthrough(self):
        files = {
            "border/106001.json": (
                {"m_Rect": {"width": 8.0, "height": 8.0}, "m_Border": {"X": 4, "Y": 4, "Z": 4, "W": 4}},
                "meta111",
            )
        }
        upstream = FakeUpstream(files)
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            result = image_library.get_image_meta("106001")

        meta = json.loads(result.payload)
        self.assertEqual(meta["id"], 106001)
        self.assertTrue(meta["stretchable"])
        self.assertEqual(result.etag, '"meta111"')

    def test_meta_revalidation_returns_304(self):
        files = {"border/106001.json": ({"m_Rect": {"width": 8, "height": 8}}, "meta111")}
        upstream = FakeUpstream(files)
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            first = image_library.get_image_meta("106001")
            second = image_library.get_image_meta("106001", first.etag)

        self.assertTrue(second.not_modified)
        self.assertIsNone(second.payload)

    def test_meta_missing_raises_not_found(self):
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream({})):
            with self.assertRaises(image_library.LibraryNotFoundError):
                image_library.get_image_meta("107181")

    def test_meta_rejects_bad_id(self):
        with self.assertRaises(image_library.LibraryIdError):
            image_library.get_image_meta("../../etc/passwd")


class SpriteProxyTests(unittest.TestCase):
    """贴图代理：单色素材的 CSS 遮罩要求同源，跨域遮罩会让元素整块消失。"""

    def test_sprite_is_streamed_from_upstream(self):
        upstream = FakeUpstream({"sprite/106001.png": (b"\x89PNG-fake", "sprite111")})
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            response = library_sprite("106001", make_request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "image/png")
        self.assertEqual(response.headers["etag"], '"sprite111"')
        self.assertEqual(response.body, b"\x89PNG-fake")

    def test_sprite_requests_image_accept_header(self):
        upstream = FakeUpstream({"sprite/106001.png": (b"png", "sprite111")})
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            image_library.get_sprite("106001")

        self.assertIn("image/png", upstream.accepts[0])

    def test_sprite_revalidation_returns_304(self):
        upstream = FakeUpstream({"sprite/106001.png": (b"png", "sprite111")})
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            first = library_sprite("106001", make_request())
            second = library_sprite("106001", make_request({"if-none-match": first.headers["etag"]}))

        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.body, b"")

    def test_sprite_endpoint_accepts_png_suffix(self):
        upstream = FakeUpstream({"sprite/106001.png": (b"png", "sprite111")})
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            response = library_sprite("106001.png", make_request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(upstream.paths(), ["sprite/106001.png"])

    def test_sprite_rejects_bad_id(self):
        with self.assertRaises(HTTPException) as context:
            library_sprite("../../etc/passwd", make_request())
        self.assertEqual(context.exception.status_code, 400)

    def test_sprite_missing_returns_404(self):
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream({})):
            with self.assertRaises(HTTPException) as context:
                library_sprite("107181", make_request())
        self.assertEqual(context.exception.status_code, 404)


class EndpointTests(unittest.TestCase):
    def test_catalog_endpoint_sets_etag_and_long_cache(self):
        upstream = FakeUpstream(standard_files())
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            response = library_catalog(make_request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["etag"], '"m1.cat111.zh111.en111"')
        self.assertIn("max-age=43200", response.headers["cache-control"])
        self.assertEqual(json.loads(response.body)["categories"]["1"]["images"], [106001])

    def test_catalog_endpoint_returns_304_without_body(self):
        upstream = FakeUpstream(standard_files())
        with mock.patch.object(image_library, "fetch_document", side_effect=upstream):
            first = library_catalog(make_request())
            second = library_catalog(make_request({"if-none-match": first.headers["etag"]}))

        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.body, b"")

    def test_catalog_endpoint_reports_upstream_failure(self):
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream({}, failing=True)):
            with self.assertRaises(HTTPException) as context:
                library_catalog(make_request())
        self.assertEqual(context.exception.status_code, 502)

    def test_meta_endpoint_happy_path(self):
        files = {"border/106001.json": ({"m_Rect": {"width": 8, "height": 8}}, "meta111")}
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream(files)):
            response = library_image_meta("106001", make_request())

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["width"], 8.0)

    def test_meta_endpoint_rejects_bad_id(self):
        with self.assertRaises(HTTPException) as context:
            library_image_meta("../../etc/passwd", make_request())
        self.assertEqual(context.exception.status_code, 400)

    def test_meta_endpoint_returns_404_when_missing(self):
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream({})):
            with self.assertRaises(HTTPException) as context:
                library_image_meta("107181", make_request())
        self.assertEqual(context.exception.status_code, 404)

    def test_meta_endpoint_reports_upstream_failure(self):
        with mock.patch.object(image_library, "fetch_document", side_effect=FakeUpstream({}, failing=True)):
            with self.assertRaises(HTTPException) as context:
                library_image_meta("106001", make_request())
        self.assertEqual(context.exception.status_code, 502)


if __name__ == "__main__":
    unittest.main()
