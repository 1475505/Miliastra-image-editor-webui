import base64
import json
import re
import unittest
from unittest import mock

from fastapi import HTTPException
from pydantic import ValidationError

from app import lua_scene
from app.main import (
    ExportRequest, SceneDocumentModel, export_css, export_gia, export_json,
    export_lua, export_png, export_svg, normalize_scene, parse_json_scene, parse_lua_scene,
)


def prefab_scene(mixed=False):
    element = dict(id="p", name="测试元件", type="prefab", prefabId=20001003, prefabVariable="竹子元件",
                   x=153.25, y=109.75, width=256, height=128, rotation=-22.5, color="#abcdef", opacity=.4, zIndex=1)
    elements = [element]
    if mixed:
        elements = [dict(id="r", type="rectangle", x=100, y=80, width=90, height=60, zIndex=0), element,
                    dict(id="i", type="image", imageAssetId=106001, x=400, y=180, width=24, height=32, zIndex=2)]
    return normalize_scene(SceneDocumentModel.model_validate({"canvas": {"width": 720, "height": 480}, "elements": elements,
                "library": {"savedItems": [{"id": "saved-p", "name": "收藏元件", "element": element}]}}))


class PrefabElementTests(unittest.TestCase):
    def test_json_and_lua_round_trip_include_variable_and_saved_prefab(self):
        for mixed in (False, True):
            scene = prefab_scene(mixed)
            request = ExportRequest(scene=scene)
            restored_json = parse_json_scene(export_json(request).body.decode())
            self.assertEqual(restored_json.elements, scene.elements)
            self.assertEqual(restored_json.library, scene.library)
            content = export_lua(request).body.decode()
            restored = parse_lua_scene(content)
            self.assertEqual(restored.elements, scene.elements)
            self.assertEqual(restored.library, scene.library)
            self.assertIn('local PREFAB_IDS = {\n    ["竹子元件"] = 20001003,\n}', content)
            self.assertIn('local value = PREFAB_IDS[binding[3]]', content)
            self.assertIn('image:SetImage(Enum.ImageSource.Prefab, prefabValues[index])', content)
            self.assertNotIn('script:GetParam', content)
            self.assertNotIn('Enum.ParamType', content)
            drawing = lua_scene.read_drawing(content)
            self.assertEqual(drawing['prefabIds'], {'竹子元件': 20001003})
            self.assertEqual(drawing['prefabBindings'], [[2 if mixed else 1, 20001003, '竹子元件']])
            self.assertEqual([row[0] for row in drawing['rows']], [100001, 0, 106001] if mixed else [0])

    def test_drawing_geometry_and_configuration_edits_without_metadata(self):
        scene = prefab_scene(True)
        content = export_lua(ExportRequest(scene=scene)).body.decode()
        content = re.sub(r'(?m)^-- MILIASTRA_EDITOR_SCENE_V1 .*$', '', content)
        result = parse_lua_scene(content)
        prefab = result.elements[1]
        self.assertEqual((prefab.x, prefab.y, prefab.width, prefab.height, prefab.rotation), (153.25, 109.75, 256, 128, -22.5))
        self.assertEqual(prefab.prefabVariable, '竹子元件')
        changed = export_lua(ExportRequest(scene=scene)).body.decode().replace('"竹子元件"', '"新配置"')
        self.assertEqual(parse_lua_scene(changed).elements[1].prefabVariable, '新配置')

    def test_edited_id_configuration_takes_precedence_over_saved_preview_and_metadata(self):
        content = export_lua(ExportRequest(scene=prefab_scene(True))).body.decode()
        changed = content.replace('["竹子元件"] = 20001003', '["竹子元件"] = 30005016')
        restored = parse_lua_scene(changed)
        self.assertEqual(restored.elements[1].prefabId, 30005016)
        self.assertEqual(restored.elements[1].prefabVariable, '竹子元件')
        self.assertEqual(restored.library, prefab_scene(True).library)
        self.assertTrue(any('edited' in warning for warning in restored.meta.warnings))

    def test_legacy_binding_only_lua_keeps_its_metadata_hash_and_can_be_imported(self):
        scene = prefab_scene(True)
        content = export_lua(ExportRequest(scene=scene)).body.decode()
        legacy = re.sub(r'(?ms)^local PREFAB_IDS = \{\n.*?\n\}\n', '', content)
        self.assertNotIn('prefabIds', lua_scene.read_drawing(legacy))
        payload = re.search(r'(?m)^-- MILIASTRA_EDITOR_SCENE_V1 (\S+)$', legacy).group(1)
        metadata = json.loads(base64.b64decode(payload))
        metadata['drawingHash'] = lua_scene._digest(lua_scene.read_drawing(legacy))
        updated = base64.b64encode(json.dumps(metadata, ensure_ascii=False).encode()).decode()
        restored = parse_lua_scene(legacy.replace(payload, updated))
        self.assertEqual(restored.elements, scene.elements)
        self.assertEqual(restored.library, scene.library)

    def test_visual_formats_fail_before_any_sprite_download(self):
        request = ExportRequest(scene=prefab_scene(True))
        with mock.patch('app.main.fetch_sprite_bytes', side_effect=AssertionError('must not download')):
            for export in (export_css, export_svg, export_png, export_gia):
                with self.subTest(format=export.__name__), self.assertRaises(HTTPException) as failure:
                    export(request)
                self.assertEqual(failure.exception.status_code, 400)
                self.assertIn('Lua drawing only', failure.exception.detail)

    def test_custom_gia_crop_does_not_change_lua_canvas_or_relative_geometry(self):
        for mixed in (False, True):
            scene = prefab_scene(mixed)
            scene.canvas.mask.width = 225
            scene.canvas.mask.height = 207
            content = export_lua(ExportRequest(scene=scene)).body.decode()
            drawing = lua_scene.read_drawing(content)
            self.assertEqual(drawing['root'][2:4], [720, 480])
            restored = lua_scene.drawing_to_scene(drawing)
            prefab = next(item for item in restored['elements'] if item['type'] == 'prefab')
            self.assertEqual((prefab['x'], prefab['y']), (153.25, 109.75))

    def test_id_type_default_configuration_and_invalid_names(self):
        data = prefab_scene().model_dump()
        data['elements'][0]['prefabVariable'] = None
        self.assertEqual(normalize_scene(SceneDocumentModel.model_validate(data)).elements[0].prefabVariable, 'prefab_20001003')
        for value in (True, '20001003', 20.5, 0, -1, 4294967296):
            data['elements'][0]['prefabId'] = value
            with self.subTest(id=value), self.assertRaises(ValidationError):
                SceneDocumentModel.model_validate(data)
        data['elements'][0]['prefabId'] = 20001003
        for name in ('', '  ', 'x\n', 'x\x00'):
            data['elements'][0]['prefabVariable'] = name
            with self.subTest(name=name), self.assertRaises(HTTPException):
                normalize_scene(SceneDocumentModel.model_validate(data))

    def test_shared_configuration_cannot_refer_to_two_prefab_ids(self):
        scene = prefab_scene()
        second = scene.elements[0].model_copy(update={'id': 'second', 'prefabId': 30005016, 'zIndex': 2})
        scene.elements.append(second)
        with self.assertRaises(HTTPException) as failure:
            export_lua(ExportRequest(scene=scene))
        self.assertIn('different IDs', failure.exception.detail)

    def test_bindings_are_literal_validated_and_cover_only_prefab_rows(self):
        content = export_lua(ExportRequest(scene=prefab_scene(True))).body.decode()
        for replacement in ('{1,20001003,"竹子元件"}', '{2,20001003,script:GetParam("x")}', '{2,0,"x"}', '{2,20001003,""}'):
            with self.subTest(binding=replacement), self.assertRaises(ValueError):
                lua_scene.loads(content.replace('{2,20001003,"竹子元件"}', replacement))
        with self.assertRaises(ValueError):
            lua_scene.loads(content.replace('local PREFAB_BINDINGS = {\n    {2,20001003,"竹子元件"},\n}', 'local PREFAB_BINDINGS = {}'))
        with self.assertRaises(ValueError):
            lua_scene.loads(content.replace('local PREFAB_BINDINGS = {\n    {2,20001003,"竹子元件"},\n}', ''))

    def test_id_configuration_requires_literal_valid_ids_and_every_referenced_name(self):
        content = export_lua(ExportRequest(scene=prefab_scene())).body.decode()
        table = 'local PREFAB_IDS = {\n    ["竹子元件"] = 20001003,\n}'
        for replacement in ('{}', '{["竹子元件"] = 0}', '{["竹子元件"] = 4294967296}',
                            '{["竹子元件"] = 20.5}', '{["竹子元件"] = "20001003"}',
                            '{["竹子元件"] = true}', '{["wrong"] = 20001003}',
                            '{["竹子元件"] = script:GetParam("x")}', '{[1] = 20001003}'):
            with self.subTest(table=replacement), self.assertRaises(ValueError):
                lua_scene.loads(content.replace(table, 'local PREFAB_IDS = ' + replacement))
