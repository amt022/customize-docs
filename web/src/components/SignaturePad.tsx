import { useEffect, useRef, useState } from "react";
import Dialog from "./Dialog";

/** Draw a signature (or upload an image); returns a transparent PNG data URL. */
export default function SignaturePad({ mode, onDone, onClose }: { mode: "signature" | "image"; onDone: (dataUrl: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);
  const [color, setColor] = useState("#10247a");
  const [upload, setUpload] = useState<string | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = 520 * 2;
    c.height = 180 * 2;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const trimmed = (): string => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (data[(y * width + x) * 4 + 3] > 0) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
    const pad = 8;
    const out = document.createElement("canvas");
    out.width = Math.max(x1 - x0 + 2 * pad, 1);
    out.height = Math.max(y1 - y0 + 2 * pad, 1);
    out.getContext("2d")!.drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  };

  const readFile = (f: File) => {
    const r = new FileReader();
    r.onload = () => setUpload(String(r.result));
    r.readAsDataURL(f);
  };

  return (
    <Dialog
      title={mode === "signature" ? "Add signature" : "Add image"}
      onClose={onClose}
      width={580}
      footer={<>
        {mode === "signature" && <button className="btn" onClick={() => {
          const c = ref.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setEmpty(true);
          setUpload(null);
        }}>Clear</button>}
        <span className="spacer" />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={empty && !upload} onClick={() => onDone(upload ?? trimmed())}>Place on page</button>
      </>}
    >
      {mode === "signature" && (
        <>
          <p className="muted small">Sign in the box, then drag on the page where it should go.</p>
          <canvas
            ref={ref}
            className="sig-canvas"
            style={{ width: 520, height: 180, display: upload ? "none" : "block" }}
            onPointerDown={(e) => {
              drawing.current = true;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const ctx = ref.current!.getContext("2d")!;
              const [x, y] = pos(e);
              ctx.strokeStyle = color;
              ctx.lineWidth = 2.6;
              ctx.beginPath();
              ctx.moveTo(x, y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = ref.current!.getContext("2d")!;
              const [x, y] = pos(e);
              ctx.lineTo(x, y);
              ctx.stroke();
              setEmpty(false);
            }}
            onPointerUp={() => { drawing.current = false; }}
          />
          <div className="row gap" style={{ marginTop: 8 }}>
            <label className="small">Ink <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
            <span className="muted small">or</span>
            <label className="btn small">Upload image<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} /></label>
          </div>
        </>
      )}
      {mode === "image" && !upload && (
        <label className="drop small-drop">Choose a PNG or JPEG<input type="file" accept="image/png,image/jpeg" hidden onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} /></label>
      )}
      {upload && <img src={upload} alt="Preview" className="sig-preview" />}
    </Dialog>
  );
}
