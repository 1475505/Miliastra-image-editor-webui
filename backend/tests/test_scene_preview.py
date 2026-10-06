import io
import math
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, ImageChops, ImageDraw

from app.main import ExportRequest, SceneDocumentModel, export_png, parse_css_scene, scene_to_css, scene_to_svg


def scene_with(*elements, background="transparent"):
    return SceneDocumentModel.model_validate({
        "canvas": {"width": 300, "height": 300, "background": background},
        "elements": [{"id": f"shape-{i}", "type": "triangle", "x": 150, "y": 150,
                      "width": 100, "height": 100, "color": "#ff0000", "zIndex": i, **element}
                     for i, element in enumerate(elements)],
    })


def render(scene):
    return Image.open(io.BytesIO(export_png(ExportRequest(scene=scene)).body)).convert("RGBA")


class PreviewGeometryTests(unittest.TestCase):
    def test_demo_css_still_imports_and_renders(self):
        css = (Path(__file__).resolve().parents[2] / "demo" / "demo.css").read_text(encoding="utf-8")
        scene = parse_css_scene(css)
        self.assertEqual(len(scene.elements), 51)
        self.assertGreater(render(scene).width, 0)

    def test_triangle_rotates_about_box_center_not_centroid(self):
        for angle in (0, 90, 180, -90, 37):
            with self.subTest(angle=angle):
                image = render(scene_with({"rotation": angle}))
                # Independent rotation of CSS vertices (50% 0%, 0% 100%, 100% 100%).
                radians = math.radians(-angle)
                points = [(150 + x * math.cos(radians) - y * math.sin(radians),
                           150 + x * math.sin(radians) + y * math.cos(radians))
                          for x, y in ((0, -50), (-50, 50), (50, 50))]
                expected = Image.new("L", image.size)
                ImageDraw.Draw(expected).polygon(points, fill=255)
                actual = image.getchannel("A")
                # Raster edge rounding may differ by a pixel; interior/position must agree.
                changed = sum(value != 0 for value in ImageChops.difference(actual, expected).getdata())
                self.assertLess(changed, 220)
                for actual_edge, expected_edge in zip(actual.getbbox(), expected.getbbox()):
                    self.assertLessEqual(abs(actual_edge - expected_edge), 1)

        image = render(scene_with({"rotation": 180}))
        self.assertEqual(image.getpixel((110, 105)), (255, 0, 0, 255))
        self.assertEqual(image.getpixel((150, 225)), (0, 0, 0, 0))

    def test_star_preview_and_exports_use_editor_vertices(self):
        stars = {
            "four_point_star": [(50, 0), (62, 38), (100, 50), (62, 62), (50, 100), (38, 62), (0, 50), (38, 38)],
            "five_point_star": [(50, 0), (61, 35), (98, 35), (68, 57), (79, 92), (50, 71), (21, 92), (32, 57), (2, 35), (39, 35)],
        }
        for kind, vertices in stars.items():
            with self.subTest(kind=kind):
                scene = scene_with({})
                scene.elements[0].type = kind
                image = render(scene)
                expected = Image.new("L", image.size)
                ImageDraw.Draw(expected).polygon([(100 + x, 100 + y) for x, y in vertices], fill=255)
                actual = image.getchannel("A")
                # 透明画布下抗锯齿边缘保留部分 alpha，与硬边多边形栅格化有亚像素级差异
                changed = sum(value != 0 for value in ImageChops.difference(actual, expected).getdata())
                self.assertLess(changed, 120)
                for actual_edge, expected_edge in zip(actual.getbbox(), expected.getbbox()):
                    self.assertLessEqual(abs(actual_edge - expected_edge), 1)
                css = scene_to_css(scene)
                self.assertIn("polygon(" + ", ".join(f"{x}% {y}%" for x, y in vertices) + ")", css)
                self.assertEqual(parse_css_scene(css).elements[0].type, kind)
                svg = scene_to_svg(scene)
                self.assertIn(" ".join(f"{100+x:.2f},{100+y:.2f}" for x, y in vertices), svg)

    def test_alpha_blends_in_layer_order(self):
        scene = scene_with({}, {"opacity": 0.5})
        scene.elements[0].type = scene.elements[1].type = "rectangle"
        scene.elements[0].color = "#0000ff"
        self.assertEqual(render(scene).getpixel((150, 150)), (128, 0, 127, 255))

    def test_opacity_keeps_background_alpha_even_with_legacy_color_scene_background(self):
        """旧场景里残留的画布颜色背景不进导出：半透明图元保持自身 alpha。"""
        image = render(scene_with({"opacity": 0.5}, background="#ffffff"))
        self.assertEqual(image.getpixel((150, 150)), (255, 0, 0, 128))

    def test_ring_alpha_is_not_applied_twice_and_hole_preserves_lower_layer(self):
        scene = scene_with({}, {"opacity": 0.5})
        scene.elements[0].type = "rectangle"
        scene.elements[0].color = "#0000ff"
        scene.elements[1].type = "ring"
        image = render(scene)
        self.assertEqual(image.getpixel((150, 150)), (0, 0, 255, 255))
        self.assertEqual(image.getpixel((196, 150)), (128, 0, 127, 255))

    def test_sprite_opacity_preserves_straight_alpha(self):
        scene = scene_with({"opacity": 0.5})
        scene.elements[0].type = "image"
        scene.elements[0].imageAssetId = 106001
        sprite = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
        buffer = io.BytesIO()
        sprite.save(buffer, "PNG")
        with mock.patch("app.main.fetch_sprite_bytes", return_value=buffer.getvalue()):
            pixel = render(scene).getpixel((150, 150))
        self.assertEqual(pixel[:3], (255, 0, 0))
        self.assertIn(pixel[3], (127, 128))

    def test_off_canvas_shape_is_clipped_and_one_pixel_lines_render(self):
        scene = scene_with({})
        scene.elements[0].type = "rectangle"
        scene.elements[0].x = 0
        scene.elements[0].height = 1
        image = render(scene)
        self.assertEqual(image.getpixel((0, 150)), (255, 0, 0, 255))
        self.assertEqual(image.getpixel((60, 150)), (0, 0, 0, 0))


if __name__ == "__main__":
    unittest.main()
