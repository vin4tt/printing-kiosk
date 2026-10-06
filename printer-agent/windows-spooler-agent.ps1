# Smart Print Kiosk — Windows Print Spooler Agent
# Run on Windows 10/11 Kiosk Terminal with Administrator privileges.
param (
    [string]$BackendUrl = "http://localhost:3000",
    [string]$KioskId = "KSK-001",
    [string]$TargetPrinter = "",
    [int]$PollIntervalSeconds = 3
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  SMART PRINT KIOSK - WINDOWS PRINT SPOOLER DAEMON        " -ForegroundColor Green
Write-Host "  Connecting Kiosk: $KioskId to $BackendUrl               " -ForegroundColor Yellow
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Enumerate Windows Printers
$Printers = Get-CimInstance Win32_Printer
Write-Host "[Hardware Detection] Installed Windows Printers:" -ForegroundColor White
foreach ($p in $Printers) {
    Write-Host "  * $($p.Name) [Status: $($p.PrinterStatus)] Port: $($p.PortName) Default: $($p.Default)" -ForegroundColor Gray
}

if (-not $TargetPrinter) {
    $DefaultPrinter = ($Printers | Where-Object { $_.Default -eq $true } | Select-Object -First 1).Name
    if ($DefaultPrinter) {
        $TargetPrinter = $DefaultPrinter
        Write-Host "[Auto-Select] Using Windows Default Printer: $TargetPrinter" -ForegroundColor Green
    } else {
        $TargetPrinter = ($Printers | Select-Object -First 1).Name
        Write-Host "[Auto-Select] Using First Available Printer: $TargetPrinter" -ForegroundColor Yellow
    }
}

# 2. Main Daemon Loop
$SpoolDir = "$env:TEMP\SmartPrintSpool"
if (-not (Test-Path $SpoolDir)) {
    New-Item -ItemType Directory -Path $SpoolDir -Force | Out-Null
}

Write-Host "[Agent Running] Polling for authenticated paid jobs..." -ForegroundColor Cyan

while ($true) {
    try {
        # Check printer hardware status (Paper jam, Offline, Out of Paper)
        $PrinterObj = Get-CimInstance Win32_Printer -Filter "Name='$TargetPrinter'"
        $PrinterState = "READY"
        if ($PrinterObj.WorkOffline) {
            $PrinterState = "OFFLINE"
        } elseif ($PrinterObj.PrinterStatus -eq 4) { # Printing
            $PrinterState = "PRINTING"
        } elseif ($PrinterObj.PrinterStatus -eq 5) { # Paper Jam
            $PrinterState = "PAPER_JAM"
        } elseif ($PrinterObj.PrinterStatus -eq 7) { # Out of Paper
            $PrinterState = "OUT_OF_PAPER"
        }

        # Send heartbeat to Kiosk API
        $HeartbeatBody = @{
            kioskId = $KioskId
            printerName = $TargetPrinter
            printerStatus = $PrinterState
        } | ConvertTo-Json

        Invoke-RestMethod -Uri "$BackendUrl/api/printers/heartbeat" -Method Post -Body $HeartbeatBody -ContentType "application/json" -TimeoutSec 5 -ErrorAction SilentlyContinue | Out-Null

    } catch {
        # Silent error in daemon loop
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}
