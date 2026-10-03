import copy
import json
import unittest
from unittest import mock

from fastapi import HTTPException
from starlette.requests import Request

from app import image_library, prefab_library
from app.main import prefab_catalog, prefab_info


# Small synthetic fixtures, never a runtime fallback for the OSS catalog.
CATALOG = {
    "schemaVersion": 1,
    "source": {"build": "test-build"},
    "imageData": {
        "20001003": {"id": 20001003, "img": "sprite/20001003.png", "width": 256, "height": 256,
                     "names": {"zh-CN": "测试竹子", "en-US": "Test bamboo"}, "descriptions": {},
                     "entityType": "Gadget", "baseId": 20001003, "gadgetId": 80900003,
                     "listIds": [1000003], "categoryIds": [120201], "jsonName": "test-gadget"},
        "30005016": {"id": 30005016, "img": None, "width": None, "height": None,
                     "names": {"zh-CN": "测试造物"}, "descriptions": {}, "entityType": "Monster",
                     "baseId": 10005016, "gadgetId": None, "listIds": [1000400], "categoryIds": [], "jsonName": "test-monster"},
    },
    "category": {"120201": {"id": 120201, "images": [20001003]}},
}


def make_request(headers=None):
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [
        (k.lower().encode(), v.encode()) for k, v in (headers or {}).items()
    ]})


class Upstream:
    def __init__(self):
        self.files = {"data.json": (copy.deepcopy(CATALOG), "data1"),
                      "i18n/zh-cn.json": ({"120201": "测试树木"}, "zh1"),
                      "i18n/en-us.json": ({"120201": "Test trees"}, "en1")}
        self.calls = []
        self.fail = set()

    def __call__(self, path, *, if_none_match=None, base_url=None, max_bytes=None):
        self.calls.append((path, if_none_match, base_url))
        if path in self.fail:
            raise image_library.LibraryUpstreamError("test outage")
        if path not in self.files:
            return image_library.UpstreamDocument(None, None, missing=True)
        payload, etag = self.files[path]
        if etag and if_none_match == f'"{etag}"':
            return image_library.UpstreamDocument(None, f'"{etag}"', not_modified=True)
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        return image_library.UpstreamDocument(body, f'"{etag}"' if etag else None)


class PrefabTests(unittest.TestCase):
    def setUp(self):
        self.upstream = Upstream()
        self.patcher = mock.patch.object(image_library, "fetch_document", side_effect=self.upstream)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def test_exact_entity_id_and_separate_gadget_id(self):
        bundle = prefab_library.get_catalog_bundle()
        payload = json.loads(bundle.payload)
        info = prefab_library.find_prefab(payload, "20001003.png")
        self.assertEqual(info["gadgetId"], 80900003)
        self.assertEqual(info["imageUrl"], "https://oss.070077.xyz/prefabs/sprite/20001003.png")
        self.assertEqual(info["categories"][0]["names"]["zh-CN"], "测试树木")
        self.assertIsNone(prefab_library.find_prefab(payload, 1000003))
        self.assertIsNone(prefab_library.find_prefab(payload, 80900003))
        self.assertIsNone(prefab_library.find_prefab(payload, 106001))
        monster = prefab_library.find_prefab(payload, 30005016)
        self.assertIsNone(monster["gadgetId"])
        self.assertIsNone(monster["imageUrl"])

    def test_public_v2_catalog_omits_extraction_and_internal_fields(self):
        public = copy.deepcopy(CATALOG)
        public.update(schemaVersion=2, dataVersion="7.1.0", categoryLabelSource="curated",
                      rendering={"formats": ["lua"], "imageSource": "Prefab", "idVariableType": "PrefabId"})
        for row in public["imageData"].values():
            row.pop("listIds")
        self.upstream.files["data.json"] = (public, "public2")
        payload = json.loads(prefab_library.get_catalog_bundle().payload)
        self.assertEqual(payload["schemaVersion"], 2)
        self.assertEqual(payload["rendering"]["idVariableType"], "PrefabId")
        self.assertNotIn("source", payload)
        for row in payload["prefabs"].values():
            for field in ("listIds", "baseId", "gadgetId", "jsonName", "descriptions"):
                self.assertNotIn(field, row)
        self.assertTrue(all(path.endswith(".json") for path, _etag, _base in self.upstream.calls))
        public["rendering"]["idVariableType"] = "Int"
        with self.assertRaises(image_library.LibraryUpstreamError):
            prefab_library.get_catalog_bundle()

    def test_conditional_catalog_and_changed_classification_names(self):
        first = prefab_library.get_catalog_bundle()
        self.upstream.calls.clear()
        second = prefab_library.get_catalog_bundle(first.etag)
        self.assertTrue(second.not_modified)
        self.assertIsNone(second.payload)
        self.assertEqual(len(self.upstream.calls), 3)
        self.upstream.files["i18n/zh-cn.json"] = ({"120201": "新的测试分类"}, "zh2")
        changed = prefab_library.get_catalog_bundle(first.etag)
        self.assertNotEqual(changed.etag, first.etag)
        self.assertEqual(json.loads(changed.payload)["categories"]["120201"]["names"]["zh-CN"], "新的测试分类")

    def test_optional_translations_fail_without_losing_images(self):
        self.upstream.fail.add("i18n/zh-cn.json")
        self.upstream.files.pop("i18n/en-us.json")
        result = prefab_library.get_catalog_bundle()
        payload = json.loads(result.payload)
        self.assertEqual(payload["categories"]["120201"]["names"], {})
        self.assertTrue(payload["prefabs"]["20001003"]["imageUrl"])
        self.assertTrue(prefab_library.get_catalog_bundle(result.etag).not_modified)

    def test_required_missing_or_invalid_index_and_unsafe_image_paths(self):
        for bad in (b"bad-json", [], {**CATALOG, "schemaVersion": 2}):
            with self.subTest(bad=bad):
                self.upstream.files["data.json"] = (bad, "bad")
                with self.assertRaises(image_library.LibraryUpstreamError):
                    prefab_library.get_catalog_bundle()
        for path in ("//example.com/evil.png", "../images/sprite/106001.png", "sprite/80900003.png"):
            broken = copy.deepcopy(CATALOG)
            broken["imageData"]["20001003"]["img"] = path
            self.upstream.files["data.json"] = (broken, "bad")
            with self.assertRaises(image_library.LibraryUpstreamError):
                prefab_library.get_catalog_bundle()
        self.upstream.files.pop("data.json")
        with self.assertRaises(image_library.LibraryUpstreamError):
            prefab_library.get_catalog_bundle()

    def test_ids_reject_path_traversal_zero_and_out_of_range(self):
        for value in ("../20001003", "0", "-2", "1.5", "4294967296", "00020001003"):
            with self.subTest(value=value), self.assertRaises(image_library.LibraryIdError):
                prefab_library.normalize_prefab_id(value)

    def test_custom_oss_base_is_used_for_json_and_images(self):
        with mock.patch.dict("os.environ", {"MILIASTRA_PREFAB_OSS_BASE": "http://127.0.0.1:8438/prefabs/"}):
            payload = json.loads(prefab_library.get_catalog_bundle().payload)
        self.assertTrue(all(c[2] == "http://127.0.0.1:8438/prefabs" for c in self.upstream.calls))
        self.assertEqual(payload["prefabs"]["20001003"]["imageUrl"], "http://127.0.0.1:8438/prefabs/sprite/20001003.png")

    def test_endpoints_status_and_etag(self):
        response = prefab_catalog(make_request())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(prefab_catalog(make_request({"If-None-Match": response.headers["etag"]})).status_code, 304)
        info = prefab_info("20001003", make_request())
        self.assertEqual(json.loads(info.body)["id"], 20001003)
        self.assertEqual(prefab_info("20001003", make_request({"If-None-Match": info.headers["etag"]})).status_code, 304)
        for value, status in (("bad", 400), ("106001", 404)):
            with self.assertRaises(HTTPException) as raised:
                prefab_info(value, make_request())
            self.assertEqual(raised.exception.status_code, status)
        self.upstream.fail.add("data.json")
        with self.assertRaises(HTTPException) as raised:
            prefab_catalog(make_request())
        self.assertEqual(raised.exception.status_code, 502)

    def test_no_upstream_etag_still_identifies_changed_data(self):
        self.upstream.files["data.json"] = (copy.deepcopy(CATALOG), None)
        first = prefab_library.get_catalog_bundle()
        self.upstream.files["data.json"][0]["imageData"]["20001003"]["names"]["zh-CN"] = "新名称"
        second = prefab_library.get_catalog_bundle(first.etag)
        self.assertFalse(second.not_modified)
        self.assertNotEqual(first.etag, second.etag)


if __name__ == "__main__":
    unittest.main()
