# 用真实 SendInput 事件驱动双 Ctrl+C（SendKeys 底层走 SendInput，与物理键盘同路，
# 能被低级键盘钩子看见——用于验证划译的 double-copy 触发链路）
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^c')
Start-Sleep -Milliseconds 250
[System.Windows.Forms.SendKeys]::SendWait('^c')
Write-Host 'SENT double ctrl+c via SendInput'
