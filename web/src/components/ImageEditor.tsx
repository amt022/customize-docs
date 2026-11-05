import { useEffect, useRef, useState } from "react";
import { jpegToDocx, jpegToPdf } from "../wrap";
import { STORE, TEMPLATES, check, padJpeg, pixels, type Check, type Req } from "./requirements";

type Mask = "none" | "rounded" | "circle";
type Corner = "nw" | "ne" | "se" | "sw";
type Edge = Corner | "n" | "s" | "e" | "w";

interface Layer {
  id: number;
  name: string;
  src: HTMLCanvasElement;
  cx: number; cy: number; w: number; h: number; rot: number;
  flipH: boolean; flipV: boolean;
  opacity: number; brightness: number; contrast: number; saturation: number; blur: number;
  gray: boolean; bw: boolean;
  border: number; borderColor: string; shadow: number;
  crop: [number, number, number, number]; // left, top, right, bottom in %
  mask: Mask;
  locked: boolean;
}

interface Art { w: number; h: number; bg: string }
type Format = "png" | "jpeg" | "webp" | "pdf" | "docx";

let nextId = 1;
const MAX_ART = 4000;

interface Preset { key: string; label: string; w: number; h: number; unit: "mm" | "px" }
const PRESETS: Preset[] = [
  { key: "passport-in", label: "Passport photo (35 × 45 mm)", w: 35, h: 45, unit: "mm" },
  { key: "passport-us", label: "US passport / visa (2 × 2 in)", w: 50.8, h: 50.8, unit: "mm" },
  { key: "stamp", label: "Stamp size (20 × 25 mm)", w: 20, h: 25, unit: "mm" },
  { key: "postcard", label: "Postcard (4 × 6 in)", w: 101.6, h: 152.4, unit: "mm" },
  { key: "photo57", label: "Photo print (5 × 7 in)", w: 127, h: 178, unit: "mm" },
  { key: "wallet", label: "Wallet photo (2.5 × 3.5 in)", w: 63.5, h: 88.9, unit: "mm" },
  { key: "idcard", label: "ID card (85.6 × 54 mm)", w: 85.6, h: 54, unit: "mm" },
  { key: "signature", label: "Signature (50 × 20 mm)", w: 50, h: 20, unit: "mm" },
  { key: "a4", label: "A4 (210 × 297 mm)", w: 210, h: 297, unit: "mm" },
  { key: "a5", label: "A5 (148 × 210 mm)", w: 148, h: 210, unit: "mm" },
  { key: "insta", label: "Instagram post (1080 × 1080 px)", w: 1080, h: 1080, unit: "px" },
  { key: "story", label: "Story / reel (1080 × 1920 px)", w: 1080, h: 1920, unit: "px" },
  { key: "yt", label: "YouTube thumbnail (1280 × 720 px)", w: 1280, h: 720, unit: "px" },
  { key: "fbcover", label: "Facebook cover (820 × 312 px)", w: 820, h: 312, unit: "px" },
];

/** Pixel size of a preset at the chosen print resolution, shrunk if it would be larger than the editor allows. */
function presetPixels(p: Preset, dpi: number, flip: boolean): [number, number] {
  let w = p.unit === "px" ? p.w : (p.w / 25.4) * dpi, h = p.unit === "px" ? p.h : (p.h / 25.4) * dpi;
  if (flip) [w, h] = [h, w];
  const k = Math.min(1, MAX_ART / Math.max(w, h));
  return [Math.max(16, Math.round(w * k)), Math.max(16, Math.round(h * k))];
}

// ------------------------------------------------------------------ drawing
function filterOf(l: Layer): string {
  const f = [`brightness(${l.brightness}%)`, `contrast(${l.contrast}%)`, `saturate(${l.saturation}%)`];
  if (l.blur > 0) f.push(`blur(${l.blur}px)`);
  if (l.gray || l.bw) f.push("grayscale(1)");
  if (l.bw) f.push("contrast(1000%)");
  return f.join(" ");
}

function shape(ctx: CanvasRenderingContext2D, l: Layer, w: number, h: number) {
  ctx.beginPath();
  if (l.mask === "circle") ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (l.mask === "rounded") ctx.roundRect(0, 0, w, h, Math.min(w, h) * 0.14);
  else ctx.rect(0, 0, w, h);
}

function drawLayer(ctx: CanvasRenderingContext2D, l: Layer) {
  const [cl, ct, cr, cb] = l.crop;
  const sx = (l.src.width * cl) / 100, sy = (l.src.height * ct) / 100;
  const sw = (l.src.width * (100 - cl - cr)) / 100, sh = (l.src.height * (100 - ct - cb)) / 100;
  const w = Math.max(1, Math.round(l.w)), h = Math.max(1, Math.round(l.h));
  if (sw < 1 || sh < 1) return;
  // render the picture on its own first, so filters, mask and border stay inside it and the shadow follows its shape
  const t = document.createElement("canvas");
  t.width = w; t.height = h;
  const tc = t.getContext("2d")!;
  tc.save();
  shape(tc, l, w, h);
  tc.clip();
  tc.filter = filterOf(l);
  tc.drawImage(l.src, sx, sy, sw, sh, 0, 0, w, h);
  tc.filter = "none";
  if (l.border > 0) {
    shape(tc, l, w, h);
    tc.lineWidth = l.border * 2;
    tc.strokeStyle = l.borderColor;
    tc.stroke();
  }
  tc.restore();

  ctx.save();
  ctx.translate(l.cx, l.cy);
  ctx.rotate((l.rot * Math.PI) / 180);
  ctx.scale(l.flipH ? -1 : 1, l.flipV ? -1 : 1);
  ctx.globalAlpha = l.opacity / 100;
  if (l.shadow > 0) {
    ctx.shadowColor = "rgba(0,0,0,.45)";
    ctx.shadowBlur = l.shadow * 1.5;
    ctx.shadowOffsetX = l.shadow * 0.5;
    ctx.shadowOffsetY = l.shadow * 0.5;
  }
  ctx.drawImage(t, -l.w / 2, -l.h / 2, l.w, l.h);
  ctx.restore();
}

function render(canvas: HTMLCanvasElement, layers: Layer[], art: Art, scale = 1) {
  canvas.width = Math.max(1, Math.round(art.w * scale));
  canvas.height = Math.max(1, Math.round(art.h * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  if (art.bg !== "transparent") {
    ctx.fillStyle = art.bg;
    ctx.fillRect(0, 0, art.w, art.h);
  }
  layers.forEach((l) => drawLayer(ctx, l));
}

function sharpen(src: HTMLCanvasElement, amount: number): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const a = src.getContext("2d")!.getImageData(0, 0, w, h);
  const o = out.getContext("2d")!.createImageData(w, h);
  const d = a.data, r = o.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const up = y > 0 ? d[i - w * 4 + c] : d[i + c], dn = y < h - 1 ? d[i + w * 4 + c] : d[i + c];
        const lf = x > 0 ? d[i - 4 + c] : d[i + c], rt = x < w - 1 ? d[i + 4 + c] : d[i + c];
        const v = d[i + c] + amount * (4 * d[i + c] - up - dn - lf - rt);
        r[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
      r[i + 3] = d[i + 3];
    }
  }
  out.getContext("2d")!.putImageData(o, 0, 0);
  return out;
}

function removeBackground(src: HTMLCanvasElement, tolerance: number): HTMLCanvasElement {
  const { width: w, height: h } = src;
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  const oc = out.getContext("2d")!;
  oc.drawImage(src, 0, 0);
  const img = oc.getImageData(0, 0, w, h);
  const d = img.data;
  // the background colour is the average of the four corners
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + d[i + c], 0) / 4);
  const limit = tolerance * 4.4; // 0..100 -> 0..440 (max colour distance is ~441)
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
    if (dist <= limit) d[i + 3] = 0;
    else if (dist <= limit + 30) d[i + 3] = Math.min(d[i + 3], ((dist - limit) / 30) * 255); // soft edge
  }
  oc.putImageData(img, 0, 0);
  return out;
}

function load(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      c.getContext("2d")!.drawImage(im, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Cannot open ${file.name}`)); };
    im.src = url;
  });
}

const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: string, fallback = 0) => { const n = parseFloat(v); return isFinite(n) ? n : fallback; };

// ------------------------------------------------------------------ component
export default function ImageEditor() {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [art, setArt] = useState<Art>({ w: 1200, h: 800, bg: "#ffffff" });
  const [sel, setSel] = useState<number | null>(null);
  const [lock, setLock] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("png");
  const [quality, setQuality] = useState(85);
  const [outScale, setOutScale] = useState(100);
  const [tol, setTol] = useState(25);
  const [sharp, setSharp] = useState(0.5);
  const [exported, setExported] = useState<string | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [sizeMode, setSizeMode] = useState<"quality" | "target">("quality");
  const [targetVal, setTargetVal] = useState(200);
  const [targetUnit, setTargetUnit] = useState<"KB" | "MB">("KB");
  const [working, setWorking] = useState(false);
  const [dpi, setDpi] = useState(300);
  const [landscape, setLandscape] = useState(false);
  const [presetFit, setPresetFit] = useState<"fill" | "fit">("fill");
  const [req, setReq] = useState<Req>(TEMPLATES[0]);
  const [reqOn, setReqOn] = useState(false);
  const [saved, setSaved] = useState<Req[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; }
  });
  const [reqRes, setReqRes] = useState<{ checks: Check[]; padded: boolean; reached: boolean } | null>(null);
  const history = useRef<{ layers: Layer[]; art: Art }[]>([]);
  const future = useRef<{ layers: Layer[]; art: Art }[]>([]);
  const clip = useRef<Layer | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const fileNew = useRef<HTMLInputElement>(null);
  const fileReplace = useRef<HTMLInputElement>(null);
  const drag = useRef<null | { kind: "move" | "resize" | "rotate" | "crop"; corner?: Edge; sx: number; sy: number; start: Layer; moved: boolean }>(null);

  const layer = layers.find((l) => l.id === sel) ?? null;

  useEffect(() => { if (canvas.current) render(canvas.current, layers, art); }, [layers, art]);

  const remember = () => {
    history.current.push({ layers, art });
    if (history.current.length > 60) history.current.shift();
    future.current = [];
  };
  const change = (next: Layer[], nextArt = art) => { remember(); setLayers(next); setArt(nextArt); };
  const patch = (id: number, p: Partial<Layer>) => change(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const undo = () => {
    const h = history.current.pop();
    if (!h) return;
    future.current.push({ layers, art });
    setLayers(h.layers); setArt(h.art);
  };
  const redo = () => {
    const f = future.current.pop();
    if (!f) return;
    history.current.push({ layers, art });
    setLayers(f.layers); setArt(f.art);
  };

  // ------------------------------------------------------------- adding and replacing pictures
  const addFiles = async (files: File[]) => {
    setMsg(null);
    let list = layers, a = art, last: number | null = null;
    for (const f of files) {
      if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) { setMsg(`${f.name}: only PNG, JPG and WebP are supported`); continue; }
      try {
        const src = await load(f);
        if (list.length === 0) {
          const k = Math.min(1, MAX_ART / Math.max(src.width, src.height));
          a = { ...a, w: Math.round(src.width * k), h: Math.round(src.height * k) };
        }
        const k = list.length === 0 ? a.w / src.width : Math.min(1, (a.w * 0.8) / src.width, (a.h * 0.8) / src.height); 
        const l: Layer = {
          id: nextId++, name: f.name, src, cx: a.w / 2, cy: a.h / 2, w: src.width * k, h: src.height * k, rot: 0,
          flipH: false, flipV: false, opacity: 100, brightness: 100, contrast: 100, saturation: 100, blur: 0, gray: false, bw: false,
          border: 0, borderColor: "#000000", shadow: 0, crop: [0, 0, 0, 0], mask: "none", locked: false,
        };
        list = [...list, l];
        last = l.id;
      } catch (e) {
        setMsg((e as Error).message);
      }
    }
    if (last !== null) { change(list, a); setSel(last); }
  };

  const replace = async (file: File) => {
    if (!layer) return;
    try {
      const src = await load(file);
      // the new picture keeps the old one's width and takes its own proportions
      const h = (layer.w * src.height) / src.width;
      patch(layer.id, { src, name: file.name, h, crop: [0, 0, 0, 0] });
    } catch (e) { setMsg((e as Error).message); }
  };

  const duplicate = (l: Layer) => {
    const copy = { ...l, id: nextId++, name: `${l.name} copy`, cx: l.cx + 24, cy: l.cy + 24, locked: false };
    change([...layers, copy]);
    setSel(copy.id);
  };
  const remove = (id: number) => { change(layers.filter((l) => l.id !== id)); setSel(null); };
  const reorder = (id: number, to: "front" | "forward" | "backward" | "back") => {
    const i = layers.findIndex((l) => l.id === id);
    const j = to === "front" ? layers.length - 1 : to === "back" ? 0 : clamp(i + (to === "forward" ? 1 : -1), 0, layers.length - 1);
    if (i === j) return;
    const next = [...layers];
    const [x] = next.splice(i, 1);
    next.splice(j, 0, x);
    change(next);
  };

  const align = (how: "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom") => {
    if (!layer) return;
    const p: Partial<Layer> = {};
    if (how === "left") p.cx = layer.w / 2;
    if (how === "hcenter") p.cx = art.w / 2;
    if (how === "right") p.cx = art.w - layer.w / 2;
    if (how === "top") p.cy = layer.h / 2;
    if (how === "vmiddle") p.cy = art.h / 2;
    if (how === "bottom") p.cy = art.h - layer.h / 2;
    patch(layer.id, p);
  };

  const distribute = (axis: "x" | "y") => {
    const free = layers.filter((l) => !l.locked).sort((a, b) => (axis === "x" ? a.cx - b.cx : a.cy - b.cy));
    if (free.length < 3) { setMsg("Distribute needs at least three unlocked pictures"); return; }
    const size = (l: Layer) => (axis === "x" ? l.w : l.h);
    const total = axis === "x" ? art.w : art.h;
    const gap = (total - free.reduce((s, l) => s + size(l), 0)) / (free.length + 1);
    let at = gap;
    const pos = new Map<number, number>();
    free.forEach((l) => { pos.set(l.id, at + size(l) / 2); at += size(l) + gap; });
    change(layers.map((l) => (pos.has(l.id) ? { ...l, [axis === "x" ? "cx" : "cy"]: pos.get(l.id)! } : l)));
  };

  // ------------------------------------------------------------- preset sizes
  const applyPreset = (key: string, d = dpi, land = landscape) => {
    const pr = PRESETS.find((x) => x.key === key);
    if (!pr) return;
    const [w, h] = presetPixels(pr, d, land);
    // with one picture it is fitted to the new size; with several, only the selected one is
    const target = layers.length === 1 ? layers[0].id : sel;
    const next = layers.map((l) => {
      if (l.id !== target) return l;
      const k = presetFit === "fill" ? Math.max(w / l.w, h / l.h) : Math.min(w / l.w, h / l.h);
      return { ...l, w: l.w * k, h: l.h * k, cx: w / 2, cy: h / 2 };
    });
    change(next, { ...art, w, h });
  };
  const presetKey = PRESETS.find((x) => {
    const [w, h] = presetPixels(x, dpi, landscape);
    return w === art.w && h === art.h;
  })?.key ?? "";
  const presetInfo = PRESETS.find((x) => x.key === presetKey);

  // ------------------------------------------------------------- application limits
  const persist = (list: Req[]) => {
    setSaved(list);
    try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* storage unavailable */ }
  };
  // make the canvas, format and file-size target match what the application asks for
  const applyReq = (r: Req) => {
    const [w, h] = pixels(r);
    const target = layers.length === 1 ? layers[0].id : sel;
    const next = layers.map((l) => {
      if (l.id !== target) return l;
      const k = presetFit === "fill" ? Math.max(w / l.w, h / l.h) : Math.min(w / l.w, h / l.h);
      return { ...l, w: l.w * k, h: l.h * k, cx: w / 2, cy: h / 2 };
    });
    change(next, { ...art, w, h, bg: art.bg === "transparent" ? "#ffffff" : art.bg });
    setOutScale(100);
    setFormat(r.format);
    if (r.maxKB) { setSizeMode("target"); setTargetUnit("KB"); setTargetVal(r.maxKB); } else setSizeMode("quality");
  };
  const updateReq = (patch: Partial<Req>) => {
    const r = { ...req, ...patch };
    setReq(r);
    if (reqOn) applyReq(r);
  };
  const reqField = (label: string, value: number, key: "w" | "h" | "minKB" | "maxKB", step = 1) => (
    <label className="ie-field"><span>{label}</span>
      <input type="number" min={0} step={step} value={value} onChange={(e) => updateReq({ [key]: Math.max(0, num(e.target.value, value)) })} /></label>
  );

  const targetKB = targetVal * (targetUnit === "MB" ? 1024 : 1);
  const setTargetKB = (kb: number) => {
    if (kb >= 1000) { setTargetUnit("MB"); setTargetVal(Math.round((kb / 1024) * 10) / 10); }
    else { setTargetUnit("KB"); setTargetVal(Math.max(1, Math.round(kb))); }
  };

  // ------------------------------------------------------------- pointer handling on the canvas
  const toArt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = wrap.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * art.w, ((e.clientY - r.top) / r.height) * art.h];
  };
  const hit = (x: number, y: number): Layer | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const a = (-l.rot * Math.PI) / 180, dx = x - l.cx, dy = y - l.cy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(lx) <= l.w / 2 && Math.abs(ly) <= l.h / 2) return l;
    }
    return null;
  };

  const down = (e: React.PointerEvent) => {
    const [x, y] = toArt(e);
    const l = hit(x, y);
    setSel(l ? l.id : null);
    if (l && !l.locked) {
      wrap.current!.setPointerCapture(e.pointerId);
      drag.current = { kind: "move", sx: x, sy: y, start: l, moved: false };
    }
  };
  const handleDown = (e: React.PointerEvent, kind: "resize" | "rotate" | "crop", corner?: Edge) => {
    if (!layer || layer.locked) return;
    e.stopPropagation();
    wrap.current!.setPointerCapture(e.pointerId);
    const [x, y] = toArt(e);
    drag.current = { kind, corner, sx: x, sy: y, start: layer, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = toArt(e);
    const s = d.start;
    if (!d.moved) { remember(); d.moved = true; }
    let next: Layer = s;
    if (d.kind === "move") {
      next = { ...s, cx: s.cx + x - d.sx, cy: s.cy + y - d.sy };
    } else if (d.kind === "rotate") {
      let deg = (Math.atan2(y - s.cy, x - s.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      next = { ...s, rot: Math.round(((deg % 360) + 360) % 360) };
    } else if (d.kind === "crop") {
      const a = (-s.rot * Math.PI) / 180, dx = x - d.sx, dy = y - d.sy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const [cl, ct, cr, cb] = s.crop;
      const ppx = s.w / (100 - cl - cr), ppy = s.h / (100 - ct - cb); // frame pixels per % of the source
      // a flipped picture shows its source mirrored, so the visual left edge is the source's right edge
      const fx = s.flipH ? -1 : 1, fy = s.flipV ? -1 : 1;
      const edge = d.corner!;
      const srcW = s.flipH ? "e" : "w", srcE = s.flipH ? "w" : "e", srcN = s.flipV ? "s" : "n", srcS = s.flipV ? "n" : "s";
      let nl = cl, nt = ct, nr = cr, nb = cb;
      if (edge.includes(srcW)) nl = clamp(cl + (lx * fx) / ppx, 0, 95 - cr);
      if (edge.includes(srcE)) nr = clamp(cr - (lx * fx) / ppx, 0, 95 - cl);
      if (edge.includes(srcN)) nt = clamp(ct + (ly * fy) / ppy, 0, 95 - cb);
      if (edge.includes(srcS)) nb = clamp(cb - (ly * fy) / ppy, 0, 95 - ct);
      const left = (s.flipH ? nr - cr : nl - cl) * ppx, right = (s.flipH ? nl - cl : nr - cr) * ppx;
      const top = (s.flipV ? nb - cb : nt - ct) * ppy, bottom = (s.flipV ? nt - ct : nb - cb) * ppy;
      const sxl = (left - right) / 2, syl = (top - bottom) / 2, b = (s.rot * Math.PI) / 180;
      next = {
        ...s, crop: [nl, nt, nr, nb], w: ppx * (100 - nl - nr), h: ppy * (100 - nt - nb),
        cx: s.cx + sxl * Math.cos(b) - syl * Math.sin(b), cy: s.cy + sxl * Math.sin(b) + syl * Math.cos(b),
      };
    } else {
      const a = (-s.rot * Math.PI) / 180, dx = x - d.sx, dy = y - d.sy;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const sxn = d.corner!.includes("e") ? 1 : -1, syn = d.corner!.includes("s") ? 1 : -1;
      let w = Math.max(10, s.w + sxn * lx), h = Math.max(10, s.h + syn * ly);
      const keep = e.shiftKey ? !lock : lock;
      if (keep) {
        const k = Math.max(w / s.w, h / s.h);
        w = Math.max(10, s.w * k); h = Math.max(10, s.h * k);
      }
      const dw = (w - s.w) * sxn, dh = (h - s.h) * syn; // centre shifts by half of the change along each local axis
      const b = (s.rot * Math.PI) / 180;
      const ox = (dw / 2) * Math.cos(b) - (dh / 2) * Math.sin(b), oy = (dw / 2) * Math.sin(b) + (dh / 2) * Math.cos(b);
      next = { ...s, w, h, cx: s.cx + ox, cy: s.cy + oy };
    }
    setLayers((ls) => ls.map((l) => (l.id === s.id ? next : l)));
  };
  const up = () => { drag.current = null; };

  // ------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA") return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
      else if (mod && e.key.toLowerCase() === "c" && layer) clip.current = layer;
      else if (mod && e.key.toLowerCase() === "v" && clip.current) { e.preventDefault(); duplicate(clip.current); }
      else if (mod && e.key.toLowerCase() === "d" && layer) { e.preventDefault(); duplicate(layer); }
      else if ((e.key === "Delete" || e.key === "Backspace") && layer && !layer.locked) { e.preventDefault(); remove(layer.id); }
      else if (layer && !layer.locked && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        patch(layer.id, { cx: layer.cx + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0), cy: layer.cy + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ------------------------------------------------------------- export
  // PDF and Word hold the picture as a JPEG
  const wrapped = format === "pdf" || format === "docx";
  const mime = wrapped ? "image/jpeg" : `image/${format}`;
  const encode = async (scale: number, q: number) => {
    const c = document.createElement("canvas");
    // JPEG has no transparency: fill with white so transparent areas do not turn black
    render(c, layers, mime === "image/jpeg" && art.bg === "transparent" ? { ...art, bg: "#ffffff" } : art, scale);
    let blob: Blob | null = await new Promise((r) => c.toBlob(r, mime, q));
    if (!blob) throw new Error("Could not create the image");
    if (wrapped) {
      const jpeg = new Uint8Array(await blob.arrayBuffer());
      blob = format === "pdf" ? jpegToPdf(jpeg, c.width, c.height) : jpegToDocx(jpeg, c.width, c.height);
    }
    return { blob, width: c.width, height: c.height };
  };

  // produce the file: either at the chosen quality, or the best quality that fits under the target size
  const makeRaw = async () => {
    let scale = outScale / 100;
    if (sizeMode === "quality") return { ...(await encode(scale, quality / 100)), scale, fits: true };
    const target = targetVal * (targetUnit === "MB" ? 1024 * 1024 : 1024);
    for (let round = 0; round < 25 && scale >= 0.03; round++) {
      if (format === "png") {
        const r = await encode(scale, 1);
        if (r.blob.size <= target) return { ...r, scale, fits: true };
      } else {
        const top = await encode(scale, 0.95);
        if (top.blob.size <= target) return { ...top, scale, fits: true };
        const low = await encode(scale, 0.05);
        if (low.blob.size <= target) {
          let best = low, lo = 0.05, hi = 0.95;
          for (let i = 0; i < 7; i++) {
            const mid = (lo + hi) / 2, r = await encode(scale, mid);
            if (r.blob.size <= target) { best = r; lo = mid; } else hi = mid;
          }
          return { ...best, scale, fits: true };
        }
      }
      if (reqOn) break; // the application fixes the dimensions, so they are never reduced
      scale *= 0.85; // even the lowest quality is too big: shrink the picture and try again
    }
    return { ...(await encode(Math.max(scale, 0.03), 0.05)), scale, fits: false };
  };

  const make = async () => {
    const r = await makeRaw();
    // a JPEG below the application's minimum size is padded with empty metadata
    if (reqOn && format === "jpeg" && req.minKB && r.blob.size < req.minKB * 1024 && (!req.maxKB || req.minKB <= req.maxKB)) {
      return { ...r, blob: await padJpeg(r.blob, Math.ceil(req.minKB * 1024) + 16), padded: true };
    }
    return { ...r, padded: false };
  };

  // live pass/fail check of what would be downloaded
  useEffect(() => {
    if (!reqOn || !layers.length) { setReqRes(null); return; }
    let dead = false;
    const t = setTimeout(async () => {
      try {
        const r = await make();
        if (!dead) setReqRes({ checks: check(req, r.width, r.height, r.blob.size, `image/${format}`), padded: r.padded, reached: r.fits });
      } catch { /* a failed encode is reported by Download */ }
    }, 400);
    return () => { dead = true; clearTimeout(t); };
  }, [layers, art, format, quality, outScale, sizeMode, targetVal, targetUnit, reqOn, req]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportImage = async (download: boolean) => {
    if (!layers.length) return;
    setWorking(true);
    try {
      const r = await make();
      if (download) {
        const a = document.createElement("a");
        const url = URL.createObjectURL(r.blob);
        a.href = url;
        a.download = `image-edited.${format === "jpeg" ? "jpg" : format}`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
      const shrunk = sizeMode === "target" && r.scale < outScale / 100 - 0.005 ? ` · resolution reduced to ${Math.round(r.scale * 100)}% to fit` : "";
      const miss = sizeMode === "target" && !r.fits ? " · could not reach the target" : "";
      setExported(`${download ? "Saved" : "Estimated"}: ${r.width}×${r.height} px · ${fmtBytes(r.blob.size)}${shrunk}${miss}`);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  // ------------------------------------------------------------- panels
  const slider = (label: string, key: keyof Layer, min: number, max: number, unit = "%") => (
    <label className="ie-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} value={layer![key] as number} onChange={(e) => patch(layer!.id, { [key]: num(e.target.value) } as Partial<Layer>)} />
      <output>{Math.round(layer![key] as number)}{unit}</output>
    </label>
  );
  const field = (label: string, value: number, set: (v: number) => void, step = 1) => (
    <label className="ie-field">
      <span>{label}</span>
      <input type="number" step={step} value={Math.round(value * 100) / 100} disabled={layer?.locked} onChange={(e) => set(num(e.target.value, value))} />
    </label>
  );

  const setSize = (w: number, h: number) => layer && patch(layer.id, { w: Math.max(4, w), h: Math.max(4, h) });
  const ratio = layer ? layer.w / layer.h : 1;
  const crop = (i: number, v: number) => {
    if (!layer) return;
    const c = [...layer.crop] as Layer["crop"];
    c[i] = clamp(v, 0, 95);
    const opposite = i < 2 ? i + 2 : i - 2;
    if (c[i] + c[opposite] > 95) c[opposite] = 95 - c[i];
    // keep the visible part undistorted: the frame follows the new proportions
    const vw = 100 - c[0] - c[2], vh = 100 - c[1] - c[3];
    const pw = 100 - layer.crop[0] - layer.crop[2], ph = 100 - layer.crop[1] - layer.crop[3];
    patch(layer.id, { crop: c, w: Math.max(4, (layer.w * vw) / pw), h: Math.max(4, (layer.h * vh) / ph) });
  };

  const box = layer && {
    left: `${((layer.cx - layer.w / 2) / art.w) * 100}%`, top: `${((layer.cy - layer.h / 2) / art.h) * 100}%`,
    width: `${(layer.w / art.w) * 100}%`, height: `${(layer.h / art.h) * 100}%`, transform: `rotate(${layer.rot}deg)`,
  };

  return (
    <div className="ie">
      <div className="ie-bar">
        <button className="btn primary" onClick={() => fileNew.current?.click()}>＋ Upload / insert image</button>
        <button className="btn ghost" onClick={undo} disabled={!history.current.length} title="Ctrl+Z">↶ Undo</button>
        <button className="btn ghost" onClick={redo} disabled={!future.current.length} title="Ctrl+Y">↷ Redo</button>
        <span className="spacer" />
        <label className="ie-inline">Canvas
          <input type="number" value={art.w} min={16} max={MAX_ART} onChange={(e) => change(layers, { ...art, w: clamp(num(e.target.value, art.w), 16, MAX_ART) })} />×
          <input type="number" value={art.h} min={16} max={MAX_ART} onChange={(e) => change(layers, { ...art, h: clamp(num(e.target.value, art.h), 16, MAX_ART) })} />
        </label>
        <label className="ie-inline">Size
          <select value={presetKey} onChange={(e) => applyPreset(e.target.value)} aria-label="Preset size">
            <option value="" disabled>Choose a preset…</option>
            {PRESETS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
        <label className="ie-inline">Print
          <select value={dpi} onChange={(e) => { const v = num(e.target.value, 300); setDpi(v); if (presetKey) applyPreset(presetKey, v); }} aria-label="Print resolution">
            <option value={150}>150 dpi</option><option value={300}>300 dpi</option><option value={600}>600 dpi</option>
          </select>
        </label>
        <select value={presetFit} onChange={(e) => setPresetFit(e.target.value as "fill" | "fit")} aria-label="How the picture fits a preset">
          <option value="fill">Fill (crops edges)</option><option value="fit">Fit whole picture</option>
        </select>
        <button className="btn small" title="Swap portrait and landscape" onClick={() => { const v = !landscape; setLandscape(v); if (presetKey) applyPreset(presetKey, dpi, v); else change(layers, { ...art, w: art.h, h: art.w }); }}>⟲ Rotate size</button>
        {presetInfo && <span className="muted small">{presetInfo.unit === "mm" ? `${art.w}×${art.h} px at ${dpi} dpi` : "pixel size"}</span>}
        <label className="ie-inline">Background
          <select value={art.bg === "transparent" ? "transparent" : "color"} onChange={(e) => change(layers, { ...art, bg: e.target.value === "transparent" ? "transparent" : "#ffffff" })}>
            <option value="color">Colour</option><option value="transparent">Transparent</option>
          </select>
          {art.bg !== "transparent" && <input type="color" value={art.bg} onChange={(e) => setArt({ ...art, bg: e.target.value })} />}
        </label>
        <input ref={fileNew} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; addFiles(f); }} />
        <input ref={fileReplace} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) replace(f); }} />
      </div>
      {msg && <div className="error-banner" onClick={() => setMsg(null)}>{msg}</div>}

      <div className="ie-body">
        <section className="ie-stage" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}>
          {layers.length === 0 && (
            <div className="ie-empty" onClick={() => fileNew.current?.click()}>
              <div className="drop-icon">🖼</div>
              <div>Drop pictures here or click to upload</div>
              <div className="muted small">PNG, JPG, JPEG or WebP · everything stays in your browser</div>
            </div>
          )}
          <div className="ie-art" ref={wrap} style={{ aspectRatio: `${art.w} / ${art.h}`, width: `min(100%, ${Math.max(art.w, 480)}px, calc(78vh * ${art.w / art.h}))`, display: layers.length ? "block" : "none" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <canvas ref={canvas} />
            {layer && box && (
              <div className={"ie-box" + (layer.locked ? " locked" : "")} style={box}>
                {!layer.locked && cropMode && (["nw", "n", "ne", "e", "se", "s", "sw", "w"] as Edge[]).map((c) => (
                  <span key={c} className={"ie-handle crop c-" + c} onPointerDown={(e) => handleDown(e, "crop", c)} />
                ))}
                {!layer.locked && !cropMode && (["nw", "ne", "se", "sw"] as Corner[]).map((c) => (
                  <span key={c} className={"ie-handle c-" + c} onPointerDown={(e) => handleDown(e, "resize", c)} />
                ))}
                {!layer.locked && !cropMode && <span className="ie-rotate" onPointerDown={(e) => handleDown(e, "rotate")} title="Drag to rotate · Shift snaps to 15°" />}
              </div>
            )}
          </div>
        </section>

        <aside className="ie-side">
          <details open className="ie-req">
            <summary>Application requirements</summary>
            <label className="check-row"><input type="checkbox" checked={reqOn} onChange={(e) => { setReqOn(e.target.checked); if (e.target.checked) applyReq(req); }} /> Make my picture meet these limits</label>
            <select aria-label="Requirement" value="" onChange={(e) => { const r = [...TEMPLATES, ...saved].find((x) => x.name === e.target.value); if (r) { setReq({ ...r }); if (reqOn) applyReq(r); } }}>
              <option value="" disabled>Load a saved requirement…</option>
              {TEMPLATES.map((t) => <option key={t.name}>{t.name}</option>)}
              {saved.map((t) => <option key={t.name}>{t.name}</option>)}
            </select>
            <p className="muted small">Examples are only examples: copy the exact limits from your application's notification.</p>
            <div className="ie-grid">
              {reqField("Width", req.w, "w", req.unit === "mm" ? 0.5 : 1)}
              {reqField("Height", req.h, "h", req.unit === "mm" ? 0.5 : 1)}
              {reqField("Min size (KB)", req.minKB, "minKB")}
              {reqField("Max size (KB, 0 = none)", req.maxKB, "maxKB")}
            </div>
            <div className="ie-row">
              <select value={req.unit} onChange={(e) => updateReq({ unit: e.target.value as "px" | "mm" })} aria-label="Unit"><option value="px">pixels</option><option value="mm">millimetres</option></select>
              {req.unit === "mm" && <select value={req.dpi} onChange={(e) => updateReq({ dpi: num(e.target.value, 300) })} aria-label="Resolution"><option value={150}>150 dpi</option><option value={200}>200 dpi</option><option value={300}>300 dpi</option><option value={600}>600 dpi</option></select>}
              <select value={req.format} onChange={(e) => updateReq({ format: e.target.value as Req["format"] })} aria-label="Format"><option value="jpeg">JPG</option><option value="png">PNG</option><option value="webp">WebP</option></select>
              <span className="muted small">= {pixels(req).join("×")} px</span>
            </div>
            <div className="ie-row">
              <button className="btn small" onClick={() => {
                const name = prompt("Save these limits as:", req.name.replace(/ \(example\)$/, ""));
                if (name) persist([...saved.filter((x) => x.name !== name), { ...req, name }]);
              }}>Save these limits</button>
              {saved.some((x) => x.name === req.name) && <button className="btn small danger" onClick={() => persist(saved.filter((x) => x.name !== req.name))}>Delete saved</button>}
            </div>
            {reqOn && reqRes && (
              <>
                <ul className="ps-checks">{reqRes.checks.map((c) => <li key={c.label} className={c.ok ? "ok" : "bad"}><b>{c.ok ? "✓" : "✗"}</b> {c.label}: <span>{c.detail}</span></li>)}</ul>
                {reqRes.padded && <p className="muted small">Smaller than the minimum, so empty metadata was added to reach it. The picture itself is unchanged.</p>}
                {!reqRes.reached && <p className="muted small" style={{ color: "#d33" }}>Cannot get under {req.maxKB} KB at {pixels(req).join("×")} px. Check the limits or the format.</p>}
              </>
            )}
          </details>
          <h3>Layers</h3>
          {layers.length === 0 && <p className="muted small">No pictures yet.</p>}
          <ul className="ie-layers">
            {[...layers].reverse().map((l) => (
              <li key={l.id} className={l.id === sel ? "active" : ""}>
                <button className="ie-layer-name" onClick={() => setSel(l.id)}>{l.name}</button>
                <button className="btn ghost small" title={l.locked ? "Unlock position" : "Lock position"} onClick={() => patch(l.id, { locked: !l.locked })}>{l.locked ? "🔒" : "🔓"}</button>
              </li>
            ))}
          </ul>

          {layers.length > 2 && (
            <div className="ie-row">
              <button className="btn small" onClick={() => distribute("x")}>Distribute ↔</button>
              <button className="btn small" onClick={() => distribute("y")}>Distribute ↕</button>
            </div>
          )}

          {layer && (
            <>
              <details open>
                <summary>Resize &amp; position</summary>
                <div className="ie-grid">
                  {field("X", layer.cx - layer.w / 2, (v) => patch(layer.id, { cx: v + layer.w / 2 }))}
                  {field("Y", layer.cy - layer.h / 2, (v) => patch(layer.id, { cy: v + layer.h / 2 }))}
                  {field("Width", layer.w, (v) => setSize(v, lock ? v / ratio : layer.h))}
                  {field("Height", layer.h, (v) => setSize(lock ? v * ratio : layer.w, v))}
                </div>
                <label className="check-row"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} /> Keep aspect ratio</label>
                <div className="ie-row">
                  <button className="btn small" onClick={() => setSize(layer.w * 0.5, layer.h * 0.5)}>50%</button>
                  <button className="btn small" onClick={() => setSize(layer.w * 2, layer.h * 2)}>200%</button>
                  <button className="btn small" onClick={() => setSize(layer.src.width, layer.src.height)}>Original size</button>
                  <button className="btn small" onClick={() => { const k = Math.min(art.w / layer.w, art.h / layer.h); patch(layer.id, { w: layer.w * k, h: layer.h * k, cx: art.w / 2, cy: art.h / 2 }); }}>Fit canvas</button>
                </div>
                <div className="ie-row">
                  <button className="btn small" onClick={() => change(layers, { ...art, w: Math.round(layer.w), h: Math.round(layer.h) }) } title="Make the canvas exactly this picture's size">Canvas ← picture</button>
                </div>
              </details>

              <details open>
                <summary>Rotate &amp; flip</summary>
                <div className="ie-row">
                  <button className="btn small" onClick={() => patch(layer.id, { rot: (layer.rot + 270) % 360 })}>↺ 90°</button>
                  <button className="btn small" onClick={() => patch(layer.id, { rot: (layer.rot + 90) % 360 })}>↻ 90°</button>
                  <button className="btn small" onClick={() => patch(layer.id, { rot: (layer.rot + 180) % 360 })}>180°</button>
                  <button className="btn small" onClick={() => patch(layer.id, { flipH: !layer.flipH })}>⇆ Flip H</button>
                  <button className="btn small" onClick={() => patch(layer.id, { flipV: !layer.flipV })}>⇅ Flip V</button>
                </div>
                {slider("Angle", "rot", 0, 359, "°")}
              </details>

              <details open>
                <summary>Crop &amp; mask</summary>
                <div className="ie-row">
                  <button className={"btn small" + (cropMode ? " primary" : "")} onClick={() => setCropMode(!cropMode)}>{cropMode ? "✓ Done cropping" : "✂ Crop with mouse"}</button>
                </div>
                {cropMode && <p className="muted small">Drag the square handles on the edges and corners to cut the picture.</p>}
                <div className="ie-grid">
                  {field("Left %", layer.crop[0], (v) => crop(0, v))}
                  {field("Top %", layer.crop[1], (v) => crop(1, v))}
                  {field("Right %", layer.crop[2], (v) => crop(2, v))}
                  {field("Bottom %", layer.crop[3], (v) => crop(3, v))}
                </div>
                <div className="ie-row">
                  <button className="btn small" onClick={() => patch(layer.id, { crop: [0, 0, 0, 0], h: layer.h })}>Reset crop</button>
                  <select value={layer.mask} onChange={(e) => patch(layer.id, { mask: e.target.value as Mask })} aria-label="Mask shape">
                    <option value="none">No mask</option><option value="rounded">Rounded corners</option><option value="circle">Circle / oval</option>
                  </select>
                </div>
              </details>

              <details>
                <summary>Adjust</summary>
                {slider("Brightness", "brightness", 0, 200)}
                {slider("Contrast", "contrast", 0, 200)}
                {slider("Saturation", "saturation", 0, 300)}
                {slider("Opacity", "opacity", 0, 100)}
                {slider("Blur", "blur", 0, 20, "px")}
                <div className="ie-row">
                  <label className="check-row"><input type="checkbox" checked={layer.gray} onChange={(e) => patch(layer.id, { gray: e.target.checked })} /> Grayscale</label>
                  <label className="check-row"><input type="checkbox" checked={layer.bw} onChange={(e) => patch(layer.id, { bw: e.target.checked })} /> Black &amp; white</label>
                </div>
                <label className="ie-slider"><span>Sharpen</span>
                  <input type="range" min={0.1} max={1.5} step={0.1} value={sharp} onChange={(e) => setSharp(num(e.target.value))} />
                  <button className="btn small" onClick={() => patch(layer.id, { src: sharpen(layer.src, sharp) })}>Apply</button>
                </label>
                <label className="ie-slider"><span>Remove background</span>
                  <input type="range" min={5} max={60} value={tol} onChange={(e) => setTol(num(e.target.value))} />
                  <button className="btn small" onClick={() => patch(layer.id, { src: removeBackground(layer.src, tol) })}>Apply</button>
                </label>
                <p className="muted small">Background removal makes every colour close to the picture's corner colour transparent. It works best on plain backgrounds.</p>
              </details>

              <details>
                <summary>Border &amp; shadow</summary>
                {slider("Border", "border", 0, 60, "px")}
                <label className="ie-inline">Border colour <input type="color" value={layer.borderColor} onChange={(e) => patch(layer.id, { borderColor: e.target.value })} /></label>
                {slider("Shadow", "shadow", 0, 60, "px")}
              </details>

              <details open>
                <summary>Arrange</summary>
                <div className="ie-row">
                  <button className="btn small" onClick={() => align("left")}>⇤ Left</button>
                  <button className="btn small" onClick={() => align("hcenter")}>↔ Centre</button>
                  <button className="btn small" onClick={() => align("right")}>⇥ Right</button>
                </div>
                <div className="ie-row">
                  <button className="btn small" onClick={() => align("top")}>⤒ Top</button>
                  <button className="btn small" onClick={() => align("vmiddle")}>↕ Middle</button>
                  <button className="btn small" onClick={() => align("bottom")}>⤓ Bottom</button>
                </div>
                <div className="ie-row">
                  <button className="btn small" onClick={() => reorder(layer.id, "front")}>To front</button>
                  <button className="btn small" onClick={() => reorder(layer.id, "forward")}>Forward</button>
                  <button className="btn small" onClick={() => reorder(layer.id, "backward")}>Backward</button>
                  <button className="btn small" onClick={() => reorder(layer.id, "back")}>To back</button>
                </div>
              </details>

              <div className="ie-row">
                <button className="btn small" onClick={() => fileReplace.current?.click()}>Replace…</button>
                <button className="btn small" onClick={() => duplicate(layer)} title="Ctrl+D (or Ctrl+C then Ctrl+V)">Duplicate</button>
                <button className="btn small danger" onClick={() => remove(layer.id)} disabled={layer.locked}>Delete</button>
              </div>
            </>
          )}

          <details open className="ie-export">
            <summary>Download / convert</summary>
            <div className="ie-row">
              <select value={format} onChange={(e) => setFormat(e.target.value as Format)} aria-label="Format">
                <option value="png">PNG</option><option value="jpeg">JPG</option><option value="webp">WebP</option>
                <option value="pdf">PDF</option><option value="docx">Word</option>
              </select>
              <span className="muted small">{Math.round(art.w * outScale / 100)}×{Math.round(art.h * outScale / 100)} px</span>
            </div>
            <div className="ie-row">
              <label className="check-row"><input type="radio" checked={sizeMode === "quality"} onChange={() => setSizeMode("quality")} /> Choose quality</label>
              <label className="check-row"><input type="radio" checked={sizeMode === "target"} onChange={() => setSizeMode("target")} /> Set file size</label>
            </div>
            {sizeMode === "quality" && format !== "png" && (
              <label className="ie-slider"><span>Quality</span>
                <input type="range" min={10} max={100} value={quality} onChange={(e) => setQuality(num(e.target.value))} /><output>{quality}%</output></label>
            )}
            {sizeMode === "quality" && format === "png" && <p className="muted small">PNG is lossless, so its size depends on the resolution. Use JPG or WebP for smaller files, or set a file size.</p>}
            {sizeMode === "target" && (
              <>
                <div className="ie-row">
                  <span className="small">Make it at most</span>
                  <input type="number" min={1} value={targetVal} style={{ width: 80 }} onChange={(e) => setTargetVal(Math.max(1, num(e.target.value, targetVal)))} />
                  <select value={targetUnit} onChange={(e) => setTargetUnit(e.target.value as "KB" | "MB")} aria-label="Unit"><option>KB</option><option>MB</option></select>
                </div>
                <label className="ie-slider"><span>File size</span>
                  <input type="range" min={0} max={100} value={Math.round(clamp((Math.log(Math.max(targetKB, 5) / 5) / Math.log(1000)) * 100, 0, 100))}
                    onChange={(e) => setTargetKB(5 * Math.pow(1000, num(e.target.value) / 100))} /><output>{targetVal} {targetUnit}</output></label>
                <div className="ie-row">{[20, 50, 100, 200, 500].map((k) => <button key={k} className="btn small" onClick={() => { setTargetVal(k); setTargetUnit("KB"); }}>{k} KB</button>)}</div>
                <p className="muted small">The best quality that fits is used; if even the lowest quality is too big, the picture is made smaller.</p>
              </>
            )}
            <label className="ie-slider"><span>Resolution</span>
              <input type="range" min={10} max={200} value={outScale} onChange={(e) => setOutScale(num(e.target.value))} /><output>{outScale}%</output></label>
            <div className="ie-row">
              <button className="btn primary" onClick={() => exportImage(true)} disabled={!layers.length || working}>{working ? "Working…" : "⬇ Download " + (format === "pdf" ? "PDF" : format === "docx" ? "Word file" : "image")}</button>
              <button className="btn small" onClick={() => exportImage(false)} disabled={!layers.length || working}>Check size</button>
            </div>
            {exported && <p className="muted small">{exported}</p>}
          </details>
        </aside>
      </div>
    </div>
  );
}
