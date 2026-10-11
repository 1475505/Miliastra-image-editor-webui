import base64
import importlib.util
import io
import json
import re
import unittest
from unittest import mock

from fastapi import HTTPException
from PIL import Image
from pydantic import ValidationError

from app import image_library, lua_scene
from app.image_stretch import resize_sliced
from app.main import (
    GIA_PY_PATH, ExportRequest, ImportRequest, SceneDocumentModel, SceneElementModel,
    export_css, export_json, export_lua, export_png, export_svg, load_stretch_metas,
    import_scene, normalize_scene, parse_css_scene, parse_json_scene, parse_lua_scene,
    parse_svg_scene, render_sprite, resolve_scene_image_types, scene_to_gia_document,
)


COLORS = [
    (255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255),
    (255, 255, 0, 255), (255, 0, 255, 255), (0, 255, 255, 255),
    (100, 20, 10, 255), (10, 100, 20, 255), (20, 10, 100, 255),
]
META = dict(id=106030, width=6, height=6, stretchable=True,
            border=dict(left=2, right=2, top=2, bottom=2), pixelsToUnits=999)


def sprite():
    image = Image.new("RGBA", (6, 6))
    for y in range(6):
        for x in range(6):
            image.putpixel((x, y), COLORS[(y // 2) * 3 + x // 2])
    return image


def png_bytes(image):
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def scene(mode="stretch", **overrides):
    element = dict(id="image", name="九切片", type="image", imageAssetId=106030,
                   imageType=mode, width=12, height=10, x=120, y=90,
                   color="#ffffff", opacity=1, zIndex=0)
    element.update(overrides)
    return normalize_scene(SceneDocumentModel.model_validate({
        "canvas": {"width": 300, "height": 300}, "elements": [element],
        "library": {"savedItems": [{"id": "saved", "name": "收藏图片", "element": element}]},
    }))


def metadata_result():
    return image_library.BundleResult(json.dumps(META).encode(), '"fixture"', False)


class SlicedSamplingTests(unittest.TestCase):
    def test_nine_slice_preserves_corners_and_stretches_edges_and_center(self):
        image = resize_sliced(sprite(), (12, 10), META)
        for point, color in [((1, 1), COLORS[0]), ((10, 1), COLORS[2]),
                             ((1, 8), COLORS[6]), ((10, 8), COLORS[8]),
                             ((5, 1), COLORS[1]), ((1, 5), COLORS[3]),
                             ((5, 5), COLORS[4])]:
            with self.subTest(point=point):
                self.assertEqual(image.getpixel(point), color)
        # pixelsToUnits is deliberately not one; borders still stay at two scene units.
        self.assertEqual(image.getpixel((1, 1)), sprite().getpixel((1, 1)))

    def test_zero_center_span_repeats_seam_instead_of_leaving_holes(self):
        source = Image.new("RGBA", (4, 4))
        quadrants = [COLORS[0], COLORS[1], COLORS[2], COLORS[3]]
        for y in range(4):
            for x in range(4):
                source.putpixel((x, y), quadrants[(y // 2) * 2 + x // 2])
        meta = {**META, "width": 4, "height": 4}
        image = resize_sliced(source, (12, 10), meta)
        self.assertEqual(image.getchannel("A").getextrema(), (255, 255))
        self.assertEqual(image.getpixel((0, 0)), quadrants[0])
        self.assertEqual(image.getpixel((11, 9)), quadrants[3])
        for x in range(2, 10):
            self.assertEqual(image.getpixel((x, 0)), (127, 127, 0, 255))
            for y in range(2, 8):
                self.assertEqual(image.getpixel((x, y)), (127, 127, 63, 255))

    def test_three_slice_with_no_vertical_border(self):
        source = Image.new("RGBA", (6, 4))
        for y in range(4):
            for x in range(6):
                source.putpixel((x, y), COLORS[x // 2])
        meta = {**META, "height": 4, "border": dict(left=2, right=2, top=0, bottom=0)}
        image = resize_sliced(source, (12, 10), meta)
        for y in range(10):
            self.assertEqual(image.getpixel((1, y)), COLORS[0])
            self.assertEqual(image.getpixel((5, y)), COLORS[1])
            self.assertEqual(image.getpixel((10, y)), COLORS[2])

    def test_small_control_shrinks_borders_without_overlap_or_holes(self):
        image = resize_sliced(sprite(), (3, 3), META)
        self.assertEqual(image.getchannel("A").getextrema(), (255, 255))
        self.assertEqual(image.getpixel((0, 0)), COLORS[0])
        self.assertEqual(image.getpixel((2, 0)), COLORS[2])
        self.assertEqual(image.getpixel((0, 2)), COLORS[6])
        self.assertEqual(image.getpixel((2, 2)), COLORS[8])

    def test_no_border_and_missing_metadata_use_whole_texture(self):
        source = sprite()
        basic = render_sprite(scene("basic").elements[0], source, META)
        for meta in (None, {**META, "stretchable": False}):
            self.assertEqual(render_sprite(scene().elements[0], source, meta).tobytes(), basic.tobytes())

    def test_tint_opacity_rotation_and_shared_source(self):
        source = Image.new("RGBA", (6, 6), (200, 100, 50, 255))
        original = source.tobytes()
        document = scene(imageTint=True, color="#80ff00", opacity=.5, rotation=90)
        with mock.patch("app.main.load_sprite_images", return_value={106030: source}), \
             mock.patch("app.main.load_image_metas", return_value={106030: META}):
            image = Image.open(io.BytesIO(export_png(ExportRequest(scene=document)).body)).convert("RGBA")
        self.assertEqual(image.getpixel((120, 90)), (100, 100, 0, 127))
        self.assertEqual(image.getchannel("A").getbbox(), (115, 84, 125, 96))
        self.assertEqual(source.tobytes(), original)


class ImageTypeRoundTripTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch("app.image_library.get_image_meta", side_effect=lambda _id: metadata_result())
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_defaults_and_invalid_modes(self):
        element = scene().elements[0].model_dump()
        element.pop("imageType")
        self.assertEqual(SceneElementModel.model_validate(element).imageType, "basic")
        non_image = scene().model_dump()
        non_image["elements"][0]["type"] = "rectangle"
        non_image["library"]["savedItems"][0]["element"]["type"] = "rectangle"
        normalized = normalize_scene(SceneDocumentModel.model_validate(non_image))
        self.assertEqual(normalized.elements[0].imageType, "basic")
        self.assertEqual(normalized.library.savedItems[0].element.imageType, "basic")
        for mode in ("slice", "Stretch", 1, True, None):
            with self.subTest(mode=mode), self.assertRaises(ValidationError):
                SceneElementModel.model_validate({**element, "imageType": mode})

    def test_json_and_saved_library_round_trip(self):
        for mode in ("basic", "stretch"):
            source = scene(mode)
            restored = parse_json_scene(export_json(ExportRequest(scene=source)).body.decode())
            self.assertEqual(restored.elements, source.elements)
            self.assertEqual(restored.library, source.library)

    def test_css_svg_preserve_mode_geometry_color_and_embed_rendered_slices(self):
        source = scene(imageTint=True, color="#80ff00", opacity=.5, rotation=17)
        with mock.patch("app.main.fetch_sprite_bytes", return_value=png_bytes(sprite())), \
             mock.patch("app.image_library.get_image_meta", side_effect=lambda _id: metadata_result()):
            for export, parse in ((export_css, parse_css_scene), (export_svg, parse_svg_scene)):
                with self.subTest(format=export.__name__):
                    content = export(ExportRequest(scene=source)).body.decode()
                    restored = next(item for item in parse(content).elements if item.type == "image")
                    for key in ("imageType", "imageAssetId", "imageTint", "color", "width", "height", "x", "y", "rotation", "opacity"):
                        self.assertEqual(getattr(restored, key), getattr(source.elements[0], key))
                    encoded = re.search(r'data:image/png;base64,([A-Za-z0-9+/=]+)', content).group(1)
                    image = Image.open(io.BytesIO(base64.b64decode(encoded))).convert("RGBA")
                    self.assertEqual(image.size, (12, 10))
                    self.assertEqual(image.getpixel((1, 1)), (128, 0, 0, 255))
                    self.assertNotIn("无法表现", content)

    def test_basic_visual_exports_do_not_download_sprite_or_metadata(self):
        with mock.patch("app.main.fetch_sprite_bytes", side_effect=AssertionError("unneeded sprite")), \
             mock.patch("app.image_library.get_image_meta", side_effect=AssertionError("unneeded metadata")):
            for export in (export_css, export_svg):
                self.assertIn("106030.png", export(ExportRequest(scene=scene("basic"))).body.decode())

    def test_lua_mixed_modes_and_saved_library(self):
        source = scene()
        source.elements = [
            SceneElementModel(id="bg", type="rectangle", x=100, y=100, width=80, height=60, isBackground=True, zIndex=9),
            source.elements[0],
            SceneElementModel(id="text", type="textbox", x=50, y=50, width=100, height=30, zIndex=1),
            scene("basic").elements[0].model_copy(update={"id": "basic", "zIndex": 2}),
        ]
        source = normalize_scene(source)
        content = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertEqual(lua_scene.read_drawing(content)["imageTypes"], ["stretch", "stretch", "basic"])
        restored = parse_lua_scene(content)
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        geometry = content.split(lua_scene.METADATA_PREFIX)[0]
        self.assertEqual([item.imageType for item in parse_lua_scene(geometry).elements if item.type == "image"], ["stretch", "basic"])
        edited = parse_lua_scene(content.replace('"basic"', '"stretch"'))
        self.assertEqual([item.imageType for item in edited.elements if item.type == "image"], ["stretch", "stretch"])
        self.assertTrue(any("edited" in warning for warning in edited.meta.warnings))

    def test_legacy_lua_without_type_table_retains_stretch(self):
        content = export_lua(ExportRequest(scene=scene("basic"))).body.decode().split(lua_scene.METADATA_PREFIX)[0]
        legacy = re.sub(r'(?m)^local IMAGE_TYPES = .*\n', '', content)
        self.assertEqual(parse_lua_scene(legacy).elements[0].imageType, "stretch")
        for table in ('{}', '{"invalid"}', '{1}', '{"basic","stretch"}'):
            with self.subTest(table=table), self.assertRaises(ValueError):
                lua_scene.read_drawing(re.sub(r'(?m)^local IMAGE_TYPES = .*$', 'local IMAGE_TYPES = ' + table, content))

    def test_material_gia_emits_inferred_flag_only_for_stretch(self):
        spec = importlib.util.spec_from_file_location("test_gia_stretch", GIA_PY_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def fields(data):
            reader = module.ProtoReader(data)
            result = {}
            while not reader.eof():
                tag, wire = reader.read_tag()
                result[tag] = reader.read_field(wire)
            return result

        settings = []
        for mode in ("basic", "stretch"):
            payload = scene_to_gia_document(scene(mode))["elements"][0]
            self.assertEqual(payload["image_type"], int(mode == "stretch"))
            raw = module._build_image_settings_data(payload["image_asset_ref"], payload["packed_color"], 123, payload["image_type"]).get_bytes()
            settings.append(fields(fields(fields(raw)[503])[31]))
        self.assertNotIn(5, settings[0])
        self.assertEqual(settings[1].pop(5), 1)
        self.assertEqual(settings[0], settings[1])
        # This verifies bytes, not the game's interpretation of the inferred field.


class StretchMetadataTests(unittest.TestCase):
    def test_defaults_follow_borders_for_elements_and_saved_items(self):
        raw = scene().model_dump()
        raw["elements"] = []
        for asset_id in (100001, 106030, 105222):
            item = {**raw["library"]["savedItems"][0]["element"], "id": str(asset_id), "imageAssetId": asset_id}
            item.pop("imageType")
            raw["elements"].append(item)
        raw["library"]["savedItems"][0]["element"].pop("imageType")
        metas = {asset_id: image_library.normalize_sprite_meta(str(asset_id), {
            "m_Rect": {"width": 90, "height": 90},
            "m_Border": dict.fromkeys("XYZW", 45 if asset_id == 106030 else 0)
        }) for asset_id in (100001, 106030, 105222)}
        with mock.patch("app.image_library.get_image_meta", side_effect=lambda asset_id:
                        image_library.BundleResult(json.dumps(metas[asset_id]).encode(), '"fixture"', False)) as fetch:
            document = import_scene(ImportRequest(sourceType="json", content=json.dumps(raw))).scene
        self.assertEqual([item.imageType for item in document.elements], ["basic", "stretch", "basic"])
        self.assertEqual(document.library.savedItems[0].element.imageType, "stretch")
        self.assertEqual(sorted(call.args[0] for call in fetch.call_args_list), [100001, 105222, 106030])

    def test_unsupported_stretch_becomes_basic_and_explicit_basic_is_preserved(self):
        flat = {**META, "border": dict(left=0, right=0, top=0, bottom=0)}
        with mock.patch("app.main.load_image_metas", return_value={106030: flat}):
            document, _ = resolve_scene_image_types(scene())
            self.assertEqual(document.elements[0].imageType, "basic")
            self.assertEqual(document.library.savedItems[0].element.imageType, "basic")
            exported = json.loads(export_json(ExportRequest(scene=scene())).body)
            self.assertEqual(exported["elements"][0]["imageType"], "basic")
        with mock.patch("app.image_library.get_image_meta", side_effect=AssertionError("Basic does not need metadata")):
            document, _ = resolve_scene_image_types(scene("basic"))
            self.assertEqual(document.elements[0].imageType, "basic")

    def test_omitted_types_survive_all_import_parsers_until_metadata_resolution(self):
        element = scene().elements[0].model_dump()
        element.pop("imageType")
        inputs = [
            ("json", json.dumps({"elements": [element]})),
            ("css", ".sprite { -miliastra-image: 106030; left: 120px; top: 90px; width: 90px; height: 90px; }"),
            ("svg", '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://oss.070077.xyz/images/sprite/106030.png" width="90" height="90"/></svg>')
        ]
        with mock.patch("app.image_library.get_image_meta", side_effect=lambda _id: metadata_result()):
            for source_type, content in inputs:
                with self.subTest(source_type=source_type):
                    self.assertEqual(import_scene(ImportRequest(sourceType=source_type, content=content)).scene.elements[0].imageType, "stretch")
        with mock.patch("app.image_library.get_image_meta", side_effect=image_library.LibraryNotFoundError):
            for source_type, content in inputs:
                self.assertEqual(import_scene(ImportRequest(sourceType=source_type, content=content)).scene.elements[0].imageType, "basic")

    def test_export_reuses_policy_metadata_for_slice_rendering(self):
        with mock.patch("app.image_library.get_image_meta", side_effect=lambda _id: metadata_result()) as fetch, \
             mock.patch("app.main.fetch_sprite_bytes", return_value=png_bytes(sprite())):
            for export in (export_css, export_svg, export_png):
                export(ExportRequest(scene=scene()))
        self.assertEqual(fetch.call_args_list, [mock.call(106030)] * 3)

    def test_metadata_requested_only_for_stretch_and_deduplicated_per_export(self):
        elements = scene().elements + [scene().elements[0].model_copy(update={"id": "copy"}),
                                       scene("basic").elements[0].model_copy(update={"imageAssetId": 106031})]
        with mock.patch("app.image_library.get_image_meta", side_effect=lambda _id: metadata_result()) as fetch:
            for _ in range(2):
                self.assertEqual(load_stretch_metas(elements), {106030: META})
            self.assertEqual(fetch.call_args_list, [mock.call(106030), mock.call(106030)])

    def test_missing_metadata_falls_back_but_upstream_failure_is_explicit(self):
        with mock.patch("app.image_library.get_image_meta", side_effect=image_library.LibraryNotFoundError):
            self.assertEqual(load_stretch_metas(scene().elements), {})
        with mock.patch("app.image_library.get_image_meta", side_effect=image_library.LibraryUpstreamError("offline")):
            with self.assertRaises(HTTPException) as failure:
                load_stretch_metas(scene().elements)
            self.assertEqual(failure.exception.status_code, 502)
            self.assertIn("106030", failure.exception.detail)


if __name__ == "__main__":
    unittest.main()
