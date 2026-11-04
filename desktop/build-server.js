// Freezes the Python engine into a standalone folder (backend/dist/pdfmaster-server)
// with PyInstaller, so the installer needs no Python on the user's machine.
const { execFileSync } = require("child_process");
const path = require("path");

const backend = path.resolve(__dirname, "..", "backend");
const py = path.join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const run = (args) => execFileSync(py, args, { cwd: backend, stdio: "inherit" });

run(["-m", "pip", "install", "-q", "pyinstaller==6.11.1"]);
run([
  "-m", "PyInstaller", "--noconfirm", "--clean", "--name", "pdfmaster-server", "--console",
  "--paths", backend,
  "--collect-all", "pikepdf", "--collect-all", "pypdfium2", "--collect-all", "pypdfium2_raw",
  "--collect-all", "numpy", "--collect-all", "uharfbuzz", "--collect-all", "freetype", "--collect-data", "fontTools",
  "--hidden-import", "uvicorn.logging", "--hidden-import", "uvicorn.loops.auto",
  "--hidden-import", "uvicorn.protocols.http.auto", "--hidden-import", "uvicorn.lifespan.on",
  path.join(backend, "pdfmaster", "__main__.py"),
]);
console.log("Engine built at backend/dist/pdfmaster-server");

// Bundle the Tesseract OCR runtime (exe + DLLs + English/Hindi models) so OCR works offline
// without a separate install. Training tools and docs are left out.
const tessSrc = process.env.PDFMASTER_TESSERACT_DIR || path.join(process.env.ProgramFiles || "C:/Program Files", "Tesseract-OCR");
const tessOut = path.join(backend, "dist", "tesseract");
const fs = require("fs");
if (!fs.existsSync(path.join(tessSrc, "tesseract.exe"))) {
  throw new Error(`Tesseract not found in ${tessSrc}. Install it (winget install UB-Mannheim.TesseractOCR) or set PDFMASTER_TESSERACT_DIR.`);
}
fs.rmSync(tessOut, { recursive: true, force: true });
fs.mkdirSync(path.join(tessOut, "tessdata"), { recursive: true });
for (const f of fs.readdirSync(tessSrc)) {
  if (f === "tesseract.exe" || f.toLowerCase().endsWith(".dll")) fs.copyFileSync(path.join(tessSrc, f), path.join(tessOut, f));
}
for (const sub of ["configs", "tessconfigs"]) {
  fs.cpSync(path.join(tessSrc, "tessdata", sub), path.join(tessOut, "tessdata", sub), { recursive: true });
}
const models = [path.join(tessSrc, "tessdata"), path.join(backend, "data", "tessdata")];
for (const lang of ["eng", "hin", "osd"]) {
  const src = models.map((d) => path.join(d, `${lang}.traineddata`)).find((p) => fs.existsSync(p));
  if (!src) throw new Error(`${lang}.traineddata not found in ${models.join(" or ")}`);
  fs.copyFileSync(src, path.join(tessOut, "tessdata", `${lang}.traineddata`));
}
console.log("Tesseract bundled at backend/dist/tesseract");
