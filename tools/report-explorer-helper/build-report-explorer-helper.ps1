[CmdletBinding()]
param()

$entryPoint = Join-Path $PSScriptRoot 'report_explorer_helper.py'
if (-not (Get-Command py -ErrorAction SilentlyContinue)) {
    throw 'Python Launcher(py)를 찾을 수 없습니다. Python 3를 설치한 뒤 다시 실행하세요.'
}

# PyInstaller는 빌드시에만 필요합니다. 런타임은 Python 표준 라이브러리만 사용합니다.
& py -3 -m PyInstaller --noconfirm --clean --onefile --name ReportExplorerHelper `
    --distpath (Join-Path $PSScriptRoot 'dist') `
    --workpath (Join-Path $PSScriptRoot 'build') `
    --specpath $PSScriptRoot `
    $entryPoint
if ($LASTEXITCODE -ne 0) {
    throw "PyInstaller 빌드에 실패했습니다. py -3 -m pip install --user pyinstaller 후 다시 실행하세요."
}
