// Orthographic UI plane. Single axes: ROTXY2 PC device evidence.
// Mixed axes: Z-X-Y Euler (Ry * Rx * Rz), editor policy pending device coverage.
// Return CSS/screen-space components; scene Z remains counter-clockwise.
export type Rotation = { rotation: number; rotationX?: number; rotationY?: number };
export function rotationMatrix({ rotation, rotationX = 0, rotationY = 0 }: Rotation) {
  const [x, y, z] = [rotationX, rotationY, rotation].map(v => v * Math.PI / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const clean = (v: number) => Math.abs(v) < 1e-12 ? 0 : v;
  return { a: clean(cy * cz + sy * sx * sz), b: clean(-cx * sz),
    c: clean(cy * sz - sy * sx * cz), d: clean(cx * cz) };
}
export function rotationCss(rotation: Rotation) {
  const { a, b, c, d } = rotationMatrix(rotation);
  return `matrix(${a},${b},${c},${d},0,0)`;
}
export function unprojectVector(x: number, y: number, rotation: Rotation) {
  const { a, b, c, d } = rotationMatrix(rotation), det = a * d - b * c;
  if (Math.abs(det) < 1e-8) return null;
  return { x: (d * x - c * y) / det, y: (-b * x + a * y) / det };
}
