param(
  [string]$Python = "py",
  [string]$PythonVersion = "3.12",
  [string]$PythonPath = "",
  [string]$OutputDirectory = "",
  [string]$WorkingDirectory = ""
)

$ErrorActionPreference = "Stop"
$engineDir = $PSScriptRoot
$venvPython = Join-Path $engineDir ".venv\Scripts\python.exe"

if ($PythonPath) {
  if (-not (Test-Path $PythonPath)) {
    throw "The specified Python executable was not found: $PythonPath"
  }
  $venvPython = $PythonPath
} elseif (-not (Test-Path $venvPython)) {
  & $Python "-$PythonVersion" -m venv (Join-Path $engineDir ".venv")
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the speech-engine build environment."
  }
}

& $venvPython -m pip install -r (Join-Path $engineDir "requirements.txt")
if ($LASTEXITCODE -ne 0) {
  throw "Could not install the speech-engine build dependencies."
}

$distDir = if ($OutputDirectory) {
  $OutputDirectory
} else {
  Join-Path $engineDir "dist"
}
$workDir = if ($WorkingDirectory) {
  $WorkingDirectory
} else {
  Join-Path $engineDir ".build"
}
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

& $venvPython -m PyInstaller `
  --noconfirm `
  --clean `
  --onedir `
  --name milly-tts `
  --distpath $distDir `
  --workpath $workDir `
  --specpath $engineDir `
  --collect-all kokoro_onnx `
  --collect-all phonemizer `
  --collect-all espeakng_loader `
  --collect-binaries onnxruntime `
  (Join-Path $engineDir "engine.py")

if ($LASTEXITCODE -ne 0) {
  throw "PyInstaller could not build the standalone speech engine."
}

Write-Output "Built $distDir\milly-tts\milly-tts.exe"
