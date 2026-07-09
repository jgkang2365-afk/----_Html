Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $projectDir "logs"
$stdoutLog = Join-Path $logDir "server.log"
$stderrLog = Join-Path $logDir "server-error.log"
$script:serverProcess = $null
$script:allowRestart = $true

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-ServerPortProcess {
    try {
        $connection = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($connection) {
            return Get-Process -Id $connection.OwningProcess -ErrorAction SilentlyContinue
        }
    } catch {
        return $null
    }
    return $null
}

function Set-TrayStatus([string]$status, [string]$detail) {
    $script:statusItem.Text = "Status: $status"
    $script:notifyIcon.Text = "Journal Server - $status"

    if ($status -eq "Running") {
        $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
    } elseif ($status -eq "Starting" -or $status -eq "Restarting") {
        $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
    } else {
        $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Error
    }

    if ($detail) {
        $script:notifyIcon.BalloonTipTitle = "Journal Server"
        $script:notifyIcon.BalloonTipText = $detail
    }
}

function Start-JournalServer {
    $portProcess = Get-ServerPortProcess
    if ($portProcess -and -not $portProcess.HasExited) {
        Set-TrayStatus "Running" "The server is already listening on http://localhost:3000."
        return
    }

    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
        return
    }

    Set-TrayStatus "Starting" "Starting the local journal server."

    try {
        $script:serverProcess = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList "/c npm run dev:turbo" `
            -WorkingDirectory $projectDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru
    } catch {
        Set-TrayStatus "Error" "Failed to start server: $($_.Exception.Message)"
    }
}

function Stop-JournalServer {
    $portProcess = Get-ServerPortProcess
    if ($portProcess -and -not $portProcess.HasExited) {
        Stop-Process -Id $portProcess.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
        Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue
        $script:serverProcess.WaitForExit(3000)
    }
    $script:serverProcess = $null
}

function Open-LiveServerLog {
    if (-not (Test-Path $stdoutLog)) {
        New-Item -ItemType File -Path $stdoutLog | Out-Null
    }

    $command = "Get-Content -Path `"$stdoutLog`" -Tail 120 -Wait"
    Start-Process powershell.exe -ArgumentList "-NoExit", "-Command", $command
}

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$script:statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$script:statusItem.Enabled = $false
$contextMenu.Items.Add($script:statusItem) | Out-Null
$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$openSiteItem = New-Object System.Windows.Forms.ToolStripMenuItem
$openSiteItem.Text = "Open localhost:3000"
$openSiteItem.Add_Click({ Start-Process "http://localhost:3000" })
$contextMenu.Items.Add($openSiteItem) | Out-Null

$liveLogItem = New-Object System.Windows.Forms.ToolStripMenuItem
$liveLogItem.Text = "Open live server log"
$liveLogItem.Add_Click({ Open-LiveServerLog })
$contextMenu.Items.Add($liveLogItem) | Out-Null

$errorLogItem = New-Object System.Windows.Forms.ToolStripMenuItem
$errorLogItem.Text = "Open error log"
$errorLogItem.Add_Click({
    if (-not (Test-Path $stderrLog)) {
        New-Item -ItemType File -Path $stderrLog | Out-Null
    }
    Start-Process notepad.exe -ArgumentList "`"$stderrLog`""
})
$contextMenu.Items.Add($errorLogItem) | Out-Null

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "Restart server"
$restartItem.Add_Click({
    Set-TrayStatus "Restarting" "Restarting the local journal server."
    Stop-JournalServer
    Start-Sleep -Seconds 1
    Start-JournalServer
})
$contextMenu.Items.Add($restartItem) | Out-Null

$folderItem = New-Object System.Windows.Forms.ToolStripMenuItem
$folderItem.Text = "Open project folder"
$folderItem.Add_Click({ Start-Process explorer.exe -ArgumentList "`"$projectDir`"" })
$contextMenu.Items.Add($folderItem) | Out-Null
$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit server tray"
$exitItem.Add_Click({
    $script:allowRestart = $false
    Stop-JournalServer
    $script:notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($exitItem) | Out-Null

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.ContextMenuStrip = $contextMenu
$script:notifyIcon.Visible = $true
$script:notifyIcon.Add_DoubleClick({ Open-LiveServerLog })

Start-JournalServer
$script:notifyIcon.ShowBalloonTip(3000)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    $portProcess = Get-ServerPortProcess
    if ($portProcess -and -not $portProcess.HasExited) {
        Set-TrayStatus "Running" "The server is listening on http://localhost:3000."
        return
    }

    if ($script:allowRestart) {
        Set-TrayStatus "Restarting" "The server stopped and will restart automatically."
        Start-JournalServer
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

$timer.Stop()
$script:notifyIcon.Visible = $false
Stop-JournalServer
