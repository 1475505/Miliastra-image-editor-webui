import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import main


class GameFontPreferenceTests(unittest.TestCase):
    """汉仪文黑-85W 系统装了就用，没装才回落通用 CJK 字体。"""

    def tearDown(self):
        main.find_game_fonts.cache_clear()

    def test_discovers_locally_installed_font(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "HYWenHei-85W.ttf").write_bytes(b"stub")
            (root / "PingFang.ttc").write_bytes(b"stub")
            (root / "nested").mkdir()
            (root / "nested" / "汉仪文黑-85W.otf").write_bytes(b"stub")

            with mock.patch.object(main, "GAME_FONT_DIRS", (root,)):
                main.find_game_fonts.cache_clear()
                self.assertEqual(
                    sorted(path.name for path in main.find_game_fonts()),
                    ["HYWenHei-85W.ttf", "汉仪文黑-85W.otf"],
                )

    def test_local_font_wins_over_fallbacks(self):
        with tempfile.TemporaryDirectory() as tmp:
            game_font = Path(tmp) / "HYWenHei-85W.otf"
            game_font.write_bytes(b"stub")
            used: list[str] = []
            with mock.patch.object(main, "find_game_fonts", return_value=(game_font,)), mock.patch.object(
                main.ImageFont, "truetype", side_effect=lambda path, size: used.append(path) or "font"
            ):
                self.assertEqual(main.load_textbox_font(20), "font")
            self.assertEqual(used, [str(game_font)])

    def test_falls_back_when_not_installed(self):
        with mock.patch.object(main, "find_game_fonts", return_value=()):
            self.assertIsNotNone(main.load_textbox_font(20))


if __name__ == "__main__":
    unittest.main()
