# Starts a Debug build of Jotter against a throwaway data folder with the
# DevTools port open, so tools/cdp.mjs can drive it. Does not touch your real sessions.
param(
    [int]$Port = 9333,
    [string]$DataDir = (Join-Path $env:TEMP 'jotter-test\data'),
    [string[]]$Files = @()
)
$exe = Join-Path $PSScriptRoot '..\src\Jotter\bin\Debug\net10.0-windows\Jotter.exe'
$env:JOTTER_DATA_DIR = $DataDir
$env:JOTTER_DEVTOOLS = '1'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
$exePath = (Resolve-Path $exe).Path
if ($Files.Count -gt 0) {
    Start-Process -FilePath $exePath -ArgumentList ($Files | ForEach-Object { '"' + $_ + '"' })
} else {
    Start-Process -FilePath $exePath
}
