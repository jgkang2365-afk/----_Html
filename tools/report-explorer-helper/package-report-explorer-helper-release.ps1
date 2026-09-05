[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('stable', 'pilot')][string]$Channel,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [string]$InputDirectory = (Join-Path $PSScriptRoot 'dist'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'release')
)

$python = if (Get-Command python -ErrorAction SilentlyContinue) { (Get-Command python).Source } elseif (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { $null }
if (-not $python) { throw 'Python 3 is required to read the canonical release version.' }
$versionProbe = @(
    '-c',
    'import json,sys; sys.path.insert(0, sys.argv[1]); import report_explorer_versions as v; assert len({v.RELEASE_VERSION, v.HELPER_VERSION, v.UPDATER_VERSION, v.SETUP_VERSION}) == 1; print(json.dumps({"releaseVersion":v.RELEASE_VERSION,"protocolVersion":v.PROTOCOL_VERSION,"helperVersion":v.HELPER_VERSION,"updaterVersion":v.UPDATER_VERSION,"setupVersion":v.SETUP_VERSION}))',
    $PSScriptRoot
)
$versionJson = if ($python -eq 'py') { (& py -3 @versionProbe) } else { (& $python @versionProbe) }
if ($LASTEXITCODE -ne 0) { throw 'Canonical Report Explorer versions are invalid or differ.' }
$versions = $versionJson | ConvertFrom-Json
if ($versions.releaseVersion -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'Canonical release version is not semantic.' }


$inputPath = [System.IO.Path]::GetFullPath($InputDirectory)
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$helper = Join-Path $inputPath 'ReportExplorerHelper.exe'
$setup = Join-Path $inputPath 'ReportExplorerSetup.exe'
$updater = Join-Path $inputPath 'ReportExplorerUpdater.exe'
foreach ($asset in @($helper, $updater, $setup)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) {
        throw "Release asset is missing: $asset"
    }
}
$embeddedAssets = @($helper, $updater, $setup)
foreach ($asset in $embeddedAssets) {
    $embeddedVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($asset).ProductVersion
    if ($embeddedVersion -ne $versions.releaseVersion) {
        throw "Embedded version mismatch for $([IO.Path]::GetFileName($asset)): $embeddedVersion"
    }
}


$tag = if ($Channel -eq 'stable') { "report-explorer-helper-v$($versions.releaseVersion)" } else { "report-explorer-helper-pilot-v$($versions.releaseVersion)" }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$releaseHelper = Join-Path $outputPath 'ReportExplorerHelper.exe'
$releaseSetup = Join-Path $outputPath 'ReportExplorerSetup.exe'
Copy-Item -LiteralPath $helper -Destination $releaseHelper -Force
Copy-Item -LiteralPath $setup -Destination $releaseSetup -Force

$helperHash = (Get-FileHash -LiteralPath $releaseHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$setupHash = (Get-FileHash -LiteralPath $releaseSetup -Algorithm SHA256).Hash.ToLowerInvariant()
$helperSize = (Get-Item -LiteralPath $releaseHelper).Length
$setupSize = (Get-Item -LiteralPath $releaseSetup).Length
$manifest = [ordered]@{
    schemaVersion = 1
    product = 'ReportExplorerHelper'
    channel = $Channel
    releaseTag = $tag
    releaseVersion = $versions.releaseVersion
    protocolVersion = $versions.protocolVersion
    helperVersion = $versions.helperVersion
    updaterVersion = $versions.updaterVersion
    setupVersion = $versions.setupVersion
    helperSha256 = $helperHash
    helperSize = $helperSize
    setupSha256 = $setupHash
    setupSize = $setupSize
    sourceCommit = $SourceCommit
    publishedAt = [DateTime]::UtcNow.ToString('o')
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $outputPath 'SHA256SUMS.txt'), "$helperHash  ReportExplorerHelper.exe`n$setupHash  ReportExplorerSetup.exe`n", $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $outputPath 'release.json'), ($manifest | ConvertTo-Json -Depth 4 -Compress) + "`n", $utf8NoBom)
Write-Output "Release assets prepared for ${tag}: $outputPath"
