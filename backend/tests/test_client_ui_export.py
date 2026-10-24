import copy
import json
import os
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path

from fastapi import HTTPException

from app import client_ui_export
from app.main import ExportRequest, SceneDocumentModel, export_container_node
from vendor.primitive_shape.gia_lua import (
    _children,
    _components,
    _fields,
    _get,
    _message,
    _messages,
    _vector,
)


def sample_scene(mask=False):
    """画布 200×160，容器中心在场景坐标 (100, 80)。"""
    return {
        "canvas": {
            "width": 200,
            "height": 160,
            "background": "transparent",
            "mask": {
                "enabled": mask,
                "previewOnCanvas": False,
                "shapeType": 1,
                "x": 10,
                "y": 15,
                "width": 70,
                "height": 50,
            },
        },
        "elements": [
            {"id": "bg", "name": "底", "type": "rectangle", "isBackground": True,
             "x": 100, "y": 80, "width": 200, "height": 160, "zIndex": 0,
             "color": "#ffffff", "opacity": 1},
            {"id": "circle", "name": "圆", "type": "ellipse",
             "x": 120, "y": 90, "width": 12, "height": 20, "zIndex": 1,
             "rotation": 30, "rotationX": 5, "rotationY": 90,
             "color": "#123456", "opacity": 0.5},
            {"id": "triangle", "name": "三角", "type": "triangle",
             "x": 140, "y": 110, "width": 12, "height": 18, "zIndex": 2,
             "rotation": 45, "color": "#abcdef", "opacity": 0},
        ],
    }


def content(unit):
    return _message(_message(unit, 19), 1)


def parts(unit):
    return _components(content(unit))


def body(unit, kind, tag):
    return _message(_message(parts(unit)[kind], 503), tag)


def guid(unit):
    return _get(_message(unit, 1), 4)


def related(unit):
    return [_get(value, 4) for value in _messages(unit, 2)]


def decode(data):
    root = _fields(data[20:-4])
    main = list(_messages(root, 1))[0]
    return root, main, [main] + list(_messages(root, 2))


def layouts(unit):
    transform = body(unit, 12, 13)
    multi = _message(transform, 12)
    return multi, [(_get(platform, 501), _message(platform, 502))
                  for platform in _messages(multi, 501)]


class ContainerNodeGiaTests(unittest.TestCase):
    def test_template_identity_and_component_markers(self):
        scene = sample_scene()
        before = copy.deepcopy(scene)
        data = client_ui_export.build_container_node_gia(scene, "中文拼图")
        self.assertEqual(scene, before)
        self.assertEqual(struct.unpack(">5I", data[:20]),
                         (len(data) - 4, 1, 0x326, 3, len(data) - 24))
        self.assertEqual(data[-4:], b"\0\0\x06y")
        root, main, units = decode(data)
        self.assertEqual(len(list(_messages(root, 1))), 1)
        self.assertNotIn(4, root)  # 不套用素材组的经典/超限标记。
        self.assertEqual(_get(root, 5, 2).decode(), "7.1.0")
        self.assertEqual(_get(main, 3, 2).decode(), "中文拼图")
        self.assertEqual(_get(main, 5), 70)  # 客户端控件模板，不是服务端容器(21)。
        self.assertEqual(len(units), 4)
        ids = [guid(unit) for unit in units]
        self.assertEqual(ids, list(range(1073741825, 1073741829)))
        self.assertIs(main, units[0])
        self.assertEqual(related(main), ids[1:])
        self.assertEqual(_children(content(main)), ids[1:])
        self.assertIn(91, parts(main))  # 容器节点专用槽。
        self.assertNotIn(82, parts(main))  # 无服务端根节点引用槽。
        self.assertNotIn(504, content(main))
        for unit in units[1:]:
            self.assertEqual(_get(content(unit), 504), ids[0])
            self.assertFalse(related(unit))
            self.assertFalse(_children(content(unit)))
            self.assertEqual(_get(unit, 5), 15)
        markers = {12: (1, 4), 86: (4, 5), 83: (63, 65),
                   90: (67, 69), 91: (68, 70), 96: (73, 75), 97: (74, 76)}
        asset_indices = []
        for unit in units:
            identity = _message(unit, 1)
            self.assertEqual((_get(identity, 2), _get(identity, 3)), (1, 8))
            meta = content(unit)
            self.assertEqual(_get(meta, 501), guid(unit))
            infos = list(_messages(meta, 502))
            self.assertEqual(_get(_message(infos[0], 11), 501), guid(unit))
            self.assertEqual(len(infos), 3 if unit is main else 2)
            asset_indices.append(_get(_message(infos[1], 12), 501))
            for component in _messages(meta, 505):
                kind = _get(component, 502)
                if kind == 15:
                    self.assertNotIn(503, component)
                    continue
                details = _message(component, 503)
                self.assertEqual((_get(component, 501), _get(details, 501)), markers[kind])
                self.assertEqual(_get(details, 502), kind)
                self.assertEqual(_get(details, 503), 1)
                self.assertEqual(_message(details, 504), identity)
        self.assertEqual(asset_indices, [1, 2, 3, 4])
        # 新资产不引用来自其他模板的伴生 GUID。
        self.assertFalse(_message(list(_messages(content(main), 502))[-1], 14))

    def test_layout_color_alpha_storage_order_and_assets(self):
        _, main, units = decode(client_ui_export.build_container_node_gia(sample_scene()))
        # 输入按底→顶，客户端 GIA 同方向；不能整体倒序。
        self.assertEqual([_get(unit, 3, 2).decode() for unit in units[1:]], ["1", "2", "3"])
        images = [body(unit, 96, 84) for unit in units[1:]]
        self.assertEqual([_get(image, 503) for image in images], [100001, 100002, 100003])
        self.assertEqual([_get(image, 502) for image in images], [0xFFFFFFFF, 0x80123456, 0x00ABCDEF])
        self.assertEqual([_get(image, 504) for image in images], [1, 1, 1])  # Stretch
        for unit in units:
            multi, platforms = layouts(unit)
            self.assertEqual([device for device, _ in platforms], [0, 1, 2, 3])
            self.assertEqual(_get(multi, 504), 1)
            self.assertTrue(all(rect == platforms[0][1] for _, rect in platforms))
            rect = platforms[0][1]
            if unit is main:
                self.assertEqual(_get(multi, 502), 25)
                self.assertIn(502, rect)
                self.assertEqual(_vector(rect, 502), [.5, .5])
                self.assertEqual(_vector(rect, 503), [.5, .5])
                self.assertEqual(_vector(rect, 505), [200, 160])
                self.assertEqual(_vector(rect, 504), [0, 0])
            else:
                self.assertEqual(_get(multi, 502), 23)
                self.assertEqual(_vector(rect, 502), [.5, .5])
                config = body(unit, 97, 85)
                for flag in (501, 509, 514, 516):
                    self.assertFalse(_get(config, flag))
                self.assertIn(84, parts(unit)[97])  # 图片 B 槽显式存在。
        background = layouts(units[1])[1][0][1]
        self.assertEqual(_vector(background, 504), [0, 0])
        self.assertEqual(_vector(background, 505), [200, 160])
        ellipse = layouts(units[2])[1][0][1]
        self.assertEqual(_vector(ellipse, 504), [20, -10])
        self.assertEqual(_vector(ellipse, 505), [12, 20])
        self.assertEqual(_vector(ellipse, 508, (1, 2, 3), (0, 0, 0)), [5, 90, 30])
        triangle = layouts(units[3])[1][0][1]
        self.assertEqual(_vector(triangle, 504), [40, -30])
        self.assertEqual(_vector(triangle, 505), [12, 18])
        self.assertEqual(_vector(triangle, 506), [.5, .5])
        self.assertEqual(_vector(triangle, 508, (1, 2, 3), (0, 0, 0)), [0, 0, 45])

    def test_rectangular_mask_is_transparent_parent_with_rebased_children(self):
        _, main, units = decode(client_ui_export.build_container_node_gia(sample_scene(mask=True)))
        root, mask, *images = units
        self.assertEqual(len(units), 5)
        self.assertEqual(related(main), [guid(mask)])
        self.assertEqual(_children(content(root)), [guid(mask)])
        self.assertEqual(_children(content(mask)), [guid(image) for image in images])
        self.assertEqual(_get(body(mask, 96, 84), 502), 0x00FFFFFF)
        self.assertEqual(_get(body(mask, 97, 85), 501), 1)
        mask_rect = layouts(mask)[1][0][1]
        # 遮罩中心 (x, y) 已是相对画布中心的 Y 向上偏移。
        self.assertEqual(_vector(mask_rect, 504), [10, 15])
        self.assertEqual(_vector(mask_rect, 505), [70, 50])
        for index, image in enumerate(images):
            self.assertEqual(_get(content(image), 504), guid(mask))
            rect = layouts(image)[1][0][1]
            x, y = _vector(rect, 504)
            source = sample_scene()["elements"][index]
            self.assertAlmostEqual(x + 10, source["x"] - 100, places=5)
            self.assertAlmostEqual(y + 15, 80 - source["y"], places=5)

    def test_background_sorted_below_and_image_asset_mapping(self):
        scene = sample_scene()
        scene["elements"][2]["isBackground"] = True  # 背景图元永远在最底层。
        scene["elements"][2]["zIndex"] = -5
        scene["elements"][0]["isBackground"] = False
        _, _, units = decode(client_ui_export.build_container_node_gia(scene))
        self.assertEqual([_get(unit, 3, 2).decode() for unit in units[1:]], ["1", "2", "3"])
        self.assertEqual(_get(body(units[1], 96, 84), 503), 100003)
        scene["elements"] = [
            {"id": "star", "type": "four_point_star", "x": 100, "y": 80, "width": 10, "height": 10,
             "color": "#ff0000", "opacity": 0.25},
            {"id": "ring", "type": "ring", "x": 100, "y": 80, "width": 10, "height": 10},
            {"id": "img", "type": "image", "x": 100, "y": 80, "width": 10, "height": 10,
             "imageAssetId": 123456, "imageTint": False},
        ]
        _, _, units = decode(client_ui_export.build_container_node_gia(scene))
        images = [body(unit, 96, 84) for unit in units[1:]]
        self.assertEqual([_get(image, 503) for image in images], [100004, 100006, 123456])
        self.assertEqual([_get(image, 502) for image in images],
                         [0x40FF0000, 0xFFFFFFFF, 0xFFFFFFFF])
        scene["elements"][2]["imageTint"] = True
        scene["elements"][2]["color"] = "#00ff00"
        _, _, units = decode(client_ui_export.build_container_node_gia(scene))
        self.assertEqual(_get(body(units[3], 96, 84), 502), 0xFF00FF00)

    def test_invalid_input_fails_instead_of_silently_dropping_shapes(self):
        def update(path, **values):
            def apply(scene):
                target = scene
                for key in path[:-1]:
                    target = target[key]
                target[path[-1]].update(values)
            return apply

        changes = [
            lambda s: s["canvas"].update(width=0),
            lambda s: s["canvas"].update(height=float("nan")),
            update(("elements", 0), type="textbox"),
            update(("elements", 0), type="prefab"),
            update(("elements", 0), width=0),
            update(("elements", 0), x=float("inf")),
            update(("elements", 0), rotation=float("nan")),
            update(("elements", 0), opacity=float("nan")),
            update(("elements", 0), color="not-a-color"),
            lambda s: s["canvas"]["mask"].update(enabled=True, shapeType=2),
            lambda s: s.update(elements=[]),
        ]
        for change in changes:
            scene = sample_scene()
            change(scene)
            with self.subTest(scene=scene), self.assertRaises(ValueError):
                client_ui_export.build_container_node_gia(scene)

    def test_http_endpoint_returns_gia_and_reports_unsupported_types(self):
        response = export_container_node(ExportRequest(
            scene=SceneDocumentModel(**sample_scene()), giaGroupName="中文拼图"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.media_type, "application/octet-stream")
        self.assertIn("scene_container_node.gia", response.headers["Content-Disposition"])
        root, main, units = decode(response.body)
        self.assertEqual(_get(main, 3, 2).decode(), "中文拼图")
        self.assertEqual(len(units), 4)

        scene = sample_scene()
        scene["elements"][1]["type"] = "textbox"
        with self.assertRaises(HTTPException) as raised:
            export_container_node(ExportRequest(scene=SceneDocumentModel(**scene)))
        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("容器节点暂不支持", raised.exception.detail)

    @unittest.skipUnless(os.environ.get("UGC_GIA_CODEC"),
                         "set UGC_GIA_CODEC to ugc-tool vendor dist/index.js")
    def test_independent_ugc_codec_roundtrip(self):
        with tempfile.TemporaryDirectory() as directory:
            fixtures = []
            for masked in (False, True):
                scene = sample_scene(mask=masked)
                path = Path(directory) / f"sample-{masked}.gia"
                path.write_bytes(client_ui_export.build_container_node_gia(scene, "独立验证"))
                path.with_suffix(".json").write_text(json.dumps(scene), encoding="utf-8")
                fixtures.append(str(path))
            subprocess.run(
                ["node", str(Path(__file__).with_suffix(".mjs")), os.environ["UGC_GIA_CODEC"], *fixtures],
                check=True,
            )


if __name__ == "__main__":
    unittest.main()
