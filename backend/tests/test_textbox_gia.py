import json
import unittest

from app.main import ExportRequest, ImportRequest, export_gia, import_scene
from vendor.primitive_shape.gia_lua import _fields


# Raw details.textbox bytes from the user-provided GIA pair (2026-10-13).
# The client-confirmed "字号自适应正确的20261013.gia" differs from
# "20261013.gia" only at field 506 inside this message (0 -> 1).
CLIENT_FIXED_TEXTBOX = bytes.fromhex(
    "b01f14b81f01c01f01ca1f09aa1f06e6b58be8af95d01f00d81f0a"
    "f01fffffffff0ff81fffffff078020e6f10f9820b3e6cc9903"
)
CLIENT_AUTOSIZE_TEXTBOX = bytes.fromhex(
    "b01f14b81f01c01f01ca1f09aa1f06e6b58be8af95d01f01d81f0a"
    "f01fffffffff0ff81fffffff078020e6f10f9820b3e6cc9903"
)


def reported_scene(**text_settings):
    # Remaining textbox properties use the same defaults as the reported JSON.
    return import_scene(ImportRequest(sourceType="json", content=json.dumps({
        "canvas": {"width": 300, "height": 300, "background": "transparent"},
        "elements": [{
            "id": "df027927-2c2a-461b-9e20-9a29300a1b9c",
            "name": "文本", "type": "textbox",
            "x": 164.1529060132576, "y": 211.4525974158085,
            "width": 180, "height": 40, "rotationY": 50,
            "color": "#ffffff", "opacity": 1,
            "textBox": {
                "text": "测试", "fontSize": 20, "autoSize": True,
                "minFontSize": 10, "visible": False, **text_settings,
            },
        }],
    }))).scene


def textbox_payloads(gia_bytes):
    # Use the independent upstream Lua reader, not the GIA encoder's decoder.
    current = [gia_bytes[20:-4]]
    for tag in (2, 19, 1, 505, 503, 19):
        current = [value for data in current
                   for wire, value in _fields(data).get(tag, []) if wire == 2]
    return current


class TextboxGiaTests(unittest.TestCase):
    def export_payload(self, scene):
        response = export_gia(ExportRequest(scene=scene, giaGroupName="20261013"))
        self.assertEqual(response.status_code, 200)
        data = response.body
        self.assertEqual(int.from_bytes(data[:4], "big"), len(data) - 4)
        self.assertEqual(int.from_bytes(data[16:20], "big"), len(data) - 24)
        payloads = textbox_payloads(data)
        self.assertEqual(len(payloads), 1)
        return payloads[0]

    def test_reported_json_matches_client_confirmed_textbox_bytes(self):
        self.assertEqual(self.export_payload(reported_scene()), CLIENT_AUTOSIZE_TEXTBOX)

    def test_autosize_on_and_off_are_independent_of_visibility(self):
        for auto_size in (False, True):
            for visible in (False, True):
                with self.subTest(auto_size=auto_size, visible=visible):
                    payload = self.export_payload(reported_scene(autoSize=auto_size, visible=visible))
                    expected = CLIENT_AUTOSIZE_TEXTBOX if auto_size else CLIENT_FIXED_TEXTBOX
                    self.assertEqual(payload, expected)

    def test_default_autosize_and_font_sizes(self):
        raw = reported_scene().model_dump()
        for key in ("autoSize", "fontSize", "minFontSize"):
            raw["elements"][0]["textBox"].pop(key)
        scene = import_scene(ImportRequest(sourceType="json", content=json.dumps(raw))).scene
        fields = _fields(self.export_payload(scene))
        self.assertEqual(fields[502], [(0, 20)])
        self.assertEqual(fields[506], [(0, 1)])
        self.assertEqual(fields[507], [(0, 12)])


if __name__ == "__main__":
    unittest.main()
