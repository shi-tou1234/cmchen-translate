# OCR 尖峰测试：验证 Windows 自带 WinRT OCR 在本机可用。
# 步骤：用 System.Drawing 生成一张含中英文的测试图 -> WinRT OCR 识别 -> 输出结果。
# 运行：powershell -NoProfile -ExecutionPolicy Bypass -File scripts/spike-ocr.ps1

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Runtime.WindowsRuntime

# --- 1) 生成测试图 ---
$png = Join-Path $env:TEMP 'huayi-ocr-spike.png'
$bmp = New-Object System.Drawing.Bitmap(560, 160)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font('Microsoft YaHei', 22)
$g.DrawString('Hello World 123', $font, [System.Drawing.Brushes]::Black, 20, 20)
$g.DrawString('划词翻译测试', $font, [System.Drawing.Brushes]::Black, 20, 80)
$g.Dispose()
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host ("test image: " + $png)

# --- 2) WinRT 异步转同步的工具函数 ---
function Await($WinRtTask, $ResultType) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0].MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

# --- 3) 加载 WinRT 类型 ---
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

# --- 4) 可用引擎 ---
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
  Write-Host 'AVAILABLE ENGINES:'
  [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { Write-Host ("  " + $_.LanguageTag) }
  throw 'TryCreateFromUserProfileLanguages returned null - no OCR language pack'
}
Write-Host ("engine language: " + $engine.RecognizerLanguage.LanguageTag)

# --- 5) 识别 ---
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

Write-Host 'OCR RESULT:'
Write-Host $result.Text
Remove-Item $png -Force
