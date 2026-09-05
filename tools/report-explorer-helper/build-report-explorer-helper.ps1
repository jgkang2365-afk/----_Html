[CmdletBinding()]
param(
    [string]$PythonExecutable = '',
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'dist')
)

$python = if ($PythonExecutable) { $PythonExecutable } elseif (Get-Command python -ErrorAction SilentlyContinue) { (Get-Command python).Source } elseif (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { $null }
if (-not $python) {
    throw 'Python 실행 파일을 찾을 수 없습니다. Python 3를 설치한 뒤 다시 실행하세요.'
}

$distPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$workPath = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $distPath -Force | Out-Null

function Invoke-ReportExplorerPyInstaller([string]$Name, [string]$EntryPoint, [string[]]$ExtraArguments = @()) {
    $arguments = @('-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--noconsole', '--name', $Name,
        '--distpath', $distPath,
        '--workpath', $workPath,
        '--specpath', $workPath) + $ExtraArguments + @($EntryPoint)
    if ($python -eq 'py') {
        & py -3 @arguments
    } else {
        & $python @arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller 빌드에 실패했습니다: $Name"
    }
}

Invoke-ReportExplorerPyInstaller 'ReportExplorerHelper' (Join-Path $PSScriptRoot 'report_explorer_helper.py')
Invoke-ReportExplorerPyInstaller 'ReportExplorerUpdater' (Join-Path $PSScriptRoot 'report_explorer_updater.py')
$updaterExecutable = Join-Path $distPath 'ReportExplorerUpdater.exe'
if (-not (Test-Path -LiteralPath $updaterExecutable -PathType Leaf)) {
    throw "빌드된 ReportExplorerUpdater.exe를 찾을 수 없습니다: $updaterExecutable"
}
Invoke-ReportExplorerPyInstaller 'ReportExplorerSetup' (Join-Path $PSScriptRoot 'report_explorer_setup.py') @('--add-binary', "$updaterExecutable;.")
foreach ($requiredExecutable in @('ReportExplorerHelper.exe', 'ReportExplorerUpdater.exe', 'ReportExplorerSetup.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $distPath $requiredExecutable) -PathType Leaf)) {
        throw "빌드 결과를 찾을 수 없습니다: $requiredExecutable"
    }
}
Write-Output "Report Explorer Helper, Updater, Setup 빌드 완료: $distPath"
