import io
import json
import unittest

from PIL import Image

from app.main import (
    TRANSPARENT_BACKGROUND,
    ExportRequest,
    ImportRequest,
    SceneDocumentModel,
    export_css,
    export_json,
    export_png,
    export_svg,
    import_scene,
    normalize_scene,
    parse_css_scene,
    parse_svg_scene,
)


def scene_with_background(background: str) -> SceneDocumentModel:
    return normalize_scene(
        SceneDocumentModel.model_validate(
            {
                "canvas": {"width": 120, "height": 80, "background": background},
                "elements": [
                    {
                        "id": "e1",
                        "name": "矩形",
                        "type": "rectangle",
                        "x": 60,
                        "y": 40,
                        "width": 40,
                        "height": 20,
                        "rotation": 0,
                        "color": "#0f766e",
                        "opacity": 1,
                        "zIndex": 0,
                        "isBackground": False,
                    }
                ],
                "meta": {"sourceType": "editor"},
            }
        )
    )


class NormalizeTests(unittest.TestCase):
    """画布背景已与场景数据解耦：任何输入都归一化为透明（查看背景由编辑器偏好控制）。"""

    def test_any_input_becomes_transparent(self):
        for value in ("transparent", "TRANSPARENT", " none ", "", "#ffffff", "#ABC", "#11223344"):
            self.assertEqual(scene_with_background(value).canvas.background, TRANSPARENT_BACKGROUND)

    def test_scene_background_dropped_after_normalize(self):
        scene = scene_with_background("#ff8800")
        self.assertEqual(scene.canvas.background, TRANSPARENT_BACKGROUND)
        # 图元颜色不受影响
        self.assertEqual(scene.elements[0].color, "#0f766e")


class ExportTests(unittest.TestCase):
    def test_json_round_trip_always_transparent(self):
        exported = export_json(ExportRequest(scene=scene_with_background("#ff8800"))).body.decode()
        self.assertEqual(json.loads(exported)["canvas"]["background"], "transparent")

        result = import_scene(ImportRequest(sourceType="json", content=exported))
        self.assertEqual(result.scene.canvas.background, TRANSPARENT_BACKGROUND)

    def test_css_export_always_transparent_and_round_trips(self):
        css = export_css(ExportRequest(scene=scene_with_background("transparent"))).body.decode()
        self.assertIn("background: transparent;", css)
        self.assertNotIn("background: #ffffff;", css)

        result = parse_css_scene(css)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)
        self.assertFalse(any("background color" in warning for warning in result.meta.warnings))

    def test_css_export_ignores_scene_background_color(self):
        css = export_css(ExportRequest(scene=scene_with_background("#ff8800"))).body.decode()
        self.assertIn("background: transparent;", css)
        self.assertNotIn("background: #ff8800;", css)

    def test_css_import_warns_on_solid_container_background(self):
        css = (
            "/* Miliastra CSS Export */\n"
            ".shaper-container {\n"
            "  position: relative;\n"
            "  width: 120px;\n"
            "  height: 80px;\n"
            "  background: #ff8800;\n"
            "}\n"
            ".shaper-element { position: absolute; box-sizing: border-box; }\n"
            ".a {\n"
            "  left: 40px; top: 30px; width: 40px; height: 20px;\n"
            "  background: #0f766e; opacity: 1; transform: translate(-50%, -50%);\n"
            "}\n"
        )
        result = parse_css_scene(css)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)
        self.assertTrue(any("editor-view-only" in warning for warning in result.meta.warnings))

    def test_svg_export_omits_background_rect(self):
        svg = export_svg(ExportRequest(scene=scene_with_background("transparent"))).body.decode()
        self.assertNotIn('fill="transparent"', svg)
        self.assertEqual(svg.count("<rect"), 1, "只应剩下图元本身的 rect")

        result = parse_svg_scene(svg)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)

    def test_svg_export_ignores_scene_background_color(self):
        svg = export_svg(ExportRequest(scene=scene_with_background("#ffffff"))).body.decode()
        self.assertNotIn('fill="#ffffff"', svg)

        result = parse_svg_scene(svg)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)

    def test_png_keeps_alpha_when_transparent(self):
        response = export_png(ExportRequest(scene=scene_with_background("transparent")))
        image = Image.open(io.BytesIO(response.body)).convert("RGBA")

        self.assertEqual(image.getpixel((2, 2)), (0, 0, 0, 0), "画布角落应完全透明")
        self.assertEqual(image.getpixel((60, 40)), (15, 118, 110, 255), "图元本身仍要画出来")

    def test_png_always_keeps_alpha_even_for_color_scene_background(self):
        response = export_png(ExportRequest(scene=scene_with_background("#3366ff")))
        image = Image.open(io.BytesIO(response.body)).convert("RGBA")

        self.assertEqual(image.getpixel((2, 2)), (0, 0, 0, 0), "查看背景不进导出：PNG 恒透明底")


if __name__ == "__main__":
    unittest.main()
