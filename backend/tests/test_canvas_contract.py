import json
import unittest

from app.main import (
    CANVAS_FIT_EXPAND,
    CANVAS_FIT_FIT,
    CANVAS_FIT_LOCK,
    parse_css_canvas_fit,
    parse_css_canvas_size,
    parse_css_scene,
    parse_json_scene,
    scene_to_css,
)


def build_css(
    *,
    container_extra: str = "",
    elements: str = "",
    width: int = 200,
    height: int = 160,
) -> str:
    """一段最小可解析的 shaper 版式 CSS，容器声明可插拔。"""
    return "\n".join(
        [
            ".shaper-container {",
            "  position: relative;",
            f"  width: {width}px;",
            f"  height: {height}px;",
            "  background: #ffffff;",
            "  overflow: hidden;",
            *([f"  {container_extra}"] if container_extra else []),
            "}",
            ".shaper-element {",
            "  position: absolute;",
            "  box-sizing: border-box;",
            "}",
            elements,
        ]
    )


# 背景矩形比画布大 4px（shaper 导出就是这种“合法溢出”），用于触发自动放大
OVERFLOWING_BACKGROUND = "\n".join(
    [
        ".shaper-element.shaper-e0 {",
        "  left: 100.00px;",
        "  top: 80.00px;",
        "  width: 208.00px;",
        "  height: 168.00px;",
        "  background: #ffffff;",
        "  opacity: 1.0000;",
        "  transform: translate(-50%, -50%) rotate(0.00deg);",
        "  transform-origin: 50% 50%;",
        "  z-index: 0;",
        "}",
        ".shaper-element.shaper-e1 {",
        "  left: 60.00px;",
        "  top: 40.00px;",
        "  width: 20.00px;",
        "  height: 20.00px;",
        "  background: #ff0000;",
        "  opacity: 1.0000;",
        "  transform: translate(-50%, -50%) rotate(0deg);",
        "  transform-origin: 50% 50%;",
        "  z-index: 1;",
        "}",
    ]
)


class ParseCanvasOptionTests(unittest.TestCase):
    def test_canvas_size_parser(self):
        self.assertEqual(parse_css_canvas_size("200x160"), (200.0, 160.0))
        self.assertEqual(parse_css_canvas_size("200 x 160"), (200.0, 160.0))
        self.assertEqual(parse_css_canvas_size("200*160"), (200.0, 160.0))
        self.assertEqual(parse_css_canvas_size("200px x 160px"), (200.0, 160.0))
        self.assertIsNone(parse_css_canvas_size("200"))
        self.assertIsNone(parse_css_canvas_size("0x160"))
        self.assertIsNone(parse_css_canvas_size("nope"))
        self.assertIsNone(parse_css_canvas_size(None))

    def test_canvas_fit_parser(self):
        self.assertEqual(parse_css_canvas_fit("lock"), CANVAS_FIT_LOCK)
        self.assertEqual(parse_css_canvas_fit(" LOCK "), CANVAS_FIT_LOCK)
        self.assertEqual(parse_css_canvas_fit("fit"), CANVAS_FIT_FIT)
        self.assertEqual(parse_css_canvas_fit("expand"), CANVAS_FIT_EXPAND)
        # 未声明 / 无法识别都回落旧的自动放大行为
        self.assertEqual(parse_css_canvas_fit(None), CANVAS_FIT_EXPAND)
        self.assertEqual(parse_css_canvas_fit("banana"), CANVAS_FIT_EXPAND)


class LockedCanvasTests(unittest.TestCase):
    def test_lock_keeps_declared_canvas_despite_overflow(self):
        scene = parse_css_scene(
            build_css(
                container_extra="-miliastra-canvas-fit: lock;",
                elements=OVERFLOWING_BACKGROUND,
            )
        )
        self.assertEqual((scene.canvas.width, scene.canvas.height), (200.0, 160.0))
        # 图元坐标保持原始图片坐标系，不做整体位移
        self.assertEqual([(e.x, e.y) for e in scene.elements], [(100.0, 80.0), (60.0, 40.0)])
        self.assertTrue(any("canvas was kept as declared" in w for w in scene.meta.warnings))
        self.assertFalse(any("auto-expanded" in w for w in scene.meta.warnings))

    def test_lock_without_overflow_is_silent(self):
        css = build_css(
            container_extra="-miliastra-canvas-fit: lock;",
            elements=OVERFLOWING_BACKGROUND.replace("208.00px", "198.00px").replace("168.00px", "158.00px"),
        )
        scene = parse_css_scene(css)
        self.assertEqual((scene.canvas.width, scene.canvas.height), (200.0, 160.0))
        self.assertEqual(
            scene.meta.warnings,
            ["Ignored the .shaper-container background color; use a canvas-filling rectangle element for backgrounds."],
        )

    def test_explicit_size_wins_over_width_height(self):
        scene = parse_css_scene(
            build_css(
                container_extra="-miliastra-canvas-size: 640 x 480;",
                elements=OVERFLOWING_BACKGROUND,
                width=10,
                height=10,
            )
        )
        self.assertEqual((scene.canvas.width, scene.canvas.height), (640.0, 480.0))

    def test_explicit_fit_mode_ignores_declared_size(self):
        scene = parse_css_scene(
            build_css(
                container_extra="-miliastra-canvas-size: 200x160;\n  -miliastra-canvas-fit: fit;",
                elements=OVERFLOWING_BACKGROUND,
            )
        )
        self.assertEqual((scene.canvas.width, scene.canvas.height), (208.0, 168.0))

    def test_legacy_css_still_auto_expands(self):
        scene = parse_css_scene(build_css(elements=OVERFLOWING_BACKGROUND))
        self.assertEqual((scene.canvas.width, scene.canvas.height), (208.0, 168.0))
        self.assertTrue(any("auto-expanded" in w for w in scene.meta.warnings))


class RoundTripTests(unittest.TestCase):
    def test_scene_to_css_emits_canvas_options(self):
        scene = parse_css_scene(
            build_css(container_extra="-miliastra-canvas-fit: lock;", elements=OVERFLOWING_BACKGROUND)
        )
        css = scene_to_css(scene)
        self.assertIn("-miliastra-canvas-size: 200x160;", css)
        self.assertIn("-miliastra-canvas-fit: lock;", css)

        again = parse_css_scene(css)
        self.assertEqual((again.canvas.width, again.canvas.height), (200.0, 160.0))
        self.assertEqual(len(again.elements), len(scene.elements))


# Primitive Shaper 结果页 JSON 导出的形状：{ canvas, elements, meta, shaper }，
# 元素扁平、id 为字符串，shaper 键里是拟合工具的原始元数据（编辑器忽略）。
SHAPER_JSON_EXPORT = {
    "canvas": {"width": 200, "height": 160, "background": "#ffffff"},
    "elements": [
        {
            "id": "0",
            "name": "",
            "type": "rectangle",
            "x": 100,
            "y": 80,
            "width": 208,
            "height": 168,
            "rotation": 0,
            "color": "#ffffff",
            "opacity": 1,
            "zIndex": 0,
            "isBackground": True,
        },
        {
            "id": "1",
            "name": "",
            "type": "ellipse",
            "x": 101.21,
            "y": 80.54,
            "width": 108.85,
            "height": 109.23,
            "rotation": 0.73,
            "color": "#c00707",
            "opacity": 0.8588,
            "zIndex": 1,
            "isBackground": False,
        },
    ],
    "meta": {"sourceType": "json", "sourceName": "e2e_demo", "warnings": []},
    "shaper": {
        "image_name": "e2e_demo",
        "group_name": "e2e_demo",
        "origin": {"x": 3.33, "y": 2.67},
        "image_size": {"width": 200, "height": 160},
        "config": {"pixel_per_unit": 1, "num_primitives": 40},
        "mask": None,
    },
}


class JsonSceneContractTests(unittest.TestCase):
    def test_shaper_export_keeps_declared_canvas(self):
        scene = parse_json_scene(json.dumps(SHAPER_JSON_EXPORT))
        # 画布 = 导出图尺寸，且不因背景矩形外扩 4px 被放大
        self.assertEqual((scene.canvas.width, scene.canvas.height), (200.0, 160.0))
        self.assertEqual(len(scene.elements), 2)
        self.assertEqual((scene.meta.sourceType, scene.meta.sourceName), ("json", "e2e_demo"))
        self.assertEqual(scene.meta.warnings, [])
        # 几何与 id 原样保留，未发生整体平移
        first, second = scene.elements
        self.assertEqual(first.id, "0")
        self.assertTrue(first.isBackground)
        self.assertEqual((first.x, first.y, first.width, first.height), (100.0, 80.0, 208.0, 168.0))
        self.assertEqual((second.x, second.y, second.width, second.height), (101.21, 80.54, 108.85, 109.23))
        self.assertAlmostEqual(second.rotation, 0.73, places=4)
        self.assertAlmostEqual(second.opacity, 0.8588, places=4)

    def test_elements_without_canvas_still_auto_fits(self):
        """缺 canvas 时画布会按图元外接范围重算——这正是 Shaper 导出必须带 canvas 的原因。"""
        payload = {"elements": [dict(SHAPER_JSON_EXPORT["elements"][1])]}
        scene = parse_json_scene(json.dumps(payload))
        self.assertNotEqual((scene.canvas.width, scene.canvas.height), (200.0, 160.0))
        self.assertTrue(any("auto-fitted" in w for w in scene.meta.warnings))


if __name__ == "__main__":
    unittest.main()
