import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { t, useLang } from "../i18n";
import {
  EMBLEMS, FRAMES, KINDS, KIND_ORDER, STYLE_PRESETS, THEMES, cutout, draw, printSheet, recordVideo, sizeOf,
  type StylePreset,
  type Frame,
  type Details, type Item, type Kind, type Lang, type Music, type Override, type Overrides, type Pic,
} from "../cards";
import {
  FESTIVALS, FESTIVAL_ORDER, OCCASIONS, OCCASION_ORDER, drawGreeting, drawParty, greetingSize, partySize,
  type FestivalId, type Greeting, type OccasionId, type Party,
} from "../posters";
import { jpegToPdf, zip } from "../wrap";
import { creativeApi } from "../api";

const STORE_CHANGED = "formeasy.creative.changedAt";

type Mode = "wedding" | "greeting" | "party";

const STORE = "formeasy.creative";
const STORE_G = "formeasy.creative.greeting";
const STORE_P = "formeasy.creative.party";
const STORE_E = "formeasy.creative.edits";
const STORE_M = "formeasy.creative.mode";

const later = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

const DEFAULTS: Details = {
  bride: "Ananya", groom: "Rohan", brideHi: "अनन्या", groomHi: "रोहन",
  brideParents: "Mr. & Mrs. Rajesh Sharma", groomParents: "Mr. & Mrs. Suresh Verma",
  host: "The Sharma & Verma families",
  venue: "Shubh Vatika Banquet Hall", address: "Civil Lines, Prayagraj",
  date: "", time: "19:00", events: {}, rsvp: "", qr: "", lang: "both", theme: "royal", blessing: true,
};
const G_DEFAULTS: Greeting = { festival: "diwali", from: "The Sharma family", message: "", lang: "both" };
const P_BASE: Party = {
  occasion: "birthday", name: "Aarav", nameHi: "आरव", number: "5", host: "", date: "", time: "18:00",
  venue: "Hotel Kanha Shyam", address: "Civil Lines, Prayagraj", rsvp: "", qr: "", lang: "both", theme: "blush",
};
/** Each occasion keeps its own details; these are the starting examples. */
const P_SAMPLE: Record<OccasionId, Partial<Party>> = {
  birthday: { name: "Aarav", nameHi: "आरव", number: "5" },
  anniversary: { name: "Rajesh & Sunita", nameHi: "राजेश और सुनीता", number: "25", time: "19:30", venue: "Hotel Grand Continental" },
  grihapravesh: { name: "The Sharma Family", nameHi: "शर्मा परिवार", number: "", time: "10:00", venue: "Our new home, 14 Ashok Nagar", address: "Prayagraj" },
  babyshower: { name: "Priya", nameHi: "प्रिया", number: "", time: "12:00", venue: "Sharma Niwas" },
  naming: { name: "Baby Sharma", nameHi: "शिशु शर्मा", number: "", time: "11:00", venue: "Sharma Niwas" },
  puja: { name: "The Sharma Family", nameHi: "शर्मा परिवार", number: "", time: "16:00", venue: "Sharma Niwas, 14 Ashok Nagar" },
  mundan: { name: "Aarav", nameHi: "आरव", number: "", time: "09:00", venue: "Shri Hanuman Mandir" },
  upanayan: { name: "Chi. Aditya", nameHi: "चि. आदित्य", number: "", time: "08:00", venue: "Sharma Niwas" },
  inauguration: { name: "Sharma Sweets & Bakery", nameHi: "शर्मा स्वीट्स एंड बेकरी", number: "", time: "10:30", venue: "Shop 3, Civil Lines Market" },
  retirement: { name: "Shri Ramesh Sharma", nameHi: "श्री रमेश शर्मा", number: "35", time: "18:30", venue: "Hotel Kanha Shyam" },
  sangeet: { name: "Ananya & Rohan", nameHi: "अनन्या और रोहन", number: "", time: "19:00", venue: "Shubh Vatika Banquet Hall" },
  prayer: { name: "Late Shri Mohan Lal Sharma", nameHi: "स्व. श्री मोहन लाल शर्मा", number: "", time: "15:00", venue: "Arya Samaj Bhawan" },
};
const partiesDefault = (): Record<OccasionId, Party> => Object.fromEntries(OCCASION_ORDER.map((o) => [o, {
  ...P_BASE, ...P_SAMPLE[o], occasion: o, theme: OCCASIONS[o].defaultTheme, date: later(14),
}])) as Record<OccasionId, Party>;

function loadParties(): Record<OccasionId, Party> {
  const all = partiesDefault();
  try {
    const raw = localStorage.getItem(STORE_P);
    if (!raw) return all;
    const v = JSON.parse(raw);
    if (v && typeof v === "object" && "occasion" in v) return { ...all, [v.occasion]: { ...all[v.occasion as OccasionId], ...v } }; // old single-party layout
    for (const o of OCCASION_ORDER) if (v?.[o]) all[o] = { ...all[o], ...v[o], occasion: o };
  } catch { /* storage unavailable */ }
  return all;
}

function load<T>(key: string, defaults: T, fill?: (v: T) => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return fill ? fill(defaults) : defaults;
}
function keep(key: string, v: unknown) { try { localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* storage unavailable */ } }

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Could not export"))), type, q));
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const clean = (s: string) => s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "design";

/** One design the stage can show, export and edit. */
interface Design {
  id: string;
  label: string;
  size: (vertical: boolean) => [number, number];
  paint: (ctx: CanvasRenderingContext2D, vertical: boolean, ov?: Overrides) => Item[];
  canVertical: boolean;
  sizeLabel: string;
  /** finished size for a print shop (inches) and the resolution to print at */
  print: [number, number, number];
}

const EVENTS: Kind[] = KIND_ORDER.filter((k) => KINDS[k].event);

export default function Creative() {
  useLang();
  const [mode, setMode] = useState<Mode>(() => { try { const m = localStorage.getItem(STORE_M); return m === "greeting" || m === "party" ? m : "wedding"; } catch { return "wedding"; } });
  const [d, setD] = useState<Details>(() => load(STORE, DEFAULTS, (v) => ({ ...v, date: later(60) })));
  const [g, setG] = useState<Greeting>(() => load(STORE_G, G_DEFAULTS));
  const [parties, setParties] = useState<Record<OccasionId, Party>>(loadParties);
  const [occasion, setOccasion] = useState<OccasionId>(() => { try { const o = localStorage.getItem(STORE_P + ".current"); return o && o in OCCASIONS ? o as OccasionId : "birthday"; } catch { return "birthday"; } });
  const p = parties[occasion];
  const [edits, setEdits] = useState<Record<string, Overrides>>(() => load(STORE_E, {}));
  const [current, setCurrent] = useState<Record<Mode, string>>({ wedding: "wedding", greeting: g.festival, party: occasion });
  const [vertical, setVertical] = useState(false);
  const [photo, setPhoto] = useState<Pic | null>(null);
  const [original, setOriginal] = useState<Pic | null>(null);
  const [cutTol, setCutTol] = useState(30);
  const [pack, setPack] = useState<Kind[]>(KIND_ORDER);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [videoSecs, setVideoSecs] = useState(15);
  const [music, setMusic] = useState<"none" | "shehnai" | "bells" | "dhol" | "file">("shehnai");
  const [song, setSong] = useState<{ name: string; data: ArrayBuffer } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [, setFontsTick] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textBox = useRef<HTMLInputElement>(null);
  const items = useRef<Item[]>([]);
  const drag = useRef<{ id: string; x: number; y: number; dx: number; dy: number; moved: boolean } | null>(null);
  const thumbs = useRef<Record<string, HTMLCanvasElement | null>>({});

  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((x) => ({ ...x, [k]: v }));
  const setGP = <K extends keyof Greeting>(k: K, v: Greeting[K]) => setG((x) => ({ ...x, [k]: v }));
  const setPP = <K extends keyof Party>(k: K, v: Party[K]) => setParties((all) => ({ ...all, [occasion]: { ...all[occasion], [k]: v } }));
  const setEvent = (k: Kind, field: "date" | "time" | "venue", v: string) =>
    setD((x) => ({ ...x, events: { ...x.events, [k]: { date: "", time: "", venue: "", ...x.events[k], [field]: v } } }));

  useEffect(() => keep(STORE, d), [d]);
  useEffect(() => keep(STORE_G, g), [g]);
  useEffect(() => keep(STORE_P, parties), [parties]);
  useEffect(() => keep(STORE_P + ".current", occasion), [occasion]);
  useEffect(() => keep(STORE_E, edits), [edits]);
  useEffect(() => keep(STORE_M, mode), [mode]);

  // ------------------------------------------------------------ keep the details on the server too
  // (this browser, or the account when signed in, so they open on another device; photos stay here)
  const [sync, setSync] = useState<"loading" | "saving" | "saved" | "local">("loading");
  const loaded = useRef(false);
  const first = useRef(true);
  const latest = useRef({ d, g, parties, edits });
  latest.current = { d, g, parties, edits };
  useEffect(() => {
    let gone = false;
    creativeApi.get().then((remote) => {
      if (gone) return;
      const localAt = (() => { try { return localStorage.getItem(STORE_CHANGED) ?? ""; } catch { return ""; } })();
      if (remote && remote.updatedAt > localAt) {
        const r = remote.data as { d?: Details; g?: Greeting; parties?: Record<OccasionId, Party>; edits?: Record<string, Overrides> };
        if (r.d) setD((x) => ({ ...x, ...r.d }));
        if (r.g) setG((x) => ({ ...x, ...r.g }));
        if (r.parties) setParties((x) => { const n = { ...x }; for (const o of OCCASION_ORDER) if (r.parties![o]) n[o] = { ...x[o], ...r.parties![o], occasion: o }; return n; });
        if (r.edits) setEdits(r.edits);
        keep(STORE_CHANGED, remote.updatedAt);
        first.current = true; // the state just applied came from the server; do not send it back
      } else if (localAt) {
        // this browser has newer changes than the server: send them once
        creativeApi.put(latest.current).then((r) => keep(STORE_CHANGED, r.updatedAt)).catch(() => setSync("local"));
      }
      loaded.current = true;
      setSync("saved");
    }).catch(() => { loaded.current = true; setSync("local"); });
    return () => { gone = true; };
  }, []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    keep(STORE_CHANGED, new Date().toISOString());
    if (!loaded.current) return;
    setSync("saving");
    const timer = setTimeout(() => {
      creativeApi.put({ d, g, parties, edits })
        .then((r) => { keep(STORE_CHANGED, r.updatedAt); setSync("saved"); })
        .catch(() => setSync("local"));
    }, 1500);
    return () => clearTimeout(timer);
  }, [d, g, parties, edits]);
  // script / Devanagari fonts may arrive after the first paint
  useEffect(() => { document.fonts?.ready.then(() => setFontsTick((n) => n + 1)); }, []);

  // ------------------------------------------------------------ designs of the current mode
  const designs: Design[] = useMemo(() => {
    if (mode === "greeting") return FESTIVAL_ORDER.map((f) => ({
      id: f, label: FESTIVALS[f].en, size: greetingSize, canVertical: true, sizeLabel: "Square 1:1", print: [6, 6, 300],
      paint: (ctx, v, ov) => drawGreeting(ctx, { ...g, festival: f as FestivalId }, photo, v, ov),
    }));
    if (mode === "party") return OCCASION_ORDER.map((o) => ({
      id: o, label: OCCASIONS[o].en, size: partySize, canVertical: true, sizeLabel: "Card 5×7", print: [5, 7, 300],
      paint: (ctx, v, ov) => drawParty(ctx, parties[o as OccasionId], photo, v, ov),
    }));
    return KIND_ORDER.map((k) => ({
      id: k, label: KINDS[k].en, size: (v: boolean) => sizeOf(k, v && k !== "car"), canVertical: k !== "car",
      sizeLabel: k === "welcome" ? "Board 2:3" : k === "car" ? "Poster 3:1" : "Card 5×7",
      print: (k === "welcome" ? [24, 36, 150] : k === "car" ? [36, 12, 150] : [5, 7, 300]) as [number, number, number],
      paint: (ctx, v, ov) => draw(ctx, k, d, photo, v && k !== "car", ov),
    }));
  }, [mode, d, g, parties, photo]);

  const design = designs.find((x) => x.id === current[mode]) ?? designs[0];
  const vert = vertical && design.canVertical;
  const editKey = (id: string, v: boolean) => `${mode}:${id}${v ? ":v" : ""}`;
  const ov = edits[editKey(design.id, vert)] ?? {};
  const [w, h] = design.size(vert);

  const choose = (id: string) => {
    setCurrent((c) => ({ ...c, [mode]: id }));
    setSelected(null);
    if (mode === "greeting") setGP("festival", id as FestivalId);
    if (mode === "party") setOccasion(id as OccasionId);
  };

  // ------------------------------------------------------------ painting
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = w; c.height = h;
    const ctx = c.getContext("2d")!;
    items.current = design.paint(ctx, vert, ov);
    const sel = items.current.find((i) => i.id === selected);
    if (sel) {
      ctx.save();
      ctx.lineWidth = Math.max(2, w / 400);
      ctx.setLineDash([w / 90, w / 140]);
      ctx.strokeStyle = "#3d7bff";
      ctx.strokeRect(sel.x - 8, sel.y - 8, sel.w + 16, sel.h + 16);
      ctx.restore();
    }
  });
  useEffect(() => {
    for (const ds of designs) {
      const c = thumbs.current[ds.id];
      if (!c) continue;
      const [tw, th] = ds.size(false);
      const full = document.createElement("canvas");
      full.width = tw; full.height = th;
      ds.paint(full.getContext("2d")!, false, edits[editKey(ds.id, false)]);
      const k = 84 / Math.max(tw, th) * (tw > th ? 1 : th / tw > 1.3 ? 1.4 : 1.1);
      c.width = Math.round(tw * k); c.height = Math.round(th * k);
      c.getContext("2d")!.drawImage(full, 0, 0, c.width, c.height);
    }
  }, [designs, edits]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ on-card editing
  const setOv = (id: string, change: Override | null) => setEdits((all) => {
    const key = editKey(design.id, vert);
    const mine = { ...(all[key] ?? {}) };
    if (change === null) delete mine[id];
    else mine[id] = { ...mine[id], ...change };
    return { ...all, [key]: mine };
  });
  const resetDesign = () => { setEdits((all) => { const n = { ...all }; delete n[editKey(design.id, vert)]; return n; }); setSelected(null); };

  const point = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
  };
  const hit = (x: number, y: number) => {
    const pad = w / 100;
    for (let i = items.current.length - 1; i >= 0; i--) {
      const it = items.current[i];
      if (x >= it.x - pad && x <= it.x + it.w + pad && y >= it.y - pad && y <= it.y + it.h + pad) return it;
    }
    return null;
  };
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    const pt = point(e), it = hit(pt.x, pt.y);
    setSelected(it?.id ?? null);
    if (!it) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: it.id, x: pt.x, y: pt.y, dx: ov[it.id]?.dx ?? 0, dy: ov[it.id]?.dy ?? 0, moved: false };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const dr = drag.current;
    if (!dr) { e.currentTarget.style.cursor = hit(point(e).x, point(e).y) ? "move" : "default"; return; }
    const pt = point(e);
    const ddx = pt.x - dr.x, ddy = pt.y - dr.y;
    if (!dr.moved && Math.hypot(ddx, ddy) < w / 150) return;
    dr.moved = true;
    setOv(dr.id, { dx: Math.round(dr.dx + ddx), dy: Math.round(dr.dy + ddy) });
  };
  const onUp = () => { drag.current = null; };

  const sel = selected ? items.current.find((i) => i.id === selected) ?? null : null;
  const selOv = selected ? ov[selected] : undefined;
  const hidden = Object.entries(ov).filter(([, o]) => o.hidden).map(([id]) => id);
  const changed = Object.keys(ov).length > 0;
  const nudge = (k: "dx" | "dy", by: number) => selected && setOv(selected, { [k]: (selOv?.[k] ?? 0) + by });
  const onKey = (e: React.KeyboardEvent) => {
    if (!selected || (e.target as HTMLElement).tagName === "INPUT") return;
    const step = e.shiftKey ? 20 : 4;
    const map: Record<string, ["dx" | "dy", number]> = { ArrowLeft: ["dx", -step], ArrowRight: ["dx", step], ArrowUp: ["dy", -step], ArrowDown: ["dy", step] };
    if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
    if (e.key === "Delete") setOv(selected, { hidden: true });
    if (e.key === "Escape") setSelected(null);
  };

  // ------------------------------------------------------------ export
  const pickPhoto = (f: File | undefined) => {
    if (!f) return;
    const img = new Image();
    img.onload = () => { setPhoto(img); setOriginal(img); };
    img.src = URL.createObjectURL(f);
  };
  const pickSong = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) return alert(t("Choose a song file under 30 MB."));
    setSong({ name: f.name, data: await f.arrayBuffer() });
    setMusic("file");
  };

  const run = async (label: string, job: () => Promise<void>) => {
    setBusy(label);
    try { await job(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); setProgress(0); }
  };

  const renderDesign = (ds: Design, v: boolean) => {
    const [cw, ch] = ds.size(v);
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    ds.paint(c.getContext("2d")!, v, edits[editKey(ds.id, v)]);
    return c;
  };
  const base = () => mode === "wedding" ? `${clean(d.bride)}-${clean(d.groom)}` : mode === "party" ? clean(p.name) : clean(g.from);
  const fileName = (ds: Design, v: boolean, ext: string) => `${base()}-${ds.id}${v ? "-whatsapp" : ""}.${ext}`;

  const exportPrint = () => run(t("Preparing…"), async () => {
    const [wi, hi, dpi] = design.print;
    const [dw, dh] = design.size(false);
    const sheet = printSheet((ctx) => design.paint(ctx, false, edits[editKey(design.id, false)]), dw, dh, [wi, hi], dpi);
    const jpg = await bytes(await toBlob(sheet.canvas, "image/jpeg", 0.95));
    save(jpegToPdf(jpg, sheet.canvas.width, sheet.canvas.height, [sheet.wPt, sheet.hPt]), fileName(design, false, "print-shop.pdf"));
  });

  const exportOne = (fmt: "png" | "jpg" | "pdf") => run(t("Preparing…"), async () => {
    const c = renderDesign(design, vert);
    if (fmt === "png") return save(await toBlob(c, "image/png"), fileName(design, vert, "png"));
    const jpg = await toBlob(c, "image/jpeg", 0.92);
    if (fmt === "jpg") return save(jpg, fileName(design, vert, "jpg"));
    save(jpegToPdf(await bytes(jpg), c.width, c.height), fileName(design, vert, "pdf"));
  });

  const packDesigns = mode === "wedding" ? designs.filter((x) => pack.includes(x.id as Kind)) : designs;
  const exportPack = () => run(t("Making the package…"), async () => {
    const files: { name: string; data: Uint8Array }[] = [];
    for (const ds of packDesigns) {
      const c = renderDesign(ds, false);
      files.push({ name: `print/${fileName(ds, false, "png")}`, data: await bytes(await toBlob(c, "image/png")) });
      const jpg = await bytes(await toBlob(c, "image/jpeg", 0.92));
      files.push({ name: `pdf/${fileName(ds, false, "pdf")}`, data: await bytes(jpegToPdf(jpg, c.width, c.height)) });
      if (ds.canVertical) files.push({ name: `whatsapp/${fileName(ds, true, "jpg")}`, data: await bytes(await toBlob(renderDesign(ds, true), "image/jpeg", 0.9)) });
    }
    save(new Blob([zip(files)], { type: "application/zip" }), `${base()}-${mode === "wedding" ? "wedding-package" : mode === "greeting" ? "festival-greetings" : "invitations"}.zip`);
  });

  const exportVideo = () => run(t("Recording video…"), async () => {
    const chosen = mode === "wedding" ? packDesigns.filter((x) => x.canVertical) : [design];
    if (!chosen.length) throw new Error(t("Choose at least one card for the video."));
    const frames = chosen.map((x) => renderDesign(x, true));
    const m: Music = music === "none" ? { kind: "none" } : music === "file" ? (song ? { kind: "file", data: song.data } : { kind: "none" }) : { kind: "tune", tune: music };
    const petals = mode === "greeting" ? FESTIVALS[g.festival].petals : undefined;
    const { blob, ext } = await recordVideo(frames, videoSecs, setProgress, { music: m, petals });
    save(blob, `${base()}-${mode === "wedding" ? "invitation" : design.id}-video.${ext}`);
  });

  const togglePack = (k: Kind) => setPack((x) => (x.includes(k) ? x.filter((y) => y !== k) : KIND_ORDER.filter((y) => y === k || x.includes(y))));
  const preview = useMemo(() => ({ aspectRatio: `${w} / ${h}` }), [w, h]);
  const kind = design.id as Kind;
  const langSeg = (value: Lang, on: (v: Lang) => void) => (
    <div className="seg" role="radiogroup" aria-label={t("Language")}>
      {([["both", "Hindi + English"], ["hi", "हिंदी"], ["en", "English"]] as [Lang, string][]).map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => on(v)}>{t(l)}</button>
      ))}
    </div>
  );
  const themePick = (value: string, on: (v: string) => void) => (
    <div className="cs-themes" role="radiogroup" aria-label={t("Colour theme")}>
      {THEMES.map((th) => (
        <button key={th.id} role="radio" aria-checked={value === th.id} className={value === th.id ? "on" : ""} onClick={() => on(th.id)} title={th.name}>
          <span style={{ background: `linear-gradient(135deg, ${th.bg[0]}, ${th.bg[1]})`, borderColor: th.accent }} />
          {t(th.name)}
        </button>
      ))}
    </div>
  );
  // ready-made looks, previewed on the card being edited
  const presetThumbs = useRef<Record<string, HTMLCanvasElement | null>>({});
  useEffect(() => {
    if (mode !== "wedding") return;
    const timer = setTimeout(() => {
      const k = (design.id === "car" || design.id === "welcome" ? "wedding" : design.id) as Kind;
      for (const ps of STYLE_PRESETS) {
        const c = presetThumbs.current[ps.id];
        if (!c) continue;
        const full = document.createElement("canvas");
        const [fw, fh] = sizeOf(k);
        full.width = fw; full.height = fh;
        draw(full.getContext("2d")!, k, { ...d, theme: ps.theme, frame: ps.frame, emblem: ps.emblem }, photo, false);
        c.width = 108; c.height = Math.round((108 * fh) / fw);
        c.getContext("2d")!.drawImage(full, 0, 0, c.width, c.height);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [mode, d, photo, design.id]);
  const presetPick = (cur: Details, on: (ps: StylePreset) => void) => (
    <div className="cs-presets" role="radiogroup" aria-label={t("Ready-made looks")}>
      {STYLE_PRESETS.map((ps) => {
        const active = cur.theme === ps.theme && (cur.frame ?? "ornate") === ps.frame && (cur.emblem ?? "mandala") === ps.emblem;
        return (
          <button key={ps.id} role="radio" aria-checked={active} className={active ? "on" : ""} onClick={() => on(ps)} title={t(ps.name)}>
            <canvas ref={(el) => { presetThumbs.current[ps.id] = el; }} aria-hidden />
            <span>{t(ps.name)}</span>
          </button>
        );
      })}
    </div>
  );
  const framePick = (value: Frame, on: (v: Frame) => void) => (
    <div className="seg cs-frames" role="radiogroup" aria-label={t("Frame")}>
      {FRAMES.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => on(v)}>{t(l)}</button>
      ))}
    </div>
  );
  const photoPick = (
    <>
      <label className="cs-file">{photo ? t("Change photo") : t("Add a photo (optional)")}
        <input type="file" accept="image/*" onChange={(e) => pickPhoto(e.target.files?.[0])} />
      </label>
      {photo && (
        <div className="cs-photo-tools">
          <button className="btn small" onClick={() => original && setPhoto(cutout(original, cutTol))}>✂ {t("Remove photo background")}</button>
          <input type="range" min={0} max={100} value={cutTol} aria-label={t("How much to remove")} onChange={(e) => { const v = +e.target.value; setCutTol(v); if (original && photo !== original) setPhoto(cutout(original, v)); }} />
          {photo !== original && <button className="link" onClick={() => setPhoto(original)}>{t("Undo")}</button>}
          <button className="link" onClick={() => { setPhoto(null); setOriginal(null); }}>{t("Remove photo")}</button>
        </div>
      )}
    </>
  );

  return (
    <main className="home-wide cs">
      <div className="cs-intro">
        <h1>{t("Creative Studio")} <span className={`cs-sync ${sync}`} role="status">{
          sync === "saving" ? t("Saving…") : sync === "saved" ? "✓ " + t("Saved") : sync === "local" ? t("Saved on this device only") : ""
        }</span></h1>
        <div className="cs-modes" role="tablist">
          {([["wedding", "💍 Wedding cards"], ["greeting", "🪔 Festival greetings"], ["party", "🎂 Birthday & family events"]] as [Mode, string][]).map(([m, l]) => (
            <button key={m} role="tab" aria-selected={mode === m} className={mode === m ? "on" : ""} onClick={() => { setMode(m); setSelected(null); }}>{t(l)}</button>
          ))}
        </div>
        <p className="lede">{t(mode === "wedding"
          ? "Enter the wedding details once. Every card, the welcome board, the car poster, the thank-you card and the video come out matching."
          : mode === "greeting" ? "Pick a festival, add your name and share the greeting on WhatsApp, Instagram or print."
            : "Invitations for birthdays, anniversaries, griha pravesh, godh bharai and naming ceremonies.")}</p>
      </div>
      <div className="cs-body">
        <aside className="cs-side">
          {mode === "wedding" && <>
            <details open>
              <summary>{t("Couple")}</summary>
              <div className="cs-grid">
                <label>{t("Bride's name")}<input value={d.bride} onChange={(e) => set("bride", e.target.value)} /></label>
                <label>{t("Groom's name")}<input value={d.groom} onChange={(e) => set("groom", e.target.value)} /></label>
                <label>{t("Bride's name in Hindi")}<input lang="hi" value={d.brideHi} onChange={(e) => set("brideHi", e.target.value)} /></label>
                <label>{t("Groom's name in Hindi")}<input lang="hi" value={d.groomHi} onChange={(e) => set("groomHi", e.target.value)} /></label>
              </div>
              {photoPick}
            </details>
            <details open>
              <summary>{t("Families")}</summary>
              <label>{t("Bride's parents")}<input value={d.brideParents} onChange={(e) => set("brideParents", e.target.value)} /></label>
              <label>{t("Groom's parents")}<input value={d.groomParents} onChange={(e) => set("groomParents", e.target.value)} /></label>
              <label>{t("Invited by")}<input value={d.host} onChange={(e) => set("host", e.target.value)} /></label>
            </details>
            <details open>
              <summary>{t("Wedding day and venue")}</summary>
              <div className="cs-grid">
                <label>{t("Date")}<input type="date" value={d.date} onChange={(e) => set("date", e.target.value)} /></label>
                <label>{t("Time")}<input type="time" value={d.time} onChange={(e) => set("time", e.target.value)} /></label>
              </div>
              <label>{t("Venue")}<input value={d.venue} onChange={(e) => set("venue", e.target.value)} /></label>
              <label>{t("Address")}<input value={d.address} onChange={(e) => set("address", e.target.value)} /></label>
              <label>{t("RSVP phone")}<input inputMode="tel" value={d.rsvp} onChange={(e) => set("rsvp", e.target.value)} /></label>
              <label>{t("QR code link (Google Maps location or RSVP form)")}<input inputMode="url" placeholder="https://maps.app.goo.gl/…" value={d.qr} onChange={(e) => set("qr", e.target.value)} /></label>
            </details>
            <details>
              <summary>{t("Other ceremonies")}</summary>
              <p className="muted small">{t("Leave empty to use the wedding day and venue.")}</p>
              {EVENTS.filter((k) => k !== "wedding").map((k) => (
                <fieldset key={k} className="cs-event">
                  <legend>{t(KINDS[k].en)}</legend>
                  <div className="cs-grid">
                    <input type="date" aria-label={`${t(KINDS[k].en)} ${t("Date")}`} value={d.events[k]?.date ?? ""} onChange={(e) => setEvent(k, "date", e.target.value)} />
                    <input type="time" aria-label={`${t(KINDS[k].en)} ${t("Time")}`} value={d.events[k]?.time ?? ""} onChange={(e) => setEvent(k, "time", e.target.value)} />
                  </div>
                  <input placeholder={d.venue} aria-label={`${t(KINDS[k].en)} ${t("Venue")}`} value={d.events[k]?.venue ?? ""} onChange={(e) => setEvent(k, "venue", e.target.value)} />
                </fieldset>
              ))}
            </details>
            <details open>
              <summary>{t("Style")}</summary>
              {presetPick(d, (ps) => setD((x) => ({ ...x, theme: ps.theme, frame: ps.frame, emblem: ps.emblem })))}
              <p className="cs-sub">{t("Colour")}</p>
              {themePick(d.theme, (v) => set("theme", v))}
              <p className="cs-sub">{t("Frame")}</p>
              {framePick(d.frame ?? "ornate", (v) => set("frame", v))}
              <p className="cs-sub">{t("Top ornament")}</p>
              <div className="seg cs-frames" role="radiogroup" aria-label={t("Top ornament")}>
                {EMBLEMS.map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={(d.emblem ?? "mandala") === v} className={(d.emblem ?? "mandala") === v ? "on" : ""} onClick={() => set("emblem", v)}>{t(l)}</button>
                ))}
              </div>
              {langSeg(d.lang, (v) => set("lang", v))}
              <label className="check"><input type="checkbox" checked={d.blessing} onChange={(e) => set("blessing", e.target.checked)} /> ॥ ॐ श्री गणेशाय नमः ॥</label>
            </details>
          </>}

          {mode === "greeting" && <>
            <details open>
              <summary>{t("Greeting")}</summary>
              <label>{t("From")}<input value={g.from} placeholder={t("Your name or family")} onChange={(e) => setGP("from", e.target.value)} /></label>
              <label>{t("Message (leave empty for the festival's own)")}
                <textarea rows={3} value={g.message} placeholder={FESTIVALS[g.festival].msgEn} onChange={(e) => setGP("message", e.target.value)} />
              </label>
              {photoPick}
            </details>
            <details open>
              <summary>{t("Style")}</summary>
              {langSeg(g.lang, (v) => setGP("lang", v))}
            </details>
          </>}

          {mode === "party" && <>
            <details open>
              <summary>{t(OCCASIONS[p.occasion].en)}</summary>
              <div className="cs-grid">
                <label>{t(OCCASIONS[p.occasion].nameLabel ?? "Name")}<input value={p.name} onChange={(e) => setPP("name", e.target.value)} /></label>
                <label>{t("In Hindi")}<input lang="hi" value={p.nameHi} onChange={(e) => setPP("nameHi", e.target.value)} /></label>
              </div>
              {OCCASIONS[p.occasion].numberLabel && (
                <label>{p.occasion === "birthday" ? t("Age (optional)") : p.occasion === "retirement" ? t("Years of service (optional)") : t("Years married (optional)")}<input inputMode="numeric" value={p.number} onChange={(e) => setPP("number", e.target.value)} /></label>
              )}
              <label>{t("Invited by")}<input value={p.host} onChange={(e) => setPP("host", e.target.value)} /></label>
              {photoPick}
            </details>
            <details open>
              <summary>{t("Day and venue")}</summary>
              <div className="cs-grid">
                <label>{t("Date")}<input type="date" value={p.date} onChange={(e) => setPP("date", e.target.value)} /></label>
                <label>{t("Time")}<input type="time" value={p.time} onChange={(e) => setPP("time", e.target.value)} /></label>
              </div>
              <label>{t("Venue")}<input value={p.venue} onChange={(e) => setPP("venue", e.target.value)} /></label>
              <label>{t("Address")}<input value={p.address} onChange={(e) => setPP("address", e.target.value)} /></label>
              <label>{t("RSVP phone")}<input inputMode="tel" value={p.rsvp} onChange={(e) => setPP("rsvp", e.target.value)} /></label>
              <label>{t("QR code link (Google Maps location or RSVP form)")}<input inputMode="url" placeholder="https://maps.app.goo.gl/…" value={p.qr} onChange={(e) => setPP("qr", e.target.value)} /></label>
            </details>
            <details open>
              <summary>{t("Style")}</summary>
              {themePick(p.theme, (v) => setPP("theme", v))}
              {framePick(p.frame ?? "ornate", (v) => setPP("frame", v))}
              {langSeg(p.lang, (v) => setPP("lang", v))}
            </details>
          </>}
        </aside>

        <section className="cs-stage" onKeyDown={onKey}>
          <div className="cs-kinds" role="tablist">
            {designs.map((ds) => (
              <button key={`${mode}-${ds.id}`} role="tab" aria-selected={design.id === ds.id} className={design.id === ds.id ? "on" : ""} onClick={() => choose(ds.id)}>
                <canvas ref={(el) => { thumbs.current[ds.id] = el; }} aria-hidden />
                <span>{t(ds.label)}</span>
              </button>
            ))}
          </div>
          <div className="cs-toolbar">
            {design.canVertical && (
              <div className="seg" role="radiogroup" aria-label={t("Size")}>
                <button role="radio" aria-checked={!vertical} className={!vertical ? "on" : ""} onClick={() => { setVertical(false); setSelected(null); }}>{t(design.sizeLabel)}</button>
                <button role="radio" aria-checked={vertical} className={vertical ? "on" : ""} onClick={() => { setVertical(true); setSelected(null); }}>{t("WhatsApp 9:16")}</button>
              </div>
            )}
            <span className="muted small">{w} × {h} px</span>
            <span className="spacer" />
            <button className="btn" disabled={!!busy} onClick={() => exportOne("png")}>PNG</button>
            <button className="btn" disabled={!!busy} onClick={() => exportOne("jpg")}>JPG</button>
            <button className="btn primary" disabled={!!busy} onClick={() => exportOne("pdf")}>{t("PDF for print")}</button>
            {!vert && <button className="btn" disabled={!!busy} onClick={exportPrint} title={t("Bleed + crop marks")}>{t("Print-shop PDF")}</button>}
          </div>
          <div className="cs-editbar" aria-live="polite">
            {sel ? (
              <>
                {!sel.box && (
                  <input ref={textBox} className="cs-text" value={selOv?.text ?? sel.text ?? ""} aria-label={t("Text")}
                    onChange={(e) => setOv(sel.id, { text: e.target.value })} />
                )}
                <button className="btn small" title={t("Smaller")} onClick={() => setOv(sel.id, { scale: +((selOv?.scale ?? 1) / 1.1).toFixed(3) })}>A−</button>
                <button className="btn small" title={t("Bigger")} onClick={() => setOv(sel.id, { scale: +((selOv?.scale ?? 1) * 1.1).toFixed(3) })}>A+</button>
                {!sel.box && (
                  <label className="cs-color" title={t("Colour")}>
                    <input type="color" value={selOv?.color ?? "#c8a24a"} onChange={(e) => setOv(sel.id, { color: e.target.value })} />
                  </label>
                )}
                <button className="btn small" onClick={() => { setOv(sel.id, { hidden: true }); setSelected(null); }}>{t("Hide")}</button>
                <button className="btn small" disabled={!selOv} onClick={() => setOv(sel.id, null)}>{t("Reset")}</button>
                <button className="btn small ghost" onClick={() => setSelected(null)}>✓ {t("Done")}</button>
              </>
            ) : (
              <span className="muted small">✋ {t("Click any text, photo or QR on the card to move, resize, recolour or rewrite it. Arrow keys nudge it.")}</span>
            )}
            {!sel && hidden.length > 0 && (
              <span className="small">{t("Hidden:")} {hidden.map((id) => <button key={id} className="link" onClick={() => setOv(id, { hidden: false })}>{id}</button>).reduce<React.ReactNode[]>((a, b, i) => (i ? [...a, ", ", b] : [b]), [])}</span>
            )}
            {!sel && changed && <button className="btn small ghost" onClick={resetDesign}>↺ {t("Undo all changes on this design")}</button>}
          </div>
          {mode === "wedding" && KINDS[kind]?.event && kind !== "wedding" && !d.events[kind]?.date && <p className="muted small cs-note">{t("Using the wedding date. Set this ceremony's own date under “Other ceremonies”.")}</p>}
          <div className="cs-canvas">
            <canvas ref={canvas} style={preview} aria-label={t(design.label)} tabIndex={0}
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
              onDoubleClick={() => textBox.current?.focus()} />
          </div>
        </section>

        <aside className="cs-side cs-pack">
          {mode === "wedding" ? <>
            <h2>{t("Complete wedding package")}</h2>
            <p className="muted small">{t("Every design in one ZIP: print PNG, PDF and a WhatsApp-size picture of each.")}</p>
            <ul className="cs-list">
              {KIND_ORDER.map((k) => (
                <li key={k}><label className="check"><input type="checkbox" checked={pack.includes(k)} onChange={() => togglePack(k)} /> {t(KINDS[k].en)}</label></li>
              ))}
            </ul>
            <button className="btn primary block" disabled={!!busy || !pack.length} onClick={exportPack}>⬇ {t("Download package (ZIP)")}</button>
          </> : <>
            <h2>{mode === "greeting" ? t("All festivals") : t("All occasions")}</h2>
            <p className="muted small">{t("Every design in one ZIP with your name: print PNG, PDF and WhatsApp size.")}</p>
            <button className="btn primary block" disabled={!!busy} onClick={exportPack}>⬇ {t("Download all (ZIP)")}</button>
          </>}
          <h2>{mode === "wedding" ? t("Invitation video") : t("Video for WhatsApp status")}</h2>
          <p className="muted small">{mode === "wedding" ? t("A vertical slideshow of the ticked cards with fades and falling petals, ready for WhatsApp status.") : t("This design with a slow zoom and falling petals.")}</p>
          <div className="seg" role="radiogroup" aria-label={t("Length")}>
            {[15, 30, 60].map((s) => (
              <button key={s} role="radio" aria-checked={videoSecs === s} className={videoSecs === s ? "on" : ""} onClick={() => setVideoSecs(s)}>{s} s</button>
            ))}
          </div>
          <label className="cs-music">{t("Music")}
            <select value={music} onChange={(e) => setMusic(e.target.value as typeof music)}>
              <option value="shehnai">{t("Shehnai tune (built in)")}</option>
              <option value="bells">{t("Temple bells (built in)")}</option>
              <option value="dhol">{t("Dhol beat (built in)")}</option>
              <option value="file" disabled={!song}>{song ? `🎵 ${song.name}` : t("Your song (choose below)")}</option>
              <option value="none">{t("No music")}</option>
            </select>
          </label>
          <label className="cs-file">{song ? t("Change song") : t("Use your own song (MP3, M4A)")}
            <input type="file" accept="audio/*" onChange={(e) => pickSong(e.target.files?.[0])} />
          </label>
          {music === "file" && <p className="muted small">{t("Use only music you have the right to share.")}</p>}
          <button className="btn block" disabled={!!busy} onClick={exportVideo}>🎬 {t("Make video")}</button>
          {busy && (
            <p className="cs-busy" role="status">
              {busy}{progress > 0 && ` ${Math.round(progress * 100)}%`}
              {progress > 0 && <progress value={progress} max={1} />}
              {progress > 0 && <span className="muted small">{t("Keep this tab open and visible until it finishes.")}</span>}
            </p>
          )}
          <p className="muted small">{t("Everything is made in your browser; nothing is uploaded.")}</p>
        </aside>
      </div>
    </main>
  );
}
