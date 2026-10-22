type Point = { x: number; y: number };

/** Normalize each visible island for outline detection only. A 50%-opaque mark
 * is still a whole mark: an absolute alpha=128 cutoff would split its 127/129
 * quantization noise into fake notches. Ignore near-transparent PNG fringes when
 * finding islands, then use half of each island's peak as its outline level.
 */
export function outlineAlpha(alpha: Uint8ClampedArray, width: number, height: number): Float32Array {
  const result = new Float32Array(alpha.length);
  if (width < 1 || height < 1 || alpha.length !== width * height) return result;
  let peak = 0;
  for (const value of alpha) peak = Math.max(peak, value);
  const floor = Math.max(1, peak * .01);
  const seen = new Uint8Array(alpha.length);
  const queue = new Int32Array(alpha.length);
  for (let start = 0; start < alpha.length; start++) {
    if (seen[start] || alpha[start] <= floor) continue;
    let head = 0, count = 1, islandPeak = 0;
    queue[0] = start; seen[start] = 1;
    while (head < count) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      islandPeak = Math.max(islandPeak, alpha[i]);
      for (const next of [x > 0 ? i - 1 : -1, x + 1 < width ? i + 1 : -1, y > 0 ? i - width : -1, y + 1 < height ? i + width : -1]) {
        if (next >= 0 && !seen[next] && alpha[next] > floor) { seen[next] = 1; queue[count++] = next; }
      }
    }
    for (let n = 0; n < count; n++) { const i = queue[n]; result[i] = alpha[i] * 255 / islandPeak; }
  }
  return result;
}

/** Subpixel contours of each island's relative half-peak alpha. Shared edge IDs join marching-square segments
 * without rounding connections or merging separate islands and holes.
 * This is an editing guide only; it never changes the rendered mask alpha.
 */
export function alphaContourPath(alpha: Uint8ClampedArray, width: number, height: number): string {
  if (width < 1 || height < 1 || alpha.length !== width * height) return "";
  const normalized = outlineAlpha(alpha, width, height);
  const stride = width + 2;
  const points = new Map<number, Point>();
  const links = new Map<number, number[]>();
  const sample = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height ? normalized[y * width + x] : 0;
  const edge = (x: number, y: number, vertical: boolean, a: number, b: number) => {
    const id = ((y + 1) * stride + x + 1) * 2 + Number(vertical);
    if (!points.has(id)) {
      const t = (127.5 - a) / (b - a);
      points.set(id, { x: x + .5 + (vertical ? 0 : t), y: y + .5 + (vertical ? t : 0) });
    }
    return id;
  };
  const join = (a: number, b: number) => {
    const left = links.get(a), right = links.get(b);
    if (left) left.push(b); else links.set(a, [b]);
    if (right) right.push(a); else links.set(b, [a]);
  };
  for (let y = -1; y < height; y++) for (let x = -1; x < width; x++) {
    const tl = sample(x,y), tr = sample(x+1,y), br = sample(x+1,y+1), bl = sample(x,y+1);
    const sides: number[] = [];
    const crossing: (number | undefined)[] = [];
    if ((tl >= 127.5) !== (tr >= 127.5)) { sides.push(0); crossing[0] = edge(x,y,false,tl,tr); }
    if ((tr >= 127.5) !== (br >= 127.5)) { sides.push(1); crossing[1] = edge(x+1,y,true,tr,br); }
    if ((bl >= 127.5) !== (br >= 127.5)) { sides.push(2); crossing[2] = edge(x,y+1,false,bl,br); }
    if ((tl >= 127.5) !== (bl >= 127.5)) { sides.push(3); crossing[3] = edge(x,y,true,tl,bl); }
    if (sides.length === 2) join(crossing[sides[0]]!, crossing[sides[1]]!);
    else if (sides.length === 4) {
      // Diagonal contacts remain separate. Avoid bow-ties through a one-pixel gap.
      const pairs = tl >= 127.5 ? [[0,3],[1,2]] : [[0,1],[2,3]];
      for (const [a,b] of pairs) join(crossing[a]!,crossing[b]!);
    }
  }
  const paths: string[] = [];
  const visited = new Set<number>();
  const format = (n: number) => Number(n.toFixed(3));
  for (const start of links.keys()) {
    if (visited.has(start)) continue;
    const loop: Point[] = [];
    let previous = -1, current = start;
    do {
      if (visited.has(current)) break;
      visited.add(current);
      loop.push(points.get(current)!);
      const next = links.get(current)?.find(id => id !== previous);
      if (next === undefined) break;
      previous = current; current = next;
    } while (current !== start);
    if (current !== start || loop.length < 3) continue;
    // Remove exact collinear runs; retain the interpolated silhouette, not pixel stairs.
    const clean = loop.filter((p,i) => {
      const a = loop[(i+loop.length-1)%loop.length], b = loop[(i+1)%loop.length];
      return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x)) > 1e-7;
    });
    if (clean.length >= 3) paths.push(clean.map((p,i)=>`${i ? "L" : "M"}${format(p.x)},${format(p.y)}`).join("")+"Z");
  }
  return paths.join("");
}
