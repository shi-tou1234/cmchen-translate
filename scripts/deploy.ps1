# 划译 · 一键部署 + 桌面快捷方式
# 部署到 %LOCALAPPDATA%\划译\app-<时间戳>（项目目录外，避开安全扫描器的目录锁），
# 每次部署先清掉旧版本目录（被锁的会跳过，重启后下次部署再清）。
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$exeName = [string]::Join('', @([char]0x5212, [char]0x8BD1))  # 划译
$base = Join-Path $env:LOCALAPPDATA $exeName
$exe = $null

# 0) 停掉正在运行的划译：按进程名强杀（该镜像名专属本应用），等到进程归零
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  $alive = Get-Process $exeName -ErrorAction SilentlyContinue
  if (-not $alive) { break }
  $alive | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 600
}

# 0b) 清理旧版本目录（被系统句柄锁死的会跳过，非致命）
if (Test-Path $base) {
  Get-ChildItem $base -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$rel = Join-Path $base ("app-" + $stamp)
New-Item -ItemType Directory -Force -Path $rel | Out-Null
$exe = Join-Path $rel ($exeName + '.exe')

# 1) Electron 运行时（任务 0 已解压到 node_modules\electron\dist）
Copy-Item -Recurse -Force (Join-Path $root 'node_modules\electron\dist\*') $rel
Rename-Item (Join-Path $rel 'electron.exe') ($exeName + '.exe')

# 1b) 把应用图标写进 exe 资源。rcedit 是老工具，中文路径会挂：一律经 ASCII 临时目录中转
$rcedit = Join-Path $root 'node_modules\electron-winstaller\vendor\rcedit.exe'
if (Test-Path $rcedit) {
  $tmpExe = Join-Path $env:TEMP 'huayi-icon-patch.exe'
  $tmpIco = Join-Path $env:TEMP 'huayi-app.ico'
  Copy-Item $exe $tmpExe -Force
  Copy-Item (Join-Path $root 'build\icon.ico') $tmpIco -Force
  & $rcedit $tmpExe --set-icon $tmpIco
  if ($LASTEXITCODE -ne 0) { throw 'rcedit 设置图标失败' }
  Move-Item $tmpExe $exe -Force
  Remove-Item $tmpIco -Force -ErrorAction SilentlyContinue
}

# 2) 应用源码（含图标产物与 OCR 脚本）
$app = Join-Path $rel 'resources\app'
New-Item -ItemType Directory -Force -Path $app | Out-Null
Copy-Item -Recurse -Force (Join-Path $root 'src') (Join-Path $app 'src')
Copy-Item -Recurse -Force (Join-Path $root 'build') (Join-Path $app 'build')
New-Item -ItemType Directory -Force -Path (Join-Path $app 'scripts') | Out-Null
Copy-Item -Force (Join-Path $root 'scripts\ocr.ps1') (Join-Path $app 'scripts\ocr.ps1')
Copy-Item -Force (Join-Path $root 'package.json') $app

# 3) 运行时依赖（koffi 的原生二进制在 @koromix 里，漏拷必报错）
$nm = Join-Path $app 'node_modules'
New-Item -ItemType Directory -Force -Path $nm | Out-Null
foreach ($d in @('uiohook-napi', 'koffi', 'node-gyp-build', '@koromix')) {
  Copy-Item -Recurse -Force (Join-Path $root "node_modules\$d") (Join-Path $nm $d)
}
if (-not (Test-Path (Join-Path $nm '@koromix\koffi-win32-x64'))) {
  throw 'FATAL: @koromix\koffi-win32-x64 未拷贝成功'
}

# 4) 桌面快捷方式（图标显式指向已嵌入图标的 exe）
$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = $ws.CreateShortcut((Join-Path $desktop ($exeName + '.lnk')))
$lnk.TargetPath = $exe
$lnk.WorkingDirectory = $rel
$lnk.IconLocation = ($exe + ',0')
$lnk.Description = '划译 · 划词翻译'
$lnk.Save()

# 5) 清理图标补丁与开发期的临时文件
foreach ($t in @('huayi-icon-patch.exe', 'huayi-app.ico', 'huayi-patch.exe', 'huayi-patch.ico', 'huayi-icon-check.png', 'huayi-ocr-spike.png')) {
  Remove-Item (Join-Path $env:TEMP $t) -Force -ErrorAction SilentlyContinue
}

# 6) 刷新系统图标缓存，桌面立即可见新图标
& ie4uinit.exe -show 2>$null

Write-Host ("DEPLOY OK -> " + $rel)
