import io
import json
import unittest
import zipfile
from unittest import mock

from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from app import image_library, main


def make_catalog(ids=(100001, 100002, 100003)):
    return {
        "images": {
            str(asset_id): {"id": asset_id, "img": f"sprite/{asset_id}.png"}
            for asset_id in ids
        },
        "categories": {
            "1": {"id": 1, "images": [100001, 100002]},
            "2": {"id": 2, "images": [100001]},
            "legacy": {"images": [100003]},
        },
        "descriptions": {
            "100001": {"description": "透明红色边框", "uses": ["container.frame"]},
            "100002": {"description": "蓝色竖条", "uses": ["metric.fill"]},
        },
    }


def catalog_bundle(catalog):
    return image_library.BundleResult(
        payload=json.dumps(catalog, ensure_ascii=False).encode("utf-8"),
        etag='"test-catalog"',
        not_modified=False,
    )


def png_bytes(size=(64, 16), color=(255, 0, 0, 255)):
    image = Image.new("RGBA", size, color)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def read_png(data):
    with Image.open(io.BytesIO(data)) as image:
        image.load()
        return image.convert("RGBA")


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.catalog = make_catalog()
        self.catalog["images"]["100004"] = {"id": 100004, "img": None}

    def test_explicit_selection_keeps_order_and_deduplicates(self):
        self.assertEqual(
            image_library.select_asset_ids(self.catalog, [100002, 100001, 100002]),
            [100002, 100001],
        )

    def test_all_selection_is_sorted_and_excludes_records_without_images(self):
        self.assertEqual(
            image_library.select_asset_ids(self.catalog, all_assets=True),
            [100001, 100002, 100003],
        )

    def test_ids_must_be_six_digit_integers(self):
        for bad in (True, False, "100001", 100001.0, 10000, 1000000, -100001, None):
            with self.subTest(value=bad), self.assertRaises(image_library.LibrarySelectionError):
                image_library.select_asset_ids(self.catalog, [bad])

    def test_unknown_id_and_known_record_without_image_are_rejected(self):
        for asset_id in (999999, 100004):
            with self.subTest(asset_id=asset_id), self.assertRaises(image_library.LibrarySelectionError):
                image_library.select_asset_ids(self.catalog, [asset_id])

    def test_selection_requires_ids_or_all_and_rejects_both(self):
        for kwargs in ({}, {"ids": []}, {"ids": [100001], "all_assets": True}):
            with self.subTest(kwargs=kwargs), self.assertRaises(image_library.LibrarySelectionError):
                image_library.select_asset_ids(self.catalog, **kwargs)

    def test_selection_limit_counts_unique_ids(self):
        self.assertEqual(
            image_library.select_asset_ids(self.catalog, [100001, 100001], max_ids=1),
            [100001],
        )
        with self.assertRaises(image_library.LibrarySelectionError):
            image_library.select_asset_ids(self.catalog, all_assets=True, max_ids=2)


class BoundedUpstreamTests(unittest.TestCase):
    def response(self, body, headers=None):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.headers = headers or {}
        response.read.side_effect = io.BytesIO(body).read
        return response

    def test_oversized_declared_body_is_rejected_before_reading(self):
        response = self.response(b"x" * 100, {"Content-Length": "100"})
        with mock.patch.object(image_library.urllib.request, "urlopen", return_value=response):
            with self.assertRaises(image_library.LibrarySizeError):
                image_library.fetch_document("sprite/100001.png", max_bytes=8)
        response.read.assert_not_called()

    def test_unknown_or_incorrect_content_length_still_uses_a_bounded_read(self):
        for headers in ({}, {"Content-Length": "2"}, {"Content-Length": "invalid"}):
            response = self.response(b"x" * 100, headers)
            with (
                self.subTest(headers=headers),
                mock.patch.object(image_library.urllib.request, "urlopen", return_value=response),
                self.assertRaises(image_library.LibrarySizeError),
            ):
                image_library.fetch_document("sprite/100001.png", max_bytes=8)
            response.read.assert_called_once_with(9)

    def test_exactly_at_limit_preserves_body_and_etag(self):
        response = self.response(b"12345678", {"Content-Length": "8", "ETag": '"sprite-etag"'})
        with mock.patch.object(image_library.urllib.request, "urlopen", return_value=response):
            document = image_library.fetch_document("sprite/100001.png", max_bytes=8)
        self.assertEqual(document.body, b"12345678")
        self.assertEqual(document.etag, '"sprite-etag"')
        response.read.assert_called_once_with(9)


class AssetPackTests(unittest.TestCase):
    def build_pack(self, ids=None, *, all_assets=False, catalog=None, sprites=None):
        catalog = catalog if catalog is not None else make_catalog()
        sprites = sprites if sprites is not None else {}

        def fetch(asset_id):
            result = sprites.get(asset_id, png_bytes())
            if isinstance(result, Exception):
                raise result
            return result

        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(catalog)),
            mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=fetch) as download,
        ):
            payload = image_library.build_asset_pack(ids, all_assets=all_assets)
        return payload, download

    def test_zip_contains_real_png_metadata_and_contact_sheet_index(self):
        source = read_png(png_bytes((64, 16), (255, 0, 0, 128)))
        source.putpixel((0, 0), (0, 0, 0, 0))
        output = io.BytesIO()
        source.save(output, format="PNG")
        payload, download = self.build_pack([100001, 100003], sprites={100001: output.getvalue()})

        self.assertEqual(sorted(call.args[0] for call in download.call_args_list), [100001, 100003])
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            self.assertIsNone(archive.testzip())
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["schemaVersion"], 1)
            self.assertEqual(manifest["counts"], {"requested": 2, "ok": 2, "failed": 0})
            self.assertEqual([asset["id"] for asset in manifest["assets"]], [100001, 100003])
            self.assertEqual(manifest["contactSheets"], [{"path": "contact-sheets/001.png", "ids": [100001, 100003]}])
            first, third = manifest["assets"]
            self.assertEqual(first["path"], "images/100001.png")
            self.assertEqual(first["imageUrl"], image_library.sprite_url(100001))
            self.assertEqual(first["description"], "透明红色边框")
            self.assertEqual(first["uses"], ["container.frame"])
            self.assertEqual(first["categoryIds"], [1, 2])
            self.assertEqual((first["width"], first["height"], first["status"]), (64, 16, "ok"))
            self.assertEqual(first["contactSheet"], {"path": "contact-sheets/001.png", "index": 0})
            self.assertEqual(third["categoryIds"], ["legacy"])
            self.assertEqual(third["contactSheet"], {"path": "contact-sheets/001.png", "index": 1})
            saved = read_png(archive.read(first["path"]))
            self.assertEqual(saved.size, source.size)
            self.assertEqual(saved.getpixel((0, 0))[3], 0)
            self.assertEqual(saved.getpixel((32, 8)), (255, 0, 0, 128))
            sheet = read_png(archive.read("contact-sheets/001.png"))
            self.assertEqual(sheet.size, (320, 184))

    def test_partial_download_failure_is_reported_and_has_a_sheet_placeholder(self):
        payload, _ = self.build_pack(
            [100001, 100002],
            sprites={100002: image_library.LibraryUpstreamError("upstream unavailable")},
        )
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["counts"], {"requested": 2, "ok": 1, "failed": 1})
            failed = manifest["assets"][1]
            self.assertEqual(failed["id"], 100002)
            self.assertEqual(failed["status"], "failed")
            self.assertIsNone(failed["path"])
            self.assertIsNone(failed["width"])
            self.assertIsNone(failed["height"])
            self.assertTrue(failed["error"])
            self.assertNotIn("images/100002.png", archive.namelist())
            self.assertEqual(failed["contactSheet"], {"path": "contact-sheets/001.png", "index": 1})
            sheet = read_png(archive.read("contact-sheets/001.png"))
            placeholder = sheet.crop((160, 0, 320, 150))
            self.assertGreater(len(placeholder.getcolors(160 * 150) or []), 1)
            self.assertTrue(any(red > green * 2 and red > blue * 2 for red, green, blue, _ in placeholder.getdata()))
            self.assertEqual(sheet.info["FailedAssetIDs"], "100002")

    def test_corrupt_download_does_not_masquerade_as_a_png(self):
        payload, _ = self.build_pack([100001, 100002], sprites={100002: b"not an image"})
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual(manifest["assets"][1]["status"], "failed")
            self.assertTrue(manifest["assets"][1]["error"])
            self.assertNotIn("images/100002.png", archive.namelist())

    def test_all_assets_are_sorted_and_contact_sheets_paginate_at_48(self):
        ids = list(range(100001, 100050))
        catalog = make_catalog(reversed(ids))
        payload, download = self.build_pack(all_assets=True, catalog=catalog)
        self.assertEqual(download.call_count, 49)
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual([asset["id"] for asset in manifest["assets"]], ids)
            self.assertEqual(manifest["counts"], {"requested": 49, "ok": 49, "failed": 0})
            self.assertEqual(
                manifest["contactSheets"],
                [
                    {"path": "contact-sheets/001.png", "ids": ids[:48]},
                    {"path": "contact-sheets/002.png", "ids": ids[48:]},
                ],
            )
            self.assertEqual(read_png(archive.read("contact-sheets/001.png")).size, (1280, 1104))
            self.assertEqual(read_png(archive.read("contact-sheets/002.png")).size, (160, 184))
            self.assertEqual(manifest["assets"][48]["contactSheet"], {"path": "contact-sheets/002.png", "index": 0})

    def test_pack_budget_is_enforced(self):
        with mock.patch.object(image_library, "MAX_PACK_BYTES", 64):
            with self.assertRaises(image_library.LibrarySizeError):
                self.build_pack([100001])

    def test_decoded_pixel_limit_is_enforced(self):
        with mock.patch.object(image_library, "MAX_SPRITE_PIXELS", 63):
            with self.assertRaises(image_library.LibrarySizeError):
                self.build_pack([100001], sprites={100001: png_bytes((8, 8))})

    def test_single_sprite_byte_limit_is_enforced(self):
        with mock.patch.object(image_library, "MAX_SPRITE_BYTES", 64):
            with self.assertRaises(image_library.LibrarySizeError):
                self.build_pack([100001], sprites={100001: png_bytes()})

    def test_catalog_failure_propagates_before_any_image_download(self):
        with (
            mock.patch.object(image_library, "get_catalog_bundle", side_effect=image_library.LibraryUpstreamError("offline")),
            mock.patch.object(image_library, "_fetch_pack_sprite") as download,
        ):
            with self.assertRaises(image_library.LibraryUpstreamError):
                image_library.build_asset_pack([100001])
            download.assert_not_called()


class ContactSheetTests(unittest.TestCase):
    def build_sheet(self, ids, sprites):
        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
            mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=lambda asset_id: sprites[asset_id]),
        ):
            return read_png(image_library.build_contact_sheet(ids))

    def test_contact_sheet_preserves_wide_and_tall_image_aspect_ratios(self):
        sheet = self.build_sheet(
            [100001, 100002],
            {100001: png_bytes((64, 16), (255, 0, 0, 255)), 100002: png_bytes((16, 64), (0, 0, 255, 255))},
        )
        self.assertEqual(sheet.size, (320, 184))
        for index, color, ratio in ((0, (255, 0, 0), 4), (1, (0, 0, 255), 0.25)):
            pixels = [
                (x, y)
                for y in range(150)
                for x in range(index * 160, (index + 1) * 160)
                if sheet.getpixel((x, y))[:3] == color
            ]
            self.assertTrue(pixels)
            width = max(x for x, _ in pixels) - min(x for x, _ in pixels) + 1
            height = max(y for _, y in pixels) - min(y for _, y in pixels) + 1
            self.assertAlmostEqual(width / height, ratio, delta=0.05)
            self.assertLessEqual(max(width, height), 136)

    def test_transparent_preview_shows_a_checkerboard_and_id_label(self):
        sheet = self.build_sheet([100001], {100001: png_bytes((16, 16), (0, 0, 0, 0))})
        # The transparent sprite leaves alternating checker colors visible.
        first = sheet.getpixel((13, 11))
        second = sheet.getpixel((21, 11))
        self.assertNotEqual(first, second)
        self.assertEqual(sheet.getpixel((29, 11)), first)
        self.assertEqual(first[3], 255)
        self.assertEqual(second[3], 255)
        label = sheet.crop((0, 150, 160, 184))
        self.assertGreater(len(label.getcolors(160 * 34) or []), 1)
        self.assertEqual(sheet.info["AssetIDs"], "100001")

    def test_standalone_sheet_rejects_more_than_48_images_before_download(self):
        ids = list(range(100001, 100050))
        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog(ids))),
            mock.patch.object(image_library, "_fetch_pack_sprite") as download,
        ):
            with self.assertRaises(image_library.LibrarySelectionError):
                image_library.build_contact_sheet(ids)
            download.assert_not_called()


class AssetPackRetryTests(unittest.TestCase):
    def read_manifest(self, payload):
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            return json.loads(archive.read("manifest.json"))

    def test_transient_download_failure_recovers_on_the_second_attempt(self):
        failures = (
            image_library.LibraryUpstreamError("temporary upstream error"),
            image_library.urllib.error.URLError("temporary connection error"),
            TimeoutError("temporary timeout"),
            OSError("temporary socket error"),
        )
        for failure in failures:
            calls = {100001: 0, 100002: 0}

            def fetch(asset_id):
                calls[asset_id] += 1
                if asset_id == 100001 and calls[asset_id] == 1:
                    raise failure
                return png_bytes()

            with (
                self.subTest(failure=type(failure).__name__),
                mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
                mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=fetch),
            ):
                manifest = self.read_manifest(image_library.build_asset_pack([100001, 100002]))
            self.assertEqual(calls, {100001: 2, 100002: 1})
            self.assertEqual(manifest["counts"], {"requested": 2, "ok": 2, "failed": 0})
            self.assertEqual(manifest["assets"][0]["status"], "ok")
            self.assertIsNone(manifest["assets"][0]["error"])

    def test_two_failed_attempts_remain_failed_in_the_manifest(self):
        def fetch(asset_id):
            if asset_id == 100001:
                raise TimeoutError("download timed out")
            return png_bytes()

        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
            mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=fetch) as download,
        ):
            manifest = self.read_manifest(image_library.build_asset_pack([100001, 100002]))
        self.assertEqual(download.call_args_list.count(mock.call(100001)), 2)
        self.assertEqual(download.call_args_list.count(mock.call(100002)), 1)
        self.assertEqual(manifest["counts"], {"requested": 2, "ok": 1, "failed": 1})
        self.assertEqual(manifest["assets"][0]["status"], "failed")
        self.assertIn("timed out", manifest["assets"][0]["error"])

    def test_missing_upstream_sprite_is_not_retried(self):
        def fetch(path, **kwargs):
            return image_library.UpstreamDocument(
                body=None if path == "sprite/100001.png" else png_bytes(),
                etag=None,
                missing=path == "sprite/100001.png",
            )

        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
            mock.patch.object(image_library, "fetch_document", side_effect=fetch) as download,
        ):
            manifest = self.read_manifest(image_library.build_asset_pack([100001, 100002]))
        self.assertEqual([call.args[0] for call in download.call_args_list].count("sprite/100001.png"), 1)
        self.assertEqual(download.call_count, 2)
        self.assertEqual(manifest["counts"], {"requested": 2, "ok": 1, "failed": 1})
        self.assertEqual(manifest["assets"][0]["status"], "failed")
        self.assertTrue(manifest["assets"][0]["error"])

    def test_size_error_stops_without_retrying(self):
        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
            mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=image_library.LibrarySizeError("too large")) as download,
        ):
            with self.assertRaises(image_library.LibrarySizeError):
                image_library.build_asset_pack([100001])
        download.assert_called_once_with(100001)

    def test_value_error_and_corrupt_png_are_not_retried(self):
        for result in (ValueError("invalid resource"), b"not a PNG"):
            with (
                self.subTest(result=type(result).__name__),
                mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
                mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=[result]) as download,
            ):
                manifest = self.read_manifest(image_library.build_asset_pack([100001]))
            download.assert_called_once_with(100001)
            self.assertEqual(manifest["counts"], {"requested": 1, "ok": 0, "failed": 1})
            self.assertEqual(manifest["assets"][0]["status"], "failed")
            self.assertTrue(manifest["assets"][0]["error"])


class AssetPackEndpointTests(unittest.TestCase):
    def test_zip_get_parses_ids_and_sets_download_headers(self):
        with mock.patch.object(image_library, "build_asset_pack", return_value=b"zip") as build:
            response = main.library_assets_zip_get(ids="100002,100001", all=False)
        build.assert_called_once_with([100002, 100001], all_assets=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")
        self.assertIn("attachment", response.headers["content-disposition"])
        self.assertIn(".zip", response.headers["content-disposition"])
        self.assertEqual(response.body, b"zip")

    def test_zip_post_and_contact_sheet_get_and_post_share_the_same_builders(self):
        with mock.patch.object(image_library, "build_asset_pack", return_value=b"zip") as build:
            response = main.library_assets_zip_post(main.AssetPackRequest.model_validate({"all": True}))
        build.assert_called_once_with(None, all_assets=True)
        self.assertEqual(response.status_code, 200)
        selection = main.ContactSheetRequest.model_validate({"ids": [100001, 100002]})
        sheet_png = png_bytes()
        with mock.patch.object(image_library, "build_contact_sheet", return_value=sheet_png) as build:
            get_response = main.library_contact_sheet_get(ids="100001,100002")
            post_response = main.library_contact_sheet_post(selection)
        self.assertEqual(build.call_args_list, [mock.call([100001, 100002]), mock.call([100001, 100002])])
        for response in (get_response, post_response):
            self.assertEqual(response.headers["content-type"], "image/png")
            self.assertIn("attachment", response.headers["content-disposition"])
            self.assertEqual(response.body, sheet_png)

    def test_sheet_get_and_post_headers_report_deduplicated_ids_and_final_failures(self):
        for method in ("get", "post"):
            def fetch(asset_id):
                if asset_id == 100002:
                    raise image_library.LibraryUpstreamError("still unavailable")
                return png_bytes()

            with (
                self.subTest(method=method),
                mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
                mock.patch.object(image_library, "_fetch_pack_sprite", side_effect=fetch) as download,
            ):
                if method == "get":
                    response = main.library_contact_sheet_get(ids="100002,100001,100002")
                else:
                    selection = main.ContactSheetRequest.model_validate({"ids": [100002, 100001, 100002]})
                    response = main.library_contact_sheet_post(selection)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["x-asset-ids"], "100002,100001")
            self.assertEqual(response.headers["x-failed-asset-ids"], "100002")
            self.assertEqual(download.call_args_list.count(mock.call(100002)), 2)
            self.assertEqual(download.call_args_list.count(mock.call(100001)), 1)
            self.assertEqual(read_png(response.body).info["FailedAssetIDs"], "100002")

    def test_all_successful_sheet_has_an_empty_failed_ids_header(self):
        for method in ("get", "post"):
            with (
                self.subTest(method=method),
                mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
                mock.patch.object(image_library, "_fetch_pack_sprite", return_value=png_bytes()),
            ):
                if method == "get":
                    response = main.library_contact_sheet_get(ids="100001,100002")
                else:
                    selection = main.ContactSheetRequest.model_validate({"ids": [100001, 100002]})
                    response = main.library_contact_sheet_post(selection)
            self.assertEqual(response.headers["x-asset-ids"], "100001,100002")
            self.assertEqual(response.headers["x-failed-asset-ids"], "")

    def test_sheet_header_reading_does_not_decode_the_image_pixels(self):
        with (
            mock.patch.object(image_library, "get_catalog_bundle", return_value=catalog_bundle(make_catalog())),
            mock.patch.object(image_library, "_fetch_pack_sprite", return_value=png_bytes()),
        ):
            payload = image_library.build_contact_sheet([100001])
        with (
            mock.patch.object(image_library, "build_contact_sheet", return_value=payload),
            mock.patch.object(Image.Image, "load", side_effect=AssertionError("headers must not decode pixels")),
        ):
            response = main.library_contact_sheet_get(ids="100001")
        self.assertEqual(response.headers["x-asset-ids"], "100001")
        self.assertEqual(response.headers["x-failed-asset-ids"], "")

    def test_post_models_reject_boolean_and_string_ids(self):
        for model in (main.AssetPackRequest, main.ContactSheetRequest):
            for ids in ([True], [False], ["100001"], [100001.0]):
                with self.subTest(model=model.__name__, ids=ids), self.assertRaises(ValidationError):
                    model.model_validate({"ids": ids})

    def test_all_selection_requires_a_real_boolean(self):
        for value in ("true", 1, 0):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                main.AssetPackRequest.model_validate({"all": value})

    def test_get_rejects_malformed_id_lists(self):
        for ids in ("", "true", "10000", "100001.0", "100001,,100002", "../100001"):
            with self.subTest(ids=ids), self.assertRaises(HTTPException) as error:
                main.library_assets_zip_get(ids=ids, all=False)
            self.assertEqual(error.exception.status_code, 400)

    def test_routes_translate_selection_size_and_upstream_errors(self):
        failures = (
            (image_library.LibrarySelectionError, 400),
            (image_library.LibrarySizeError, 413),
            (image_library.LibraryUpstreamError, 502),
        )
        for builder, route in (
            ("build_asset_pack", lambda: main.library_assets_zip_get(ids="100001", all=False)),
            ("build_contact_sheet", lambda: main.library_contact_sheet_get(ids="100001")),
        ):
            for exception, status in failures:
                with (
                    self.subTest(builder=builder, exception=exception.__name__),
                    mock.patch.object(image_library, builder, side_effect=exception("test failure")),
                    self.assertRaises(HTTPException) as error,
                ):
                    route()
                self.assertEqual(error.exception.status_code, status)


if __name__ == "__main__":
    unittest.main()
