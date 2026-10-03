import unittest
import base64
import json
from pathlib import Path
import re

from fastapi import HTTPException

from app import lua_scene
from app.main import (
    ExportRequest, ImportRequest, SceneDocumentModel, export_lua, import_scene,
    normalize_scene, parse_lua_scene,
)


class LuaSceneTests(unittest.TestCase):
    def scene(self):
        elements = []
        for index, kind in enumerate(("rectangle", "ellipse", "triangle", "ring", "four_point_star", "five_point_star", "textbox")):
            element = dict(id=f"shape-{index}", name=f"图元 {index}", type=kind,
                           x=-12.25 + index * 25, y=48.125, width=75.5, height=51.25,
                           rotation=-37.5, color="#abcdef", opacity=0.375,
                           zIndex=index, isBackground=index == 0)
            if kind == "textbox":
                element["textBox"] = dict(text='<color=red>你好 "Lua"</color>\\path\n\t\0009\r🙂 -- ]]',
                                          fontSize=26, minFontSize=13, autoSize=False,
                                          alignH="right", alignV="bottom", visible=False,
                                          textColor="#123456", textOpacity=0.6,
                                          bgColor="#fedcba", bgOpacity=0.2,
                                          anchorType="custom", pivotX=0.25, pivotY=0.75,
                                          anchorMinX=0, anchorMaxY=1, scaleX=1.5, scaleY=0.8)
            elements.append(element)
        scene = SceneDocumentModel.model_validate(dict(
            canvas=dict(width=720, height=480, background="#fefefe"), elements=elements,
            meta=dict(sourceType="editor", sourceName="测试.lua", warnings=["existing warning"]),
            library=dict(savedItems=[dict(id="saved", name="收藏", element=elements[0])]),
        ))
        return normalize_scene(scene)

    def test_round_trip_all_shapes_text_and_library(self):
        source = self.scene()
        response = export_lua(ExportRequest(scene=source))
        self.assertNotIn("悬空引用", response.body.decode())
        result = import_scene(ImportRequest(sourceType="lua", content=response.body.decode(), sourceName="round-trip.lua"))
        self.assertEqual(result.scene.canvas, source.canvas)
        self.assertEqual(result.scene.elements, source.elements)
        self.assertEqual(result.scene.library, source.library)
        self.assertEqual(result.scene.meta.sourceType, "lua")
        self.assertEqual(result.scene.meta.sourceName, "round-trip.lua")
        self.assertEqual(result.warnings, ["existing warning"])
        self.assertIn('filename="scene.lua"', response.headers["content-disposition"])

    def test_empty_canvas(self):
        source = normalize_scene(SceneDocumentModel())
        result = parse_lua_scene(lua_scene.dumps(source.model_dump()))
        self.assertEqual(result.elements, [])
        self.assertEqual(result.library, source.library)

    def export(self, scene=None):
        return export_lua(ExportRequest(scene=scene or self.scene())).body.decode()

    def test_editing_drawing_uses_records_not_stale_metadata(self):
        content = self.export()
        result = parse_lua_scene(content.replace('100001,-372.25,', '100001,-300.0,'))
        self.assertEqual(result.elements[0].x, 60)
        self.assertTrue(any("edited" in warning for warning in result.meta.warnings))
        self.assertEqual(result.library, self.scene().library)

    def test_prefab_edit_keeps_exact_editor_data(self):
        result = parse_lua_scene(self.export().replace('local IMAGE_PREFAB_ID = 0', 'local IMAGE_PREFAB_ID = 99'))
        self.assertEqual(result.elements, self.scene().elements)

    def test_all_control_characters_and_backslashes(self):
        scene = self.scene()
        value = ''.join(chr(i) for i in range(128)) + '中文🌟\\123'
        scene.elements[-1].textBox.text = value
        content = self.export(scene)
        self.assertEqual(lua_scene.read_drawing(content)["textboxes"][0]["textBox"]["text"], value)
        self.assertEqual(parse_lua_scene(content).elements[-1].textBox.text, value)

    def test_upstream_fixtures(self):
        expected = {'single-template-fit.lua': 3, 'lua_test_fill.lua': 61,
                    'lua_test_outline.lua': 161, 'gia_synthetic.lua': 2}
        for name, count in expected.items():
            with self.subTest(name=name):
                result = parse_lua_scene((Path(__file__).parent / 'fixtures' / name).read_text(encoding='utf-8'))
                self.assertEqual(len(result.elements), count)
                # Re-export through the shared GIA emitter, then reopen.
                round_trip = parse_lua_scene(self.export(result))
                self.assertEqual(round_trip.elements, result.elements)

    def test_legacy_negative_y_and_triangle_centroid(self):
        content = (Path(__file__).parent / 'fixtures' / 'single-template-fit.lua').read_text(encoding='utf-8')
        result = parse_lua_scene(content)
        self.assertEqual((result.elements[0].x, result.elements[0].y), (50, 50))
        self.assertAlmostEqual(result.elements[2].y, 50 - 40 / 6)

    def test_geometry_without_metadata(self):
        original = self.scene()
        source = self.export(original).split(lua_scene.METADATA_PREFIX)[0]
        result = parse_lua_scene(source)
        self.assertEqual(len(result.elements), 7)
        for want, got in zip(original.elements[:6], result.elements):
            self.assertEqual(want.type, got.type)
            for key in ('x', 'y', 'width', 'height', 'rotation'):
                self.assertAlmostEqual(getattr(want,key),getattr(got,key),places=4)
            self.assertAlmostEqual(want.opacity,got.opacity,delta=1/255)
        self.assertEqual(result.elements[-1].name, original.elements[-1].name)
        self.assertEqual(result.elements[-1].textBox, original.elements[-1].textBox)
        for key in ('x', 'y', 'width', 'height', 'rotation'):
            self.assertEqual(getattr(result.elements[-1], key), getattr(original.elements[-1], key))

    def test_textbox_only_defaults_and_no_image_template_requirement(self):
        scene = normalize_scene(SceneDocumentModel.model_validate({"elements": [dict(
            id="text", type="textbox", x=150, y=100, width=180, height=40,
        )]}))
        content = self.export(scene)
        drawing = lua_scene.read_drawing(content)
        self.assertEqual(drawing["rows"], [])
        self.assertEqual(drawing["order"], [[2, 1]])
        box = drawing["textboxes"][0]["textBox"]
        self.assertIs(box["autoSize"], True)
        self.assertEqual((box["fontSize"], box["minFontSize"]), (20, 12))
        self.assertIn('local TEXTBOX_PREFAB_ID = 0', content)
        self.assertIn('if #ELEMENTS > 0 and (type(IMAGE_PREFAB_ID)', content)
        self.assertNotIn('仅保留为编辑数据', content)
        self.assertEqual(parse_lua_scene(content).elements, scene.elements)

    def test_textbox_settings_and_interleaved_prefab_order(self):
        text = self.scene().elements[-1].model_dump()
        text["zIndex"] = 1
        scene = normalize_scene(SceneDocumentModel.model_validate({
            "canvas": {"width": 720, "height": 480, "mask": {"width": 225, "height": 207}},
            "elements": [
                dict(id="rect", type="rectangle", x=10, y=20, width=30, height=40, zIndex=0),
                text,
                dict(id="prefab", type="prefab", prefabId=20001003, x=50, y=60, width=70, height=80, zIndex=2),
                dict(id="bg", type="ellipse", x=90, y=100, width=110, height=120, zIndex=3, isBackground=True),
            ],
        }))
        content = self.export(scene)
        drawing = lua_scene.read_drawing(content)
        self.assertEqual(drawing["root"][2:4], [720, 480])
        self.assertEqual([row[0] for row in drawing["rows"]], [100002, 100001, 0])
        self.assertEqual(drawing["order"], [[1, 1], [1, 2], [2, 1], [1, 3]])
        self.assertEqual(drawing["textboxes"][0]["textBox"], scene.elements[1].textBox.model_dump())
        restored = parse_lua_scene(content.split(lua_scene.METADATA_PREFIX)[0])
        self.assertEqual([item.type for item in restored.elements], ["ellipse", "rectangle", "textbox", "prefab"])
        self.assertEqual(restored.elements[2].textBox, scene.elements[1].textBox)

    def test_textbox_drawing_edits_invalidate_editor_snapshot(self):
        content = self.export()
        old_text = self.scene().elements[-1].textBox.text
        changed = content.replace(lua_scene._lua_literal(old_text), lua_scene._lua_literal("新的文字\n第二行"))
        restored = parse_lua_scene(changed)
        self.assertEqual(restored.elements[-1].textBox.text, "新的文字\n第二行")
        self.assertTrue(any("edited" in warning for warning in restored.meta.warnings))
        changed = content.replace('["autoSize"]=false', '["autoSize"]=true')
        self.assertIs(parse_lua_scene(changed).elements[-1].textBox.autoSize, True)

    def test_reject_invalid_textbox_data_and_layer_references(self):
        content = self.export()
        replacements = (
            ('["fontSize"]=26', '["fontSize"]=26.5'),
            ('["fontSize"]=26', '["fontSize"]=true'),
            ('["minFontSize"]=13', '["minFontSize"]=0'),
            ('["autoSize"]=false', '["autoSize"]=1'),
            ('["autoSize"]=false', '["autoSize"]=os.execute("ignored")'),
            ('["textColor"]="#123456"', '["textColor"]="#xyzxyz"'),
            ('["textOpacity"]=0.6', '["textOpacity"]=2'),
            ('["alignH"]="right"', '["alignH"]="unknown"'),
            ('["width"]=75.5', '["width"]=0'),
            ('["x"]=137.75', '["x"]=1e999'),
            ('    {2,1},', '    {2,2},'),
            ('    {2,1},', '    {1,1},'),
            ('    {2,1},', '    {2,1.0},'),
            ('    {2,1},', ''),
        )
        for before, after in replacements:
            self.assertIn(before, content)
            with self.subTest(replacement=after), self.assertRaises(HTTPException) as caught:
                parse_lua_scene(content.replace(before, after))
            self.assertEqual(caught.exception.status_code, 400)
        for extra in ('local TEXTBOXES = {}', 'local DRAW_ORDER = {}'):
            with self.subTest(extra=extra), self.assertRaises(HTTPException):
                parse_lua_scene(content + "\n" + extra)

    def test_legacy_textbox_snapshot_is_still_restored(self):
        content = self.export()
        before, data = content.split(lua_scene.METADATA_PREFIX)
        before = re.sub(r'(?ms)^local (TEXTBOXES|DRAW_ORDER) = \{\n.*?\n\}\n', '', before)
        metadata = json.loads(base64.b64decode(data))
        metadata["drawingHash"] = lua_scene._digest(lua_scene.read_drawing(before))
        data = base64.b64encode(json.dumps(metadata, ensure_ascii=False).encode()).decode()
        self.assertEqual(parse_lua_scene(before + lua_scene.METADATA_PREFIX + data).elements, self.scene().elements)

    def test_reject_expressions_invalid_shapes_and_malformed_data(self):
        valid = (Path(__file__).parent / 'fixtures' / 'single-template-fit.lua').read_text(encoding='utf-8')
        for content in (
            'os.execute("echo no")',
            valid.replace('IMG_WIDTH = 200', 'IMG_WIDTH = os.execute("ignored")'),
            valid.replace('IMG_WIDTH = 200', 'IMG_WIDTH = 1e999'),
            valid.replace('IMG_WIDTH = 200', 'IMG_WIDTH = "nan"'),
            valid.replace('IMG_WIDTH = 200', 'IMG_WIDTH = 0'),
            valid.replace('{0, 50.0', '{99, 50.0'),
            valid.replace('0.0, 1, 255', '0.0, 999, 255'),
            valid.replace('0.0, 1, 255', '0.0, 1, 999'),
            valid.replace('BACKGROUND_COUNT = 0', 'BACKGROUND_COUNT = 99'),
            valid.replace('local ELEMENTS = {', 'local ELEMENTS = 1 --'),
            valid + '\nlocal ELEMENTS = {}',
            valid.replace('[1] = {171, 205, 239}', '[2] = {171, 205, 239}'),
        ):
            with self.subTest(content=content[:100]), self.assertRaises(HTTPException) as caught:
                parse_lua_scene(content)
            self.assertEqual(caught.exception.status_code, 400)

    def test_runtime_code_is_never_executed(self):
        source = self.export() + '\nos.execute("ignored")\nerror("ignored")'
        self.assertEqual(parse_lua_scene(source).elements, self.scene().elements)

    def test_bad_metadata(self):
        valid = self.export()
        before, data = valid.split(lua_scene.METADATA_PREFIX)
        meta = json.loads(base64.b64decode(data))
        for bad in ('broken', base64.b64encode(json.dumps({**meta, 'version': 9}).encode()).decode()):
            with self.assertRaises(HTTPException):
                parse_lua_scene(before + lua_scene.METADATA_PREFIX + bad)

    def test_depth_and_size_limits(self):
        for content in ('local ELEMENTS = ' + '{' * 70 + '}' * 70, ' ' * (lua_scene.MAX_CONTENT_SIZE + 1)):
            with self.assertRaises(ValueError):
                lua_scene.loads(content)

    def test_repeat_export_stays_stable(self):
        scene = self.scene()
        for _ in range(3):
            result = parse_lua_scene(self.export(scene))
            self.assertEqual(result.elements, scene.elements)
            self.assertEqual(result.library, scene.library)
            scene = result


if __name__ == "__main__":
    unittest.main()
