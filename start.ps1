$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

Write-Host "==> Building frontend..." -ForegroundColor Cyan
Push-Location "$root\frontend"
npm run build
Pop-Location

Write-Host "==> Starting Muri on http://localhost:8000 ..." -ForegroundColor Cyan
& "$root\muri\backend\venv\Scripts\python.exe" "$root\muri\backend\main.py"
