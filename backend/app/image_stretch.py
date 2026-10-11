"""Nine-slice texture sampling, including sprites whose center UV span is zero."""
import math

from PIL import Image


def _axis(size, before, after, target):
    before = max(0, before) if math.isfinite(before) else 0
    after = max(0, after) if math.isfinite(after) else 0
    scale = min(1, size / (before + after or 1))
    before, after = before * scale, after * scale
    scale = min(1, target / (before + after or 1))
    return [0, before, size - after, size], [0, before * scale, target - after * scale, target]


def resize_sliced(sprite: Image.Image, target: tuple[int, int], meta: dict) -> Image.Image:
    width, height = target
    border = meta["border"]
    source_width, source_height = meta["width"], meta["height"]
    if source_width <= 0 or source_height <= 0:
        return sprite.resize(target, Image.Resampling.LANCZOS)
    sx, dx = _axis(source_width, border["left"], border["right"], width)
    sy, dy = _axis(source_height, border["top"], border["bottom"], height)
    sx = [value * sprite.width / source_width for value in sx]
    sy = [value * sprite.height / source_height for value in sy]
    dx, dy = [round(value) for value in dx], [round(value) for value in dy]
    mesh = []
    for row in range(3):
        for col in range(3):
            box = (dx[col], dy[row], dx[col + 1], dy[row + 1])
            if box[2] <= box[0] or box[3] <= box[1]:
                continue
            # Equal source coordinates deliberately repeat the seam sample.
            quad = (sx[col], sy[row], sx[col], sy[row + 1],
                    sx[col + 1], sy[row + 1], sx[col + 1], sy[row])
            mesh.append((box, quad))
    return sprite.transform(target, Image.Transform.MESH, mesh, Image.Resampling.BILINEAR)
