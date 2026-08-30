# 划译 · 完成条件验收（三条全过才算绿）
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$exeName = [string]::Join('', @([char]0x5212, [char]0x8BD1))  # 划译

Write-Host '=== ① 单元测试（node --test，要求 >=25 个、skipped=0） ==='
npm test
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL: npm test'; exit 1 }

Write-Host '=== ② 网关集成（真实调用，断言返回中文） ==='
node scripts/e2e-gateway.js
if ($LASTEXITCODE -ne 0) { Write-Host 'FAIL: e2e gateway'; exit 1 }

Write-Host '=== ③ 交付物存在（便携目录 + 单文件 exe） ==='
$appDir = Get-ChildItem (Join-Path $env:LOCALAPPDATA $exeName) -Directory -Filter 'app-*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $appDir) { Write-Host 'FAIL: 本地未部署（LOCALAPPDATA\划译\app-* 不存在）'; exit 1 }
$exe = Join-Path $appDir.FullName ($exeName + ".exe")
if (-not (Test-Path $exe)) { Write-Host ("FAIL: " + $exe + " 不存在"); exit 1 }
Write-Host ("OK: " + $exe)
$portable = Join-Path $root ("release-builder\" + $exeName + ".exe")
if (-not (Test-Path $portable)) { Write-Host ("FAIL: " + $portable + " 不存在"); exit 1 }
Write-Host ("OK: " + $portable)

Write-Host 'VERIFY ALL GREEN'
exit 0
