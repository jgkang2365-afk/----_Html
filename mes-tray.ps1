Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $projectDir "logs"
$stdoutLog = Join-Path $logDir "mes-daemon.log"
$stderrLog = Join-Path $logDir "mes-daemon-error.log"
$script:daemonProcess = $null
$script:allowRestart = $true

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-PythonCommand {
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($python) {
        return @{ File = $python.Source; Arguments = "`"$projectDir\mes_daemon.py`"" }
    }

    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        return @{ File = $py.Source; Arguments = "-3 `"$projectDir\mes_daemon.py`"" }
    }

    return $null
}

function Set-TrayStatus([string]$status, [string]$detail) {
    $script:statusItem.Text = "Status: $status"
    $script:notifyIcon.Text = "MES Sync - $status"

    if ($status -eq "Running") {
        $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Information
    } else {
        $script:notifyIcon.Icon = [System.Drawing.SystemIcons]::Error
    }

    if ($detail) {
        $script:notifyIcon.BalloonTipTitle = "MES Sync"
        $script:notifyIcon.BalloonTipText = $detail
    }
}

function Start-MesDaemon {
    if ($script:daemonProcess -and -not $script:daemonProcess.HasExited) {
        return
    }

    $pythonCommand = Get-PythonCommand
    if (-not $pythonCommand) {
        Set-TrayStatus "Error" "Python executable was not found."
        return
    }

    $env:MES_DAEMON_DRY_RUN = "false"
    try {
        $script:daemonProcess = Start-Process `
            -FilePath $pythonCommand.File `
            -ArgumentList $pythonCommand.Arguments `
            -WorkingDirectory $projectDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru
        Set-TrayStatus "Running" "MES daemon is waiting for requests."
    } catch {
        Set-TrayStatus "Error" "Failed to start MES daemon: $($_.Exception.Message)"
    }
}

function Stop-MesDaemon {
    if ($script:daemonProcess -and -not $script:daemonProcess.HasExited) {
        Stop-Process -Id $script:daemonProcess.Id -Force -ErrorAction SilentlyContinue
        $script:daemonProcess.WaitForExit(3000)
    }
    $script:daemonProcess = $null
}

$contextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$script:statusItem = New-Object System.Windows.Forms.ToolStripMenuItem
$script:statusItem.Enabled = $false
$contextMenu.Items.Add($script:statusItem) | Out-Null
$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem
$restartItem.Text = "Restart MES daemon"
$restartItem.Add_Click({
    Stop-MesDaemon
    Start-Sleep -Seconds 1
    Start-MesDaemon
})
$contextMenu.Items.Add($restartItem) | Out-Null

$logItem = New-Object System.Windows.Forms.ToolStripMenuItem
$logItem.Text = "Open daemon log"
$logItem.Add_Click({
    if (-not (Test-Path $stdoutLog)) {
        New-Item -ItemType File -Path $stdoutLog | Out-Null
    }
    Start-Process notepad.exe -ArgumentList "`"$stdoutLog`""
})
$contextMenu.Items.Add($logItem) | Out-Null

$folderItem = New-Object System.Windows.Forms.ToolStripMenuItem
$folderItem.Text = "Open project folder"
$folderItem.Add_Click({ Start-Process explorer.exe -ArgumentList "`"$projectDir`"" })
$contextMenu.Items.Add($folderItem) | Out-Null
$contextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null

$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem
$exitItem.Text = "Exit MES tray"
$exitItem.Add_Click({
    $script:allowRestart = $false
    Stop-MesDaemon
    $script:notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})
$contextMenu.Items.Add($exitItem) | Out-Null

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.ContextMenuStrip = $contextMenu
$script:notifyIcon.Visible = $true
$script:notifyIcon.Add_DoubleClick({
    $script:notifyIcon.ShowBalloonTip(3000)
})

Start-MesDaemon
$script:notifyIcon.ShowBalloonTip(3000)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if ($script:allowRestart -and
        (-not $script:daemonProcess -or $script:daemonProcess.HasExited)) {
        Set-TrayStatus "Restarting" "MES daemon stopped and will restart automatically."
        Start-MesDaemon
    }
})
$timer.Start()

[System.Windows.Forms.Application]::Run()

$timer.Stop()
$script:notifyIcon.Visible = $false
Stop-MesDaemon
