[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$HelperVersion,
    [Parameter(Mandatory = $true)][ValidateSet('stable', 'pilot')][string]$Channel,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$SourceCommit,
    [string]$InputDirectory = (Join-Path $PSScriptRoot 'dist'),
    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'release')
)

$inputPath = [System.IO.Path]::GetFullPath($InputDirectory)
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$helper = Join-Path $inputPath 'ReportExplorerHelper.exe'
$setup = Join-Path $inputPath 'ReportExplorerSetup.exe'
foreach ($asset in @($helper, $setup)) {
    if (-not (Test-Path -LiteralPath $asset -PathType Leaf)) {
        throw "Release asset is missing: $asset"
    }
}

$tag = if ($Channel -eq 'stable') { "report-explorer-helper-v$HelperVersion" } else { "report-explorer-helper-pilot-v$HelperVersion" }
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
$releaseHelper = Join-Path $outputPath 'ReportExplorerHelper.exe'
$releaseSetup = Join-Path $outputPath 'ReportExplorerSetup.exe'
Copy-Item -LiteralPath $helper -Destination $releaseHelper -Force
Copy-Item -LiteralPath $setup -Destination $releaseSetup -Force

$helperHash = (Get-FileHash -LiteralPath $releaseHelper -Algorithm SHA256).Hash.ToLowerInvariant()
$setupHash = (Get-FileHash -LiteralPath $releaseSetup -Algorithm SHA256).Hash.ToLowerInvariant()
$helperSize = (Get-Item -LiteralPath $releaseHelper).Length
$manifest = [ordered]@{
    schemaVersion = 1
    product = 'ReportExplorerHelper'
    channel = $Channel
    releaseTag = $tag
    helperVersion = $HelperVersion
    protocolVersion = '1'
    setupVersion = $HelperVersion
    helperSha256 = $helperHash
    setupSha256 = $setupHash
    helperSize = $helperSize
    sourceCommit = $SourceCommit
    publishedAt = [DateTime]::UtcNow.ToString('o')
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $outputPath 'SHA256SUMS.txt'), "$helperHash  ReportExplorerHelper.exe`n$setupHash  ReportExplorerSetup.exe`n", $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $outputPath 'release.json'), ($manifest | ConvertTo-Json -Depth 4 -Compress) + "`n", $utf8NoBom)
Write-Output "Release assets prepared for ${tag}: $outputPath"
