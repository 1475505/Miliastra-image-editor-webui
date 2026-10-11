"""Orthographic UI-plane projection; single axes verified by ROTXY2 on PC.

Mixed axes use Z-X-Y Euler order (Ry * Rx * Rz) as an explicit editor policy.
Coordinates returned here are screen-space (Y down); stored Z is CCW positive.
"""
import math


def rotation_matrix(z=0.0, x=0.0, y=0.0):
    rx, ry, rz = map(math.radians, (x, y, z))
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    values = (cy * cz + sy * sx * sz, -cx * sz, cy * sz - sy * sx * cz, cx * cz)
    return tuple(0.0 if abs(value) < 1e-12 else value for value in values)
