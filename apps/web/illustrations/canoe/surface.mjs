// Smooth four-tone shading for a parametric surface (a canoe hull is not a turned part).
// A surface is a function X(u, w) -> [x, y, z] over u, w in [0, 1]. Every tone region is the
// set of grid points where a field is >= 0; marching squares on a padded grid traces each
// region as closed loops in (u, w), which are mapped back through X, so tone boundaries,
// the waterline and the silhouette follow the true surface instead of a facet staircase.
import { iso } from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";

export const BANDS = [0.2, 0.42, 0.62];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function loopsOf(values, N, M) {
  const val = (i, j) => (i < 0 || j < 0 || i > N || j > M ? -1e9 : values[i][j]);
  const points = new Map();
  const pointOf = (key, i0, j0, i1, j1) => {
    if (!points.has(key)) {
      const f0 = val(i0, j0);
      const f1 = val(i1, j1);
      const t = f0 / (f0 - f1);
      points.set(key, [clamp(i0 + (i1 - i0) * t, 0, N), clamp(j0 + (j1 - j0) * t, 0, M)]);
    }
    return key;
  };
  const next = new Map();
  for (let i = -1; i <= N; i++) {
    for (let j = -1; j <= M; j++) {
      const corner = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const inside = corner.map(([a, b]) => val(a, b) >= 0);
      if (inside.every((x) => x === inside[0])) continue;
      const edges = [
        () => pointOf(`h${i},${j}`, i, j, i + 1, j),
        () => pointOf(`v${i + 1},${j}`, i + 1, j, i + 1, j + 1),
        () => pointOf(`h${i},${j + 1}`, i, j + 1, i + 1, j + 1),
        () => pointOf(`v${i},${j}`, i, j, i, j + 1),
      ];
      const crossings = [];
      for (let k = 0; k < 4; k++) if (inside[k] !== inside[(k + 1) % 4]) crossings.push({ key: edges[k](), exit: inside[k] });
      if (crossings.length === 2) {
        const exit = crossings.find((c) => c.exit);
        const entry = crossings.find((c) => !c.exit);
        next.set(exit.key, entry.key);
      } else {
        const centre = corner.reduce((sum, [a, b]) => sum + val(a, b), 0) / 4;
        const connected = centre >= 0;
        crossings.forEach((c, m) => {
          if (!c.exit) return;
          next.set(c.key, crossings[(m + (connected ? 1 : 3)) % 4].key);
        });
      }
    }
  }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let key = start;
    while (key && !seen.has(key)) {
      seen.add(key);
      loop.push(points.get(key));
      key = next.get(key);
    }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}

function simplify(points, tolerance, closed) {
  if (points.length < 4) return points;
  const keep = new Array(points.length).fill(false);
  const stack = [[0, points.length - 1]];
  keep[0] = keep[points.length - 1] = true;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1e-9;
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((points[k][0] - ax) * dy - (points[k][1] - ay) * dx) / length;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance) {
      keep[at] = true;
      stack.push([a, at], [at, b]);
    }
  }
  const out = points.filter((_, index) => keep[index]);
  return closed && out.length < 3 ? points : out;
}

const fmt = (value) => {
  const text = (Math.round(value * 100) / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return text === "-0" ? "0" : text;
};
export const polyD = (points, closed = true) => (points.length ? `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}${closed ? "Z" : ""}` : "");

// A parametric surface with a normal field, a visibility rule and an optional keep field.
export function surfaceOf(X, { N = 120, M = 40, P, outward, keep = null, flip = false, h = 1e-4 }) {
  const V = G.viewOf(P);
  const L = G.lightOf(P);
  const normalAt = (u, w) => {
    const du = [Math.min(1, u + h), Math.max(0, u - h)];
    const dw = [Math.min(1, w + h), Math.max(0, w - h)];
    const Xu = G.sub3(X(du[0], w), X(du[1], w));
    const Xw = G.sub3(X(u, dw[0]), X(u, dw[1]));
    let n = G.unit3(G.cross3(Xu, Xw));
    if (!Number.isFinite(n[0]) || G.len3(n) < 0.5) n = outward(u, w);
    if (G.dot3(n, outward(u, w)) < 0) n = G.mul3(n, -1);
    return flip ? G.mul3(n, -1) : n;
  };
  const grid = [];
  for (let i = 0; i <= N; i++) {
    const row = [];
    for (let j = 0; j <= M; j++) {
      const u = i / N;
      const w = j / M;
      const p = X(u, w);
      const n = normalAt(u, w);
      row.push({ p, n, vis: G.dot3(n, V), score: G.dot3(n, L), keep: keep ? keep(p, u, w) : 1 });
    }
    grid.push(row);
  }
  const base = (cell) => Math.min(cell.vis * 8, cell.keep);
  const field = (fn) => grid.map((row) => row.map(fn));
  const toScreen = (loop, tolerance = 0.06) =>
    simplify(
      loop.map(([fi, fj]) => iso(X(fi / N, fj / M), P)),
      tolerance,
      true,
    );
  const region = (fn) => loopsOf(field(fn), N, M).map((loop) => toScreen(loop));
  const visible = region(base);
  const shades = [visible, ...BANDS.map((band) => region((cell) => Math.min(base(cell), (cell.score - band) * 8)))];
  // Visible stretches of an iso-parametric curve: fixed w (along u) or fixed u (along w).
  const curve = (fixed, value, { from = 0, to = 1, samples = 160, extra = null } = {}) => {
    const runs = [];
    let run = null;
    let last = null;
    for (let k = 0; k <= samples; k++) {
      const s = from + ((to - from) * k) / samples;
      const [u, w] = fixed === "w" ? [s, value] : [value, s];
      const p = X(u, w);
      const n = normalAt(u, w);
      const f = Math.min(G.dot3(n, V) * 8, keep ? keep(p, u, w) : 1, extra ? extra(p, u, w) : 1);
      if (f >= 0) {
        if (!run) {
          run = [];
          if (last) {
            const t = last.f / (last.f - f);
            const s0 = last.s + (s - last.s) * t;
            run.push(fixed === "w" ? X(s0, value) : X(value, s0));
          }
          runs.push(run);
        }
        run.push(p);
      } else if (run) {
        const t = last.f / (last.f - f);
        const s0 = last.s + (s - last.s) * t;
        run.push(fixed === "w" ? X(s0, value) : X(value, s0));
        run = null;
      }
      last = { s, f };
    }
    return runs.filter((r) => r.length > 1);
  };
  return {
    grid,
    normalAt,
    shades: shades.map((loops) => loops.map((loop) => polyD(loop)).join("")),
    outline: visible.map((loop) => polyD(loop)).join(""),
    loops: visible,
    curve,
  };
}

// Paint a surface the way solidSvg paints a kit solid (fill, four shades, inner lines, outline).
export function surfaceSvg(s, { tone = "hi", inner = "", edge = true, lit = false } = {}) {
  const parts = [`<path class="iso-fill" fill-rule="evenodd" d="${s.shades[0]}"/>`];
  s.shades.forEach((d, shade) => {
    if (d) parts.push(`<path class="iso-shade" data-shade="${shade}" fill-rule="evenodd" d="${d}"/>`);
  });
  if (inner) parts.push(inner);
  if (edge) parts.push(`<path class="iso-line iso-edge" data-tone="${tone}" d="${s.outline}"/>`);
  return `<g class="iso-solid" data-seamless=""${lit ? ' data-lit=""' : ""}>${parts.join("")}</g>`;
}
