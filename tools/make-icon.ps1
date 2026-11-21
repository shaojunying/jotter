# Draws the Jotter icon (a note page with text lines and a "J" badge) and writes
# src/Jotter/jotter.ico with PNG-compressed frames. Run with Windows PowerShell 5.1.
param([string]$OutFile = (Join-Path $PSScriptRoot '..\src\Jotter\jotter.ico'))

Add-Type -AssemblyName System.Drawing

function New-Frame([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.TextRenderingHint = 'AntiAliasGridFit'
    $s = $size / 64.0

    # rounded page
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 12 * $s; $x = 6 * $s; $y = 4 * $s; $w = 52 * $s; $h = 56 * $s
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.PointF 0, 0), (New-Object System.Drawing.PointF 0, $size),
        [System.Drawing.Color]::FromArgb(255, 70, 132, 238), [System.Drawing.Color]::FromArgb(255, 38, 92, 200))
    $g.FillPath($brush, $path)

    # text lines
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(235, 255, 255, 255)), ([Math]::Max(1.5, 4 * $s))
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
    foreach ($ly in 18, 28, 38) {
        $end = if ($ly -eq 38) { 34 } else { 46 }
        $g.DrawLine($pen, 16 * $s, $ly * $s, $end * $s, $ly * $s)
    }
    # pen nib accent
    $nib = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 196, 61))
    $g.FillEllipse($nib, 38 * $s, 40 * $s, 14 * $s, 14 * $s)

    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    return , $ms.ToArray()
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$frames = foreach ($sz in $sizes) { , (New-Frame $sz) }

$ico = New-Object System.IO.MemoryStream
$bw = [System.IO.BinaryWriter]::new($ico)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $sz = $sizes[$i]; $data = $frames[$i]
    $dim = if ($sz -ge 256) { 0 } else { $sz }
    $bw.Write([byte]$dim); $bw.Write([byte]$dim); $bw.Write([byte]0); $bw.Write([byte]0)
    $bw.Write([UInt16]1); $bw.Write([UInt16]32)
    $bw.Write([UInt32]$data.Length); $bw.Write([UInt32]$offset)
    $offset += $data.Length
}
foreach ($data in $frames) { $bw.Write($data) }
$bw.Flush()
[System.IO.File]::WriteAllBytes([System.IO.Path]::GetFullPath($OutFile), $ico.ToArray())
Write-Output "wrote $OutFile ($($ico.Length) bytes)"
