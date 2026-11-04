# PDF Master - one-time setup + run (Windows PowerShell)
#   .\start.ps1          build the UI if needed and serve everything on http://localhost:8000
#   .\start.ps1 -Dev     API on :8000 plus Vite hot-reload UI on :5173
param([switch]$Dev)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$py = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    python -m venv (Join-Path $root "backend\.venv")
    & $py -m pip install -r (Join-Path $root "backend\requirements.txt")
}
Push-Location (Join-Path $root "web")
if (-not (Test-Path "node_modules")) { npm install }
if ($Dev) {
    Start-Process -NoNewWindow npm -ArgumentList "run", "dev"
} elseif (-not (Test-Path "dist")) {
    npm run build
}
Pop-Location
& $py -m uvicorn pdfmaster.api:app --app-dir (Join-Path $root "backend") --host 127.0.0.1 --port 8000
