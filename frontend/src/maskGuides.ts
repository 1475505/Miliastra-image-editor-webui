/** Trace a bounded alpha grid as closed pixel-edge loops, including inner holes.
 * Used only for editor outlines; never included in exported scene data.
 */
export function alphaContourPath(alpha: Uint8ClampedArray, width: number, height: number): string {
  const stride = width + 1;
  const edges = new Map<number, number[]>();
  const inside = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && alpha[y * width + x] >= 128;
  const add = (x: number, y: number, tx: number, ty: number) => {
    const start = y * stride + x, end = ty * stride + tx;
    const next = edges.get(start);
    if (next) next.push(end); else edges.set(start, [end]);
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) add(x, y, x + 1, y);
    if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) add(x, y + 1, x, y);
  }
  const point = (n: number) => [n % stride, Math.floor(n / stride)];
  const paths: string[] = [];
  while (edges.size) {
    const start = edges.keys().next().value!;
    const points = [point(start)];
    let current = start;
    do {
      const from = current, next = edges.get(from);
      if (!next) break;
      current = next.pop()!;
      if (!next.length) edges.delete(from);
      points.push(point(current));
    } while (current !== start);
    // Collapse collinear grid segments before serializing the outline.
    const simplified: number[][] = [];
    for (const p of points) {
      while (simplified.length >= 2) {
        const a = simplified[simplified.length - 2], b = simplified[simplified.length - 1];
        if ((b[0] - a[0]) * (p[1] - b[1]) !== (b[1] - a[1]) * (p[0] - b[0])) break;
        simplified.pop();
      }
      simplified.push(p);
    }
    paths.push(simplified.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("") + "Z");
  }
  return paths.join("");
}
