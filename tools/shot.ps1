param(
  [int]$W = 1600,
  [int]$H = 900,
  [string]$Out = "C:\Users\HADI\AppData\Local\Temp\opencode\shots\shot.png",
  [string]$Url = "http://127.0.0.1:8080/",
  [int]$Wait = 2500
)
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
New-Item -ItemType Directory -Force (Split-Path $Out) | Out-Null
$profile = Join-Path $env:TEMP ("chromeshot-" + [guid]::NewGuid().ToString("N"))
& $chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars `
  --user-data-dir="$profile" `
  --force-device-scale-factor=1 `
  --window-size="$W,$H" --virtual-time-budget=$Wait `
  --screenshot="$Out" $Url 2>&1 | Out-Null
if (Test-Path $Out) { Write-Output ("$Out  " + (Get-Item $Out).Length) } else { Write-Output "FAILED" }
Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
