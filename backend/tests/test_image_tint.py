import unittest

from PIL import Image

from app.main import SceneElementModel, paste_sprite


class ImageTintTests(unittest.TestCase):
    def render(self, color, tint=True):
        sprite = Image.new("RGBA", (2, 1))
        sprite.putdata([(200, 100, 50, 255), (80, 160, 240, 255)])
        original = sprite.tobytes()
        canvas = Image.new("RGBA", (2, 1))
        element = SceneElementModel(
            id="asset", type="image", imageAssetId=109018,
            imageTint=tint, color=color, x=1, y=0.5, width=2, height=1,
        )
        paste_sprite(canvas, element, sprite)
        self.assertEqual(sprite.tobytes(), original)
        return list(canvas.getdata())

    def test_color_asset_multiplies_channels_and_preserves_detail(self):
        self.assertEqual(self.render("#80ff00"), [(100, 100, 0, 255), (40, 160, 0, 255)])

    def test_white_tint_preserves_original_colors(self):
        self.assertEqual(self.render("#ffffff"), [(200, 100, 50, 255), (80, 160, 240, 255)])

    def test_legacy_disabled_tint_preserves_original_colors(self):
        self.assertEqual(self.render("#80ff00", False), self.render("#ffffff"))
