import io
import json
import unittest
import urllib.error
from unittest import mock

from PIL import Image

from app.main import (
    ExportRequest,
    ImportRequest,
    SceneDocumentModel,
    export_css,
    export_json,
    export_lua,
    export_png,
    export_svg,
    fetch_sprite_bytes,
    import_scene,
    normalize_scene,
    parse_css_scene,
    parse_svg_scene,
    scene_to_gia_document,
)


def make_sprite_bytes(size: int = 4, color=(255, 0, 0, 255)) -> bytes:
    sprite = Image.new("RGBA", (size, size), color)
    buffer = io.BytesIO()
    sprite.save(buffer, format="PNG")
    return buffer.getvalue()


def image_element(**overrides) -> dict:
    element = {
        "id": "sprite-1",
        "name": "底板",
        "type": "image",
        "x": 120.0,
        "y": 90.0,
        "width": 64.0,
        "height": 32.0,
        "rotation": 0.0,
        "color": "#ffffff",
        "opacity": 1.0,
        "zIndex": 1,
        "isBackground": False,
        "imageAssetId": 106001,
        "imageTint": False,
    }
    element.update(overrides)
    return element


def scene_with(elements: list[dict]) -> SceneDocumentModel:
    return normalize_scene(
        SceneDocumentModel.model_validate(
            {
                "canvas": {"width": 300, "height": 300, "background": "#ffffff"},
                "elements": elements,
                "meta": {"sourceType": "editor"},
            }
        )
    )


class NormalizeTests(unittest.TestCase):
    def test_image_element_keeps_asset_id_and_tint(self):
        scene = scene_with([image_element(imageTint=True, color="#22cc88")])
        element = scene.elements[0]
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertTrue(element.imageTint)
        self.assertEqual(element.color, "#22cc88")

    def test_image_without_asset_id_degrades_to_rectangle(self):
        scene = scene_with([image_element(imageAssetId=None)])
        self.assertEqual(scene.elements[0].type, "rectangle")
        self.assertIsNone(scene.elements[0].imageAssetId)

    def test_non_image_elements_drop_asset_fields(self):
        scene = scene_with([image_element(type="rectangle", imageAssetId=106001, imageTint=True)])
        self.assertIsNone(scene.elements[0].imageAssetId)
        self.assertFalse(scene.elements[0].imageTint)


class JsonRoundTripTests(unittest.TestCase):
    def test_json_round_trip_preserves_asset(self):
        source = scene_with([image_element(imageTint=True, color="#3366ff", rotation=-15)])
        exported = export_json(ExportRequest(scene=source)).body.decode()
        result = import_scene(ImportRequest(sourceType="json", content=exported))

        element = result.scene.elements[0]
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertTrue(element.imageTint)
        self.assertEqual(element.color, "#3366ff")
        self.assertAlmostEqual(element.rotation, -15)


class CssRoundTripTests(unittest.TestCase):
    def test_css_export_declares_asset_and_sprite_url(self):
        css = export_css(ExportRequest(scene=scene_with([image_element(imageTint=True, color="#ff8800")]))).body.decode()
        self.assertIn("-miliastra-image: 106001;", css)
        self.assertIn("-miliastra-image-tint: true;", css)
        self.assertIn("-miliastra-type: image;", css)
        self.assertIn("background-image: url(https://oss.070077.xyz/images/sprite/106001.png);", css)
        self.assertIn("background-color: #ff8800;", css)

    def test_css_round_trip_preserves_asset(self):
        source = scene_with([image_element(imageTint=True, color="#ff8800", rotation=30)])
        css = export_css(ExportRequest(scene=source)).body.decode()
        result = parse_css_scene(css)

        element = result.elements[0]
        self.assertEqual(len(result.elements), 1)
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertTrue(element.imageTint)
        self.assertEqual(element.color, "#ff8800")
        self.assertAlmostEqual(element.x, 120.0, places=2)
        self.assertAlmostEqual(element.y, 90.0, places=2)
        self.assertAlmostEqual(element.width, 64.0, places=2)
        self.assertAlmostEqual(element.rotation, 30.0, places=2)

    def test_plain_color_sprite_is_not_tinted(self):
        css = export_css(ExportRequest(scene=scene_with([image_element(color="#ff0000")]))).body.decode()
        self.assertIn("-miliastra-image-tint: false;", css)
        self.assertIn("background-color: #ffffff;", css)

        result = parse_css_scene(css)
        self.assertFalse(result.elements[0].imageTint)


class SvgRoundTripTests(unittest.TestCase):
    def test_svg_export_embeds_sprite_reference(self):
        svg = export_svg(ExportRequest(scene=scene_with([image_element()]))).body.decode()
        self.assertIn('data-miliastra-image="106001"', svg)
        self.assertIn('href="https://oss.070077.xyz/images/sprite/106001.png"', svg)
        self.assertIn('preserveAspectRatio="xMidYMid meet"', svg)

    def test_svg_round_trip_preserves_asset_and_geometry(self):
        source = scene_with([image_element(rotation=25)])
        svg = export_svg(ExportRequest(scene=source)).body.decode()
        result = parse_svg_scene(svg)

        # 导出会带上背景 rect，取其中的 image 图元来比对
        element = next(item for item in result.elements if item.type == "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertAlmostEqual(element.x, 120.0, places=2)
        self.assertAlmostEqual(element.y, 90.0, places=2)
        self.assertAlmostEqual(element.width, 64.0, places=2)
        self.assertAlmostEqual(element.rotation, 25.0, places=2)

    def test_svg_import_accepts_plain_href_without_data_attribute(self):
        svg = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">'
            '<image href="https://oss.070077.xyz/images/sprite/107001.png" x="10" y="20" width="30" height="40" />'
            "</svg>"
        )
        element = parse_svg_scene(svg).elements[0]
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 107001)
        self.assertEqual((element.x, element.y), (25.0, 40.0))

    def test_svg_warns_about_tinting(self):
        svg = export_svg(ExportRequest(scene=scene_with([image_element(imageTint=True)]))).body.decode()
        self.assertIn("Miliastra-Warning", svg)
        self.assertIn("染色", svg)


class GiaTests(unittest.TestCase):
    def test_gia_uses_element_asset_id(self):
        document = scene_to_gia_document(scene_with([image_element()]))
        payload = document["elements"][0]
        self.assertEqual(payload["image_asset_ref"], 106001)
        self.assertEqual(payload["size"], {"width": 64.0, "height": 32.0})

    def test_color_sprite_exports_neutral_white(self):
        document = scene_to_gia_document(scene_with([image_element(color="#ff0000")]))
        packed = document["elements"][0]["packed_color"]
        # 0xFFFFFFFF：白色 + 不透明
        self.assertEqual(packed, 0xFFFFFFFF)

    def test_mono_sprite_exports_tint_color(self):
        document = scene_to_gia_document(scene_with([image_element(imageTint=True, color="#336699")]))
        packed = document["elements"][0]["packed_color"]
        self.assertEqual(packed, 0xFF336699)


class LuaRoundTripTests(unittest.TestCase):
    def test_lua_export_and_import_preserve_image_element(self):
        source = scene_with([image_element(imageTint=True, color="#336699", rotation=12)])
        exported = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertIn("MILIASTRA_EDITOR_SCENE_V1", exported)

        result = import_scene(ImportRequest(sourceType="lua", content=exported))
        element = result.scene.elements[0]
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertTrue(element.imageTint)
        self.assertAlmostEqual(element.x, 120.0, places=2)
        self.assertAlmostEqual(element.y, 90.0, places=2)

    def test_lua_geometry_without_metadata_rebuilds_image_element(self):
        source = scene_with([image_element()])
        exported = export_lua(ExportRequest(scene=source)).body.decode()
        geometry_only = exported.split("-- 编辑器回导数据")[0]

        result = import_scene(ImportRequest(sourceType="lua", content=geometry_only))
        element = result.scene.elements[0]
        self.assertEqual(element.type, "image")
        self.assertEqual(element.imageAssetId, 106001)
        self.assertFalse(element.imageTint)


class PngTests(unittest.TestCase):
    def test_tinted_sprite_is_painted_with_element_color(self):
        source = scene_with([image_element(imageTint=True, color="#00ff00", width=40, height=40)])
        with mock.patch("app.main.fetch_sprite_bytes", return_value=make_sprite_bytes()):
            response = export_png(ExportRequest(scene=source))

        image = Image.open(io.BytesIO(response.body)).convert("RGBA")
        # 图元中心 (120, 90)，40×40 的贴图应完整覆盖其周围
        self.assertEqual(image.getpixel((120, 90)), (0, 255, 0, 255))

    def test_color_sprite_keeps_original_pixels(self):
        source = scene_with([image_element(width=40, height=40)])
        with mock.patch("app.main.fetch_sprite_bytes", return_value=make_sprite_bytes(color=(12, 34, 56, 255))):
            response = export_png(ExportRequest(scene=source))

        image = Image.open(io.BytesIO(response.body)).convert("RGBA")
        self.assertEqual(image.getpixel((120, 90)), (12, 34, 56, 255))

    def test_sprite_download_failure_still_exports_with_warning(self):
        source = scene_with([image_element(width=40, height=40)])
        with mock.patch("app.main.fetch_sprite_bytes", side_effect=urllib.error.URLError("offline")):
            response = export_png(ExportRequest(scene=source))

        image = Image.open(io.BytesIO(response.body))
        self.assertEqual(image.getpixel((120, 90)), (255, 255, 255, 255))
        self.assertIn("106001", image.text.get("Warning", ""))

    def test_repeated_asset_is_downloaded_once_and_pasted_twice(self):
        source = scene_with(
            [
                image_element(width=40, height=40),
                image_element(id="sprite-2", x=60, y=60, width=20, height=20),
            ]
        )
        fetch = mock.Mock(return_value=make_sprite_bytes(color=(10, 200, 30, 255)))
        with mock.patch("app.main.fetch_sprite_bytes", side_effect=fetch):
            response = export_png(ExportRequest(scene=source))

        self.assertEqual(fetch.call_count, 1)
        image = Image.open(io.BytesIO(response.body)).convert("RGBA")
        self.assertEqual(image.getpixel((120, 90)), (10, 200, 30, 255))
        self.assertEqual(image.getpixel((60, 60)), (10, 200, 30, 255))

    def test_fetch_sprite_bytes_sets_user_agent_and_sprite_url(self):
        captured: dict = {}

        class FakeResponse:
            headers = {}

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return b"png-bytes"

        def fake_urlopen(request, timeout=None):
            captured["url"] = request.full_url
            captured["headers"] = request.headers
            return FakeResponse()

        with mock.patch("app.image_library.urllib.request.urlopen", side_effect=fake_urlopen):
            self.assertEqual(fetch_sprite_bytes(107001), b"png-bytes")

        self.assertEqual(captured["url"], "https://oss.070077.xyz/images/sprite/107001.png")
        self.assertIn("User-agent", captured["headers"])


if __name__ == "__main__":
    unittest.main()
