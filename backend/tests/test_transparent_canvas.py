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
    normalize_canvas_background,
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
    def test_accepts_transparent_sentinels(self):
        self.assertEqual(normalize_canvas_background("transparent"), TRANSPARENT_BACKGROUND)
        self.assertEqual(normalize_canvas_background("TRANSPARENT"), TRANSPARENT_BACKGROUND)
        self.assertEqual(normalize_canvas_background(" none "), TRANSPARENT_BACKGROUND)

    def test_blank_falls_back_to_white(self):
        self.assertEqual(normalize_canvas_background(""), "#ffffff")
        self.assertEqual(normalize_canvas_background(None), "#ffffff")

    def test_colors_still_normalized(self):
        self.assertEqual(normalize_canvas_background("#ABC"), "#aabbcc")
        self.assertEqual(normalize_canvas_background("#11223344"), "#112233")

    def test_scene_keeps_transparency_after_normalize(self):
        scene = scene_with_background("transparent")
        self.assertEqual(scene.canvas.background, TRANSPARENT_BACKGROUND)
        # 图元颜色不受影响
        self.assertEqual(scene.elements[0].color, "#0f766e")


class ExportTests(unittest.TestCase):
    def test_json_round_trip_keeps_transparency(self):
        exported = export_json(ExportRequest(scene=scene_with_background("transparent"))).body.decode()
        self.assertEqual(json.loads(exported)["canvas"]["background"], "transparent")

        result = import_scene(ImportRequest(sourceType="json", content=exported))
        self.assertEqual(result.scene.canvas.background, TRANSPARENT_BACKGROUND)

    def test_css_export_uses_transparent_and_round_trips(self):
        css = export_css(ExportRequest(scene=scene_with_background("transparent"))).body.decode()
        self.assertIn("background: transparent;", css)
        self.assertNotIn("background: #ffffff;", css)

        result = parse_css_scene(css)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)
        self.assertFalse(any("background color" in warning for warning in result.meta.warnings))

    def test_css_export_keeps_color_background(self):
        css = export_css(ExportRequest(scene=scene_with_background("#ff8800"))).body.decode()
        self.assertIn("background: #ff8800;", css)

    def test_svg_export_omits_background_rect(self):
        svg = export_svg(ExportRequest(scene=scene_with_background("transparent"))).body.decode()
        self.assertNotIn('fill="transparent"', svg)
        self.assertEqual(svg.count("<rect"), 1, "只应剩下图元本身的 rect")

        result = parse_svg_scene(svg)
        self.assertEqual(result.canvas.background, TRANSPARENT_BACKGROUND)

    def test_svg_export_keeps_background_rect_for_opaque_canvas(self):
        svg = export_svg(ExportRequest(scene=scene_with_background("#ffffff"))).body.decode()
        self.assertIn('fill="#ffffff"', svg)

        result = parse_svg_scene(svg)
        self.assertEqual(result.canvas.background, "#ffffff")

    def test_png_keeps_alpha_when_transparent(self):
        response = export_png(ExportRequest(scene=scene_with_background("transparent")))
        image = Image.open(io.BytesIO(response.body)).convert("RGBA")

        self.assertEqual(image.getpixel((2, 2)), (0, 0, 0, 0), "画布角落应完全透明")
        self.assertEqual(image.getpixel((60, 40)), (15, 118, 110, 255), "图元本身仍要画出来")

    def test_png_fills_background_when_opaque(self):
        response = export_png(ExportRequest(scene=scene_with_background("#3366ff")))
        image = Image.open(io.BytesIO(response.body)).convert("RGBA")

        self.assertEqual(image.getpixel((2, 2)), (51, 102, 255, 255))


if __name__ == "__main__":
    unittest.main()
