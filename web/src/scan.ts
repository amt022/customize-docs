/** Phone document scanner, all in the browser: find the page in a photo, straighten it, clean it up. */

export type Pt = { x: number; y: number };
export type ScanFilter = "color" | "grey" | "bw" | "original";

/** Draw a picture file into a canvas no longer than `maxSide` (phone photos are 12 MP and more). */
export async function loadPicture(file: Blob, maxSide = 3000): Promise<HTMLCanvasElement> {
  // createImageBitmap decodes off the page (img.decode() can wait forever while the tab is hidden)
  let pic: ImageBitmap | HTMLImageElement;
  let url = "";
  try {
    pic = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    url = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("unreadable")); img.src = url; });
    pic = img;
  }
  try {
    const w = pic instanceof HTMLImageElement ? pic.naturalWidth : pic.width;
    const h = pic instanceof HTMLImageElement ? pic.naturalHeight : pic.height;
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const x = c.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(pic, 0, 0, c.width, c.height);
    return c;
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (!(pic instanceof HTMLImageElement)) pic.close();
  }
}

// ---------------------------------------------------------------- page detection

function cross(o: Pt, a: Pt, b: Pt) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }

function hull(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lo: Pt[] = [], up: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function area(q: Pt[]): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p.x * n.y - n.x * p.y; }
  return Math.abs(a) / 2;
}

/** Corners in the order top-left, top-right, bottom-right, bottom-left. */
export function order(q: Pt[]): Pt[] {
  const cx = q.reduce((s, p) => s + p.x, 0) / q.length, cy = q.reduce((s, p) => s + p.y, 0) / q.length;
  const s = [...q].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let first = 0;
  s.forEach((p, i) => { if (p.x + p.y < s[first].x + s[first].y) first = i; });
  return s.slice(first).concat(s.slice(0, first));
}

export function isConvex(q: Pt[]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const c = cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4]);
    if (Math.abs(c) < 1e-6) return false;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

export const wholePicture = (w: number, h: number): Pt[] => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

/**
 * Find the sheet of paper: paper is bright and has little colour, so score = brightness − saturation,
 * split with Otsu, take the bright patch in the middle, and fit the biggest four-cornered shape inside its hull.
 * Returns null when no clear page is found (then the whole photo is used and the user drags the corners).
 */
export function findPage(src: HTMLCanvasElement): Pt[] | null {
  const S = 360 / Math.max(src.width, src.height);
  const w = Math.max(8, Math.round(src.width * S)), h = Math.max(8, Math.round(src.height * S));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.filter = "blur(2px)";
  x.drawImage(src, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const v = new Uint8Array(w * h);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < v.length; i++, j += 4) {
    const r = d[j], g = d[j + 1], b = d[j + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b - 0.6 * (mx - mn))));
    v[i] = s; hist[s]++;
  }
  // Otsu
  const n = v.length;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0, wb = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue;
    const wf = n - wb; if (!wf) break;
    sb += t * hist[t];
    const mb = sb / wb, mf = (sum - sb) / wf, between = wb * wf * (mb - mf) ** 2;
    if (between > best) { best = between; th = t; }
  }
  // bright mask, eroded once so thin bright links to a white background break
  const m0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) m0[i] = v[i] > th ? 1 : 0;
  const m = new Uint8Array(n);
  for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const i = yy * w + xx;
    m[i] = m0[i] & m0[i - 1] & m0[i + 1] & m0[i - w] & m0[i + w];
  }
  // connected patches; prefer the one under the middle of the photo, else the biggest
  const lab = new Int32Array(n);
  const sizes: number[] = [0];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!m[i] || lab[i]) continue;
    const id = sizes.length; let size = 0;
    lab[i] = id; stack.push(i);
    while (stack.length) {
      const p = stack.pop()!; size++;
      const px = p % w;
      if (px > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack.push(p - 1); }
      if (px < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack.push(p + 1); }
      if (p >= w && m[p - w] && !lab[p - w]) { lab[p - w] = id; stack.push(p - w); }
      if (p < n - w && m[p + w] && !lab[p + w]) { lab[p + w] = id; stack.push(p + w); }
    }
    sizes.push(size);
  }
  if (sizes.length < 2) return null;
  let pick = 0;
  // the patch covering most of the central 20 % box
  const votes = new Map<number, number>();
  for (let yy = Math.round(h * 0.4); yy < h * 0.6; yy++) for (let xx = Math.round(w * 0.4); xx < w * 0.6; xx++) {
    const l = lab[yy * w + xx]; if (l) votes.set(l, (votes.get(l) ?? 0) + 1);
  }
  let most = 0; votes.forEach((cnt, l) => { if (cnt > most) { most = cnt; pick = l; } });
  if (!pick || sizes[pick] < n * 0.1) { pick = 1; for (let l = 2; l < sizes.length; l++) if (sizes[l] > sizes[pick]) pick = l; }
  if (sizes[pick] < n * 0.1) return null;
  // border pixels of the patch → hull → biggest quadrilateral on the hull
  const edge: Pt[] = [];
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const i = yy * w + xx;
    if (lab[i] !== pick) continue;
    if (xx === 0 || yy === 0 || xx === w - 1 || yy === h - 1 || lab[i - 1] !== pick || lab[i + 1] !== pick || lab[i - w] !== pick || lab[i + w] !== pick) edge.push({ x: xx + 0.5, y: yy + 0.5 });
  }
  let hp = hull(edge);
  while (hp.length > 36) hp = hp.filter((_, i) => i % 2 === 0);
  if (hp.length < 4) return null;
  let quad: Pt[] = [], qa = 0;
  const L = hp.length;
  for (let a = 0; a < L; a++) for (let b = a + 1; b < L; b++) for (let cc = b + 1; cc < L; cc++) for (let dd = cc + 1; dd < L; dd++) {
    const q = [hp[a], hp[b], hp[cc], hp[dd]];
    const ar = area(q);
    if (ar > qa) { qa = ar; quad = q; }
  }
  const ratio = qa / (w * h);
  if (ratio < 0.12 || ratio > 0.97) return null;
  const o = order(quad);
  if (!isConvex(o)) return null;
  // grow 1 px back out (the erosion pulled the outline in) and scale to the source
  const cx = o.reduce((s, p) => s + p.x, 0) / 4, cy = o.reduce((s, p) => s + p.y, 0) / 4;
  return o.map((p) => {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
    return {
      x: Math.max(0, Math.min(src.width, (p.x + dx / len * 1.2) / S)),
      y: Math.max(0, Math.min(src.height, (p.y + dy / len * 1.2) / S)),
    };
  });
}

// ---------------------------------------------------------------- straighten

/** Homography that maps the output rectangle (w × h) onto the four source corners. */
function homography(q: Pt[], w: number, h: number): number[] {
  const dst = [[0, 0], [w, 0], [w, h], [0, h]];
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], { x: u, y: v } = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => r[8] / r[i]).concat(1);
}

/** Output size from the corner distances, longest side at most `maxSide`. */
export function outSize(q: Pt[], maxSide = 2400): [number, number] {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let w = Math.max(d(q[0], q[1]), d(q[3], q[2])), h = Math.max(d(q[0], q[3]), d(q[1], q[2]));
  const s = Math.min(1, maxSide / Math.max(w, h));
  w = Math.max(16, Math.round(w * s)); h = Math.max(16, Math.round(h * s));
  return [w, h];
}

export function warp(src: HTMLCanvasElement, q: Pt[], maxSide = 2400): HTMLCanvasElement {
  const [W, H] = outSize(q, maxSide);
  const sw = src.width, sh = src.height;
  const sd = src.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, sw, sh).data;
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const ox = out.getContext("2d")!;
  const img = ox.createImageData(W, H);
  const od = img.data;
  const [a, b, c, d, e, f, g, hh] = homography(q, W, H);
  // downscaling a lot? average a few samples so text does not sparkle
  for (let y = 0; y < H; y++) {
    const yc = y + 0.5;
    for (let x = 0; x < W; x++) {
      const xc = x + 0.5;
      const z = g * xc + hh * yc + 1;
      let u = (a * xc + b * yc + c) / z - 0.5, v = (d * xc + e * yc + f) / z - 0.5;
      if (u < 0) u = 0; else if (u > sw - 1.001) u = sw - 1.001;
      if (v < 0) v = 0; else if (v > sh - 1.001) v = sh - 1.001;
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const o = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) {
        const top = sd[i00 + k] + (sd[i10 + k] - sd[i00 + k]) * fx;
        const bot = sd[i01 + k] + (sd[i11 + k] - sd[i01 + k]) * fx;
        od[o + k] = top + (bot - top) * fy;
      }
      od[o + 3] = 255;
    }
  }
  ox.putImageData(img, 0, 0);
  return out;
}

export function rotate(c: HTMLCanvasElement, quarter: number): HTMLCanvasElement {
  const r = ((quarter % 4) + 4) % 4;
  if (!r) return c;
  const o = document.createElement("canvas");
  o.width = r % 2 ? c.height : c.width;
  o.height = r % 2 ? c.width : c.height;
  const x = o.getContext("2d")!;
  x.translate(o.width / 2, o.height / 2);
  x.rotate((r * Math.PI) / 2);
  x.drawImage(c, -c.width / 2, -c.height / 2);
  return o;
}

// ---------------------------------------------------------------- clean up

/**
 * Even out the lighting: estimate the paper colour in blocks (a bright percentile per channel),
 * spread it over dark blocks (text, photos), smooth, then divide it out so the paper becomes white
 * and shadows / yellow light disappear.
 */
function flatten(d: Uint8ClampedArray, W: number, H: number): Float32Array {
  const B = Math.max(12, Math.round(Math.max(W, H) / 48));
  const gw = Math.ceil(W / B), gh = Math.ceil(H / B);
  const bg = new Float32Array(gw * gh * 3);
  const hist = new Uint32Array(3 * 64);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    hist.fill(0);
    let cnt = 0;
    for (let y = by * B; y < Math.min(H, by * B + B); y += 2) for (let x = bx * B; x < Math.min(W, bx * B + B); x += 2) {
      const i = (y * W + x) * 4;
      hist[d[i] >> 2]++; hist[64 + (d[i + 1] >> 2)]++; hist[128 + (d[i + 2] >> 2)]++; cnt++;
    }
    for (let k = 0; k < 3; k++) {
      let acc = 0, t = cnt * 0.9, val = 63;
      for (let j = 0; j < 64; j++) { acc += hist[k * 64 + j]; if (acc >= t) { val = j; break; } }
      bg[(by * gw + bx) * 3 + k] = val * 4 + 2;
    }
  }
  // max over a 5×5 block neighbourhood so a passport photo or a dark table cell takes the paper around it
  const mx = new Float32Array(bg.length);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) for (let k = 0; k < 3; k++) {
    let m = 0;
    for (let yy = Math.max(0, by - 2); yy <= Math.min(gh - 1, by + 2); yy++) for (let xx = Math.max(0, bx - 2); xx <= Math.min(gw - 1, bx + 2); xx++) m = Math.max(m, bg[(yy * gw + xx) * 3 + k]);
    // but do not let a bright neighbour lift a block that is itself fairly bright (keeps real shadows tracked)
    const own = bg[(by * gw + bx) * 3 + k];
    mx[(by * gw + bx) * 3 + k] = own > m * 0.8 ? own : m;
  }
  // smooth (two box passes)
  const sm = new Float32Array(mx.length);
  for (let pass = 0; pass < 2; pass++) {
    const srcA = pass ? sm.slice() : mx;
    for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) for (let k = 0; k < 3; k++) {
      let s = 0, c = 0;
      for (let yy = Math.max(0, by - 1); yy <= Math.min(gh - 1, by + 1); yy++) for (let xx = Math.max(0, bx - 1); xx <= Math.min(gw - 1, bx + 1); xx++) { s += srcA[(yy * gw + xx) * 3 + k]; c++; }
      sm[(by * gw + bx) * 3 + k] = s / c;
    }
  }
  // divide, with bilinear lookup of the block grid
  const out = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const gy = Math.min(gh - 1, Math.max(0, (y + 0.5) / B - 0.5)), y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), fy = gy - y0;
    for (let x = 0; x < W; x++) {
      const gx = Math.min(gw - 1, Math.max(0, (x + 0.5) / B - 0.5)), x0 = Math.floor(gx), x1 = Math.min(gw - 1, x0 + 1), fx = gx - x0;
      const i = (y * W + x) * 4, o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        const a = sm[(y0 * gw + x0) * 3 + k], b = sm[(y0 * gw + x1) * 3 + k], c = sm[(y1 * gw + x0) * 3 + k], dd = sm[(y1 * gw + x1) * 3 + k];
        const p = (a + (b - a) * fx) * (1 - fy) + (c + (dd - c) * fx) * fy;
        out[o + k] = Math.min(1.2, d[i + k] / Math.max(24, p));
      }
    }
  }
  return out;
}

export function clean(c: HTMLCanvasElement, filter: ScanFilter): HTMLCanvasElement {
  if (filter === "original") return c;
  const W = c.width, H = c.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const f = flatten(d, W, H);
  const lv = (v: number, lo: number, hi: number) => Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
  for (let i = 0, o = 0; i < d.length; i += 4, o += 3) {
    const r = f[o], g = f[o + 1], b = f[o + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    if (filter === "color") {
      // paper to white, ink darker, colours a little stronger (stamps, signatures in blue)
      const base = lv(L, 0.18, 0.9);
      const k = Math.pow(base, 1.25);
      for (let ch = 0; ch < 3; ch++) {
        const v = [r, g, b][ch];
        const sat = L + (v - L) * 1.35;
        d[i + ch] = Math.round(255 * Math.max(0, Math.min(1, k + (sat - L) * (1 - k * 0.6))));
      }
    } else if (filter === "grey") {
      const v = Math.round(255 * Math.pow(lv(L, 0.18, 0.9), 1.3));
      d[i] = d[i + 1] = d[i + 2] = v;
    } else {
      // black & white with a narrow soft edge so letters are not jagged
      const v = Math.round(255 * lv(L, 0.6, 0.76));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  out.getContext("2d")!.putImageData(img, 0, 0);
  return out;
}

/** Full pipeline for one page. */
export function process(src: HTMLCanvasElement, quad: Pt[], rot: number, filter: ScanFilter): HTMLCanvasElement {
  return clean(rotate(warp(src, quad), rot), filter);
}

// ---------------------------------------------------------------- PDF

export type PageFormat = "a4" | "letter" | "fit";
const SIZES: Record<Exclude<PageFormat, "fit">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

/** Page size in points and where the picture goes on it. */
export function layout(w: number, h: number, format: PageFormat): { page: [number, number]; box: [number, number, number, number] } {
  if (format === "fit") {
    // 200 dpi-ish: a phone scan of an A4 sheet comes out about A4
    const s = 72 / 200;
    const pw = +(w * s).toFixed(2), ph = +(h * s).toFixed(2);
    return { page: [pw, ph], box: [0, 0, pw, ph] };
  }
  let [pw, ph] = SIZES[format];
  if (w > h) [pw, ph] = [ph, pw];
  // close to the paper's own shape (within 10 %)? fill the page; else fit with a margin
  const ar = w / h, par = pw / ph;
  if (Math.abs(ar / par - 1) < 0.1) return { page: [pw, ph], box: [0, 0, pw, ph] };
  const m = 18;
  const s = Math.min((pw - 2 * m) / w, (ph - 2 * m) / h);
  const bw = w * s, bh = h * s;
  return { page: [pw, ph], box: [+((pw - bw) / 2).toFixed(2), +((ph - bh) / 2).toFixed(2), +bw.toFixed(2), +bh.toFixed(2)] };
}

export async function jpeg(c: HTMLCanvasElement, longSide: number, quality: number): Promise<{ data: Uint8Array; w: number; h: number }> {
  let src = c;
  const s = Math.min(1, longSide / Math.max(c.width, c.height));
  if (s < 1) {
    src = document.createElement("canvas");
    src.width = Math.max(1, Math.round(c.width * s));
    src.height = Math.max(1, Math.round(c.height * s));
    const x = src.getContext("2d")!;
    x.imageSmoothingQuality = "high";
    x.drawImage(c, 0, 0, src.width, src.height);
  }
  const blob = await new Promise<Blob>((res, rej) => src.toBlob((b) => (b ? res(b) : rej(new Error("Could not make the picture"))), "image/jpeg", quality));
  return { data: new Uint8Array(await blob.arrayBuffer()), w: src.width, h: src.height };
}

/** Gentlest first: keep detail, then lower quality, then fewer pixels. */
export const LADDER: [longSide: number, quality: number][] = [
  [2400, 0.85], [2000, 0.8], [2000, 0.68], [1700, 0.66], [1700, 0.55], [1500, 0.55], [1400, 0.48],
  [1250, 0.45], [1100, 0.42], [1000, 0.38], [900, 0.35], [800, 0.32], [700, 0.3], [600, 0.28], [500, 0.25],
];
