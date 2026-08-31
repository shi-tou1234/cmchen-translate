# 生成中英文测试图（spike-tesseract.js 使用；纯 ASCII + 中文绘图文字需 UTF-8 BOM）
Add-Type -AssemblyName System.Drawing
$p = Join-Path $env:TEMP 'huayi-tess-spike.png'
$bmp = New-Object System.Drawing.Bitmap(720, 200)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$f1 = New-Object System.Drawing.Font('Arial', 28)
$f2 = New-Object System.Drawing.Font('Microsoft YaHei', 28)
$g.DrawString('Hello Tesseract 123', $f1, [System.Drawing.Brushes]::Black, 20, 20)
$g.DrawString('划词翻译跨平台', $f2, [System.Drawing.Brushes]::Black, 20, 110)
$g.Dispose()
$bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host 'image generated'