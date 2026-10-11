import io
import json
import os
import re
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image
from app import lua_scene
from app.main import (
    ExportRequest, SceneDocumentModel, convert_scene_to_gia_bytes, export_lua,
    get_element_bounds, normalize_scene, parse_css_scene, parse_json_scene,
    parse_lua_scene, parse_svg_scene, scene_to_css, scene_to_gia_document,
    scene_to_png_bytes, scene_to_svg,
)


def scene(kind="triangle", **extra):
    return normalize_scene(SceneDocumentModel.model_validate({
        "canvas": {"width": 240, "height": 160},
        "elements": [{"id": "test", "type": kind, "x": 120, "y": 80,
                      "width": 100, "height": 60, "color": "#ff0000", **extra}],
    }))


def fields(data):
    """Independent protobuf reader: do not test encoder with its own decoder."""
    offset = 0
    def varint():
        nonlocal offset
        result, shift = 0, 0
        while True:
            byte = data[offset]
            offset += 1
            result |= (byte & 127) << shift
            if byte < 128:
                return result
            shift += 7
    while offset < len(data):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            value = varint()
        else:
            length = varint() if wire == 2 else 4 if wire == 5 else 8
            value = data[offset:offset + length]
            offset += length
        yield number, wire, value


class RotationXYTests(unittest.TestCase):
    def test_zero_defaults_and_json_library_preservation(self):
        self.assertEqual(scene().elements[0].rotationX, 0)
        source = scene(rotationX=420, rotationY=-180, rotation=25)
        # Validate saved library through the public model/import path.
        raw = source.model_dump()
        raw["library"]["savedItems"] = [{"id": "saved", "name": "saved", "element": raw["elements"][0]}]
        restored = parse_json_scene(json.dumps(raw))
        self.assertEqual(restored.elements[0].rotationX, 60)
        self.assertEqual(restored.library.savedItems[0].element.rotationY, -180)

    def test_css_svg_preserve_axes_including_edge_on_and_flips(self):
        for kind in ("triangle", "rectangle", "ellipse", "five_point_star", "textbox", "image"):
            for angle in (0, 30, 60, 90, 120, 180):
                source = scene(kind, rotationX=angle, rotationY=30, rotation=-15,
                               **({"imageAssetId": 106001, "imageType": "basic"} if kind == "image" else {}))
                for encode, decode in ((scene_to_css, parse_css_scene), (scene_to_svg, parse_svg_scene)):
                    restored = decode(encode(source))
                    item = restored.elements[0]
                    self.assertEqual((item.rotationX, item.rotationY, item.rotation), (angle, 30, -15))
                    self.assertEqual((item.x, item.y, item.width, item.height), (120, 80, 100, 60))

    def test_gia_writes_xy_in_all_four_platforms(self):
        # The float leaf bytes come from ROTXY2 device-accepted GIA. Combined
        # axes are a data preservation check, not mixed-axis device evidence.
        document = scene_to_gia_document(scene(rotationX=60, rotationY=90, rotation=60))
        data = convert_scene_to_gia_bytes(document)
        self.assertEqual(struct.unpack(">I", data[0:4])[0], len(data) - 4)
        current = [data[20:-4]]
        for number in (2, 19, 1, 505, 503, 13, 12, 501, 502, 508):
            current = [value for buf in current for n, wire, value in fields(buf) if n == number and wire == 2]
        vectors = [buf.hex() for buf in current if buf]
        self.assertEqual(vectors, ["0d00007042150000b4421d00007042"] * 4)

    def test_rotated_stretch_svg_rasterizes_once_and_preserves_editable_geometry(self):
        source = scene("image", imageAssetId=106001, imageType="stretch", rotationX=60, rotationY=180)
        sprite = Image.new("RGBA", (6, 6), (255, 255, 255, 255))
        meta = {"id": 106001, "width": 6, "height": 6, "stretchable": True,
                "border": {"left": 2, "right": 2, "top": 2, "bottom": 2}}
        with mock.patch("app.main.load_sprite_images", return_value={106001: sprite}) as loader:
            svg = scene_to_svg(source, {106001: meta})
        loader.assert_called_once()
        self.assertIn("data:image/png;base64,", svg)
        self.assertIn('transform="matrix(-1 0 0 0.5 240 40)"', svg)
        restored = parse_svg_scene(svg).elements[0]
        self.assertEqual((restored.imageType, restored.width, restored.height, restored.rotationX, restored.rotationY),
                         ("stretch", 100, 60, 60, 180))

    def test_lua_contains_real_xy_writes_and_edits_invalidate_snapshot(self):
        for kind in ("triangle", "textbox", "prefab", "image"):
            source = scene(kind, rotationX=120, rotationY=30, rotation=60,
                           **({"prefabId": 1} if kind == "prefab" else {}),
                           **({"imageAssetId": 106001, "imageType": "basic"} if kind == "image" else {}))
            with mock.patch("app.main.load_image_metas", return_value={}):
                script = export_lua(ExportRequest(scene=source)).body.decode()
            self.assertEqual(parse_lua_scene(script).elements, source.elements)
            bare = re.sub(r"(?m)^-- MILIASTRA_EDITOR_SCENE_V1 .*$", "", script)
            item = parse_lua_scene(bare).elements[0]
            self.assertEqual((item.rotationX, item.rotationY, item.rotation), (120, 30, 60))
            if kind != "textbox":
                self.assertIn("image:SetLocalRotation(ROTATIONS[index][1], ROTATIONS[index][2], item[14])", script)
                changed = script.replace("local ROTATIONS = {{120.0,30.0}}", "local ROTATIONS = {{60.0,30.0}}")
                self.assertNotEqual(changed, script)
                self.assertEqual(parse_lua_scene(changed).elements[0].rotationX, 60)
                with self.assertRaises(ValueError):
                    lua_scene.loads(script.replace("local ROTATIONS = {{120.0,30.0}}", "local ROTATIONS = {}"))
            else:
                self.assertIn("text:SetLocalRotation(item.rotationX or 0, item.rotationY or 0, item.rotation)", script)

    def test_png_geometry_and_back_faces_with_asymmetric_sprite(self):
        sprite = Image.new("RGBA", (100, 60), (0, 0, 255, 255))
        for x in range(10, 30):
            for y in range(5, 15):
                sprite.putpixel((x, y), (255, 0, 0, 255))
        for axis in ("rotationX", "rotationY"):
            for angle, ratio in ((0, 1), (60, .5), (90, 0), (120, -.5), (180, -1)):
                source = scene("image", imageAssetId=106001, imageType="basic", **{axis: angle})
                with mock.patch("app.main.load_sprite_images", return_value={106001: sprite}):
                    image = Image.open(io.BytesIO(scene_to_png_bytes(source)))
                if angle == 90:
                    self.assertIsNone(image.getchannel("A").getbbox())
                    continue
                x = round(120 - 30 * (ratio if axis == "rotationY" else 1))
                y = round(80 - 20 * (ratio if axis == "rotationX" else 1))
                self.assertEqual(image.getpixel((x, y)), (255, 0, 0, 255))
                bounds = get_element_bounds(source.elements[0])
                self.assertAlmostEqual(bounds[2] - bounds[0], 100 * (abs(ratio) if axis == "rotationY" else 1))
                self.assertAlmostEqual(bounds[3] - bounds[1], 60 * (abs(ratio) if axis == "rotationX" else 1))
        for kind in ("triangle", "rectangle", "ellipse", "ring", "textbox"):
            image = Image.open(io.BytesIO(scene_to_png_bytes(scene(kind, rotationX=90))))
            self.assertIsNone(image.getchannel("A").getbbox(), kind)

    @unittest.skipUnless(os.environ.get("FENGARI_MODULE_PATH"), "set FENGARI_MODULE_PATH to enable Lua VM execution")
    def test_exported_lua_executes_xyz_for_images_prefabs_and_text(self):
        source = scene(rotationX=120, rotationY=30, rotation=60)
        for i, kind in enumerate(("rectangle", "textbox", "prefab", "image"), 1):
            extra = {"prefabId": 1} if kind == "prefab" else {"imageAssetId": 106001, "imageType": "basic"} if kind == "image" else {}
            item = scene(kind, rotationX=60, rotationY=180, rotation=-30, **extra).elements[0]
            source.elements.append(item.model_copy(update={"id": str(i), "zIndex": i}))
        with mock.patch("app.main.load_image_metas", return_value={}):
            script = export_lua(ExportRequest(scene=source)).body
        with tempfile.TemporaryDirectory(prefix="rotation-xy-") as directory:
            script_path, scene_path = Path(directory) / "probe.lua", Path(directory) / "scene.json"
            script_path.write_bytes(script)
            scene_path.write_text(source.model_dump_json(), encoding="utf-8")
            result = subprocess.run(["node", str(Path(__file__).with_name("check_textbox_lua.cjs")),
                                     os.environ["FENGARI_MODULE_PATH"], str(script_path), str(scene_path)],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
