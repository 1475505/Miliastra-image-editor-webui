import base64
import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError
from app import lua_scene
from app.lua_mask import LuaMaskModel
from app.main import (ExportRequest, SceneDocumentModel, export_lua, normalize_scene,
                      parse_json_scene, parse_lua_scene, scene_to_css, scene_to_svg,
                      scene_to_png_bytes, scene_to_gia_document)


def scene():
    mask = dict(enabled=True, offsetX=12, offsetY=-7, width=64, height=0,
                enableSoftEdge=True, softEdgeMode="Percentage", softEdgeWidthX=13.5,
                softEdgeWidthY=7.25, horizontalSoftRange=82, verticalSoftRange=71,
                reverseMaskArea=True)
    elements = [dict(id="shape", name="Shape", type="triangle", x=80, y=70, width=90, height=60,
                     rotation=30, zIndex=0, luaMask=mask),
                dict(id="text", name="Text", type="textbox", x=180, y=110, width=120, height=48,
                     rotation=-15, rotationX=30, zIndex=1,
                     textBox=dict(text="MASK", autoSize=False, fontSize=25, anchorType="custom",
                                  anchorMinX=.2, anchorMaxX=.6, anchorMinY=.3, anchorMaxY=.5,
                                  pivotX=.25, pivotY=.7, scaleX=1.2, scaleY=.8),
                     luaMask={**mask, "width": None, "height": None, "softEdgeMode": "Pixel"}),
                dict(id="plain", name="Plain", type="rectangle", x=30, y=30, width=20, height=20, zIndex=2)]
    return normalize_scene(SceneDocumentModel.model_validate({
        "canvas": {"width": 320, "height": 240}, "elements": elements,
        "library": {"savedItems": [{"id": "saved", "name": "masked", "element": elements[0]}]},
    }))


class LuaMaskTests(unittest.TestCase):
    def test_json_lua_library_and_literal_roundtrip(self):
        source = scene()
        imported = parse_json_scene(source.model_dump_json())
        self.assertEqual(imported.elements, source.elements)
        self.assertEqual(imported.library, source.library)
        # Both the complete scene and simplified import retain the mask.
        simple = parse_json_scene(json.dumps({"elements": [source.elements[0].model_dump()]}))
        self.assertEqual(simple.elements[0].luaMask, source.elements[0].luaMask)
        script = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertEqual(parse_lua_scene(script).elements, source.elements)
        bare = script.split(lua_scene.METADATA_PREFIX)[0]
        restored = parse_lua_scene(bare)
        self.assertEqual(restored.elements[0].luaMask, source.elements[0].luaMask)
        self.assertEqual(restored.elements[1].luaMask, source.elements[1].luaMask)
        self.assertIn("game.InstantiateClientUIControl(TEXTBOX_PREFAB_ID, frame and frame.control or parent)", script)
        self.assertIn("Enum.ImageMaskSoftEdgeMode[entry.softEdgeMode]", script)
        for kind, extra in (("rectangle", {}), ("image", {"imageAssetId": 100001}), ("prefab", {"prefabId": 1})):
            item = source.elements[0].model_copy(update={"type": kind, **extra})
            only_image = normalize_scene(source.model_copy(update={"elements": [item]}))
            drawing = export_lua(ExportRequest(scene=only_image)).body.decode()
            self.assertEqual(parse_lua_scene(drawing).elements, only_image.elements)

    def test_mask_edit_invalidates_metadata_and_invalid_values_are_rejected(self):
        script = export_lua(ExportRequest(scene=scene())).body.decode()
        changed = script.replace('["softEdgeWidthX"]=13.5', '["softEdgeWidthX"]=27.0', 1)
        imported = parse_lua_scene(changed)
        self.assertEqual(imported.elements[0].luaMask.softEdgeWidthX, 27)
        self.assertTrue(any("edited" in warning for warning in imported.meta.warnings))
        for patch in ({"width": -1}, {"offsetX": float("inf")}, {"softEdgeWidthX": True},
                      {"enabled": "false"}, {"softEdgeMode": "pixel"}, {"unknown": 1}):
            with self.subTest(patch=patch), self.assertRaises(ValidationError):
                LuaMaskModel.model_validate(patch)
        for changed in (script.replace('local IMAGE_MASKS = ', 'local IMAGE_MASKS = {} -- ', 1),
                        script.replace('["softEdgeMode"]="Percentage"', '["softEdgeMode"]="bad"'),
                        script.replace('["softEdgeWidthX"]=13.5', '["softEdgeWidthX"]=os.time()'),
                        script + '\nlocal TEXT_MASKS = {}'):
            with self.assertRaises(HTTPException):
                parse_lua_scene(changed)

    def test_custom_mask_image_is_preserved_in_json_library_and_lua(self):
        source = scene()
        source.elements[0].luaMask.imageId = 100002
        source.elements[1].luaMask.imageId = 107075
        source.library.savedItems[0].element.luaMask.imageId = 100003
        restored = parse_json_scene(source.model_dump_json())
        self.assertEqual(restored.elements[0].luaMask.imageId, 100002)
        self.assertEqual(restored.elements[1].luaMask.imageId, 107075)
        self.assertEqual(restored.library.savedItems[0].element.luaMask.imageId, 100003)
        script = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertIn('mask:SetImage(Enum.ImageSource.StaticReference, imageId)', script)
        self.assertIn('mask.imageId ~= imageId', script)
        self.assertEqual(parse_lua_scene(script).elements, source.elements)
        bare = parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0])
        self.assertEqual([e.luaMask.imageId for e in bare.elements[:2]], [100002, 107075])
        changed = script.replace('["imageId"]=100002', '["imageId"]=100006', 1)
        edited = parse_lua_scene(changed)
        self.assertEqual(edited.elements[0].luaMask.imageId, 100006)
        self.assertTrue(any('edited' in warning for warning in edited.meta.warnings))

    def test_mask_image_type_roundtrip_is_independent_and_edits_invalidate_metadata(self):
        source = scene()
        source.elements[0].luaMask.imageType = 'basic'
        source.elements[1].luaMask.imageId = 106030
        source.elements[1].luaMask.imageType = 'stretch'
        source.library.savedItems[0].element.luaMask.imageType = 'stretch'
        restored = parse_json_scene(source.model_dump_json())
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        simple = parse_json_scene(json.dumps({'elements': [source.elements[1].model_dump()]}))
        self.assertEqual(simple.elements[0].luaMask.imageType, 'stretch')
        script = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertEqual(parse_lua_scene(script).elements, source.elements)
        self.assertEqual(parse_lua_scene(script).library, source.library)
        bare = parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0])
        self.assertEqual([e.luaMask.imageType for e in bare.elements[:2]], ['basic', 'stretch'])
        changed = script.replace('["imageType"]="basic"', '["imageType"]="stretch"', 1)
        edited = parse_lua_scene(changed)
        self.assertEqual(edited.elements[0].luaMask.imageType, 'stretch')
        self.assertEqual(edited.elements[0].width, source.elements[0].width)
        self.assertEqual(edited.elements[1].luaMask.imageId, 106030)
        self.assertTrue(any('edited' in warning for warning in edited.meta.warnings))

    def test_mask_image_type_defaults_leave_native_type_and_reject_invalid_values(self):
        self.assertIsNone(LuaMaskModel().imageType)
        self.assertIsNone(LuaMaskModel(imageType=None).imageType)
        source = scene()
        script = export_lua(ExportRequest(scene=source)).body.decode()
        self.assertNotIn('imageType', lua_scene.read_drawing(script)['imageMasks'][0])
        self.assertIsNone(parse_lua_scene(script).elements[0].luaMask.imageType)
        self.assertIsNone(parse_lua_scene(script.split(lua_scene.METADATA_PREFIX)[0]).elements[0].luaMask.imageType)
        # Literal nil and omitted both represent no assignment, including the digest.
        explicit_nil = script.replace('["imageId"]=100001', '["imageId"]=100001,["imageType"]=nil', 1)
        self.assertEqual(parse_lua_scene(explicit_nil).elements, source.elements)
        for value in ('Basic', 'Stretch', 'auto', '', 1, True, []):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                LuaMaskModel.model_validate({'imageType': value})
        for value in ('"Basic"', '"bad"', 'true', '1', 'os.time()'):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                parse_lua_scene(script.replace('["imageId"]=100001', '["imageId"]=100001,["imageType"]=' + value, 1))

    def test_old_mask_lua_keeps_metadata_and_defaults_to_rectangle(self):
        source = scene()
        script = export_lua(ExportRequest(scene=source)).body.decode()
        body, payload = script.split(lua_scene.METADATA_PREFIX)
        body = re.sub(r'\["imageId"\]=100001,', '', body)
        # Reconstruct the pre-field hash independently; adding a default during
        # literal parsing would make this hash differ and discard ids/library.
        drawing = lua_scene.read_drawing(body)
        for key in ('imageMasks', 'textMasks'):
            for mask in drawing[key]:
                mask.pop('imageId', None)
                mask.pop('imageType', None)
        metadata = json.loads(base64.b64decode(payload))
        metadata['drawingHash'] = hashlib.sha256(json.dumps(drawing, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()
        for element in metadata['scene']['elements']:
            if element.get('luaMask'):
                element['luaMask'].pop('imageId', None)
                element['luaMask'].pop('imageType', None)
        for item in metadata['scene']['library']['savedItems']:
            item['element']['luaMask'].pop('imageId', None)
            item['element']['luaMask'].pop('imageType', None)
        legacy = body + lua_scene.METADATA_PREFIX + base64.b64encode(json.dumps(metadata).encode()).decode() + '\n'
        restored = parse_lua_scene(legacy)
        self.assertEqual(restored.elements, source.elements)
        self.assertEqual(restored.library, source.library)
        self.assertFalse(any('edited' in warning for warning in restored.meta.warnings))
        self.assertEqual(parse_lua_scene(body).elements[0].luaMask.imageId, 100001)

    def test_mask_image_id_validation(self):
        self.assertEqual(LuaMaskModel().imageId, 100001)
        self.assertEqual(LuaMaskModel(imageId=0x7fffffff).imageId, 0x7fffffff)
        script = export_lua(ExportRequest(scene=scene())).body.decode()
        for value in (0, -1, True, None, 100002.5, '100002', 0x80000000):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                LuaMaskModel.model_validate({'imageId': value})
        for value in ('0', '-1', 'true', '100002.5', '"100002"', '2147483648', 'os.time()'):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                parse_lua_scene(script.replace('["imageId"]=100001', '["imageId"]=' + value, 1))

    def test_lua_only_drawing_gate_and_disabled_settings(self):
        source = scene()
        for encode in (scene_to_css, scene_to_svg, scene_to_png_bytes, scene_to_gia_document):
            with self.subTest(encode=encode.__name__), self.assertRaises(HTTPException) as caught:
                encode(source)
            self.assertIn("Lua", caught.exception.detail)
        for item in source.elements:
            if item.luaMask:
                item.luaMask.enabled = item.luaMask.enableSoftEdge = False
        self.assertTrue(scene_to_gia_document(source)["elements"])
        self.assertTrue(scene_to_png_bytes(source).startswith(b"\x89PNG"))
        # A feather-only selection still needs a parent mask and an image template.
        text = source.elements[1]
        text.luaMask.enableSoftEdge = True
        text_only = source.model_copy(update={"elements": [text]})
        script = export_lua(ExportRequest(scene=text_only)).body.decode()
        self.assertIn('if true and (type(IMAGE_PREFAB_ID)', script)
        self.assertEqual(parse_lua_scene(script).elements[0].luaMask, text.luaMask)

    @unittest.skipUnless(os.environ.get("FENGARI_MODULE_PATH"), "set FENGARI_MODULE_PATH for the Lua VM")
    def test_exported_lua_executes_parenting_geometry_raw_values_and_cleanup(self):
        mixed = scene()
        mixed.elements[0].luaMask.imageId = 100002
        mixed.elements[0].luaMask.imageType = 'basic'
        mixed.elements[1].luaMask.imageId = 106030
        mixed.elements[1].luaMask.imageType = 'stretch'
        mixed.elements.append(mixed.elements[0].model_copy(update={"id": "prefab", "type": "prefab", "prefabId": 1, "zIndex": 3}))
        mixed.elements.append(mixed.elements[0].model_copy(update={"id": "sprite", "type": "image", "imageAssetId": 106030, "imageType": "stretch", "zIndex": 4}))
        for source in (scene(), scene().model_copy(update={"elements": [scene().elements[1]]}), normalize_scene(mixed)):
            with tempfile.TemporaryDirectory(prefix="lua-mask-") as directory:
                script_path, scene_path = Path(directory) / "scene.lua", Path(directory) / "scene.json"
                script_path.write_bytes(export_lua(ExportRequest(scene=source)).body)
                scene_path.write_text(source.model_dump_json(), encoding="utf-8")
                result = subprocess.run(["node", str(Path(__file__).with_name("check_textbox_lua.cjs")),
                                         os.environ["FENGARI_MODULE_PATH"], str(script_path), str(scene_path)],
                                        capture_output=True, text=True, timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
