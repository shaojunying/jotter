# Builds Jotter and installs it for the current user (no admin needed):
#   - app files in %LOCALAPPDATA%\Programs\Jotter
#   - Start menu shortcut "Jotter"
#   - "Open with > Jotter" for .md / .markdown / .txt (does not change your default app)
# Run again after pulling changes to update. Use -Uninstall to remove (your notes and sessions stay).
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$dest = Join-Path $env:LOCALAPPDATA 'Programs\Jotter'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Jotter.lnk'
$exts = '.md', '.markdown', '.txt'

if (Get-Process Jotter -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$dest*" }) {
    throw 'Jotter 正在运行，请先关闭所有 Jotter 窗口再运行本脚本。'
}

function Register-OpenWith([string]$exe) {
    $app = 'HKCU:\Software\Classes\Applications\Jotter.exe'
    New-Item -Path "$app\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path "$app\shell\open\command" -Name '(default)' -Value "`"$exe`" `"%1`""
    Set-ItemProperty -Path $app -Name 'FriendlyAppName' -Value 'Jotter'
    New-Item -Path "$app\SupportedTypes" -Force | Out-Null
    foreach ($e in $exts) {
        Set-ItemProperty -Path "$app\SupportedTypes" -Name $e -Value ''
        New-Item -Path "HKCU:\Software\Classes\$e\OpenWithList\Jotter.exe" -Force | Out-Null
    }
}

function Unregister-OpenWith {
    Remove-Item 'HKCU:\Software\Classes\Applications\Jotter.exe' -Recurse -Force -ErrorAction SilentlyContinue
    foreach ($e in $exts) {
        Remove-Item "HKCU:\Software\Classes\$e\OpenWithList\Jotter.exe" -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if ($Uninstall) {
    Unregister-OpenWith
    Remove-Item $shortcut -Force -ErrorAction SilentlyContinue
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output "已卸载。笔记和会话数据仍在 $env:LOCALAPPDATA\Jotter（不需要可手动删除）。"
    return
}

Push-Location (Join-Path $PSScriptRoot 'web')
try {
    if (-not (Test-Path node_modules)) { npm install; if ($LASTEXITCODE) { throw 'npm install failed' } }
    node build.mjs; if ($LASTEXITCODE) { throw 'web build failed' }
} finally { Pop-Location }

$publish = Join-Path $PSScriptRoot 'dist'
if (Test-Path $publish) { Remove-Item $publish -Recurse -Force }
dotnet publish (Join-Path $PSScriptRoot 'src\Jotter\Jotter.csproj') -c Release -r win-x64 --self-contained false -o $publish -p:DebugType=none
if ($LASTEXITCODE) { throw 'dotnet publish failed' }

if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item "$publish\*" $dest -Recurse

$exe = Join-Path $dest 'Jotter.exe'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($shortcut)
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $dest
$lnk.IconLocation = "$exe,0"
$lnk.Description = 'Jotter Markdown 记事本'
$lnk.Save()

Register-OpenWith $exe
Write-Output "已安装到 $dest"
Write-Output '开始菜单里搜 "Jotter" 即可打开；右键 .md 文件 > 打开方式 也能选 Jotter。'
