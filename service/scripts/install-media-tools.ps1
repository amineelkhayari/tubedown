$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }
$serviceRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolsDirectory = Join-Path $serviceRoot 'tools'
New-Item -ItemType Directory -Force -Path $toolsDirectory | Out-Null

function Download-File([string]$Url, [string]$Destination) {
    & curl.exe --fail --location --silent --show-error --retry 3 --connect-timeout 30 --max-time 600 $Url --output $Destination
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}

function File-Sha256([string]$FilePath) {
    $stream = [System.IO.File]::OpenRead($FilePath)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}

Write-Host 'Downloading yt-dlp from its official GitHub release...'
$release = Invoke-RestMethod 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest' -Headers @{ 'User-Agent' = 'YTDownloader-Setup' }
$ytAsset = $release.assets | Where-Object { $_.name -eq 'yt-dlp.exe' } | Select-Object -First 1
$hashAsset = $release.assets | Where-Object { $_.name -eq 'SHA2-256SUMS' } | Select-Object -First 1
if (-not $ytAsset -or -not $hashAsset) { throw 'Release executable or checksum file was not found.' }
$ytTemp = Join-Path $toolsDirectory 'yt-dlp.download'
$ytHashes = Join-Path $toolsDirectory 'yt-dlp.sha256'
Download-File $hashAsset.browser_download_url $ytHashes
$hashLine = Get-Content -LiteralPath $ytHashes | Where-Object { $_ -match '\s+\*?yt-dlp\.exe$' } | Select-Object -First 1
if (-not $hashLine) { throw 'yt-dlp checksum is missing.' }
$expected = ($hashLine -split '\s+')[0]
$ytInstalled = Join-Path $toolsDirectory 'yt-dlp.exe'
if (-not (Test-Path -LiteralPath $ytInstalled) -or (File-Sha256 $ytInstalled) -ne $expected) {
    Download-File $ytAsset.browser_download_url $ytTemp
    if ((File-Sha256 $ytTemp) -ne $expected) { throw 'yt-dlp checksum mismatch.' }
    Move-Item -LiteralPath $ytTemp -Destination $ytInstalled -Force
}

Write-Host 'Downloading FFmpeg and FFprobe from the Windows build provider linked by ffmpeg.org...'
$sevenZip = Join-Path $env:ProgramFiles '7-Zip/7z.exe'
$extension = if (Test-Path -LiteralPath $sevenZip) { '7z' } else { 'zip' }
$zip = Join-Path $toolsDirectory ("ffmpeg-essentials.$extension")
$checksum = Join-Path $toolsDirectory 'ffmpeg-essentials.sha256'
$ffRelease = Invoke-RestMethod 'https://api.github.com/repos/GyanD/codexffmpeg/releases/latest' -Headers @{ 'User-Agent' = 'YTDownloader-Setup' }
$ffAsset = $ffRelease.assets | Where-Object { $_.name -match ("essentials_build\." + $extension + '$') } | Select-Object -First 1
if (-not $ffAsset -or $ffAsset.digest -notmatch '^sha256:[a-fA-F0-9]{64}$') { throw 'FFmpeg release or SHA-256 digest was not found.' }
Download-File $ffAsset.browser_download_url $zip
$expected = $ffAsset.digest.Substring(7)
Set-Content -LiteralPath $checksum -Value $expected
if ((File-Sha256 $zip) -ne $expected) { throw 'FFmpeg checksum mismatch. Retry in case a release changed during download.' }
$unpack = Join-Path $toolsDirectory ('unpack-' + [Guid]::NewGuid().ToString())
if ($extension -eq '7z') {
    & $sevenZip x $zip "-o$unpack" -y | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'FFmpeg extraction failed.' }
} else {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $unpack)
}
foreach ($binary in @('ffmpeg.exe', 'ffprobe.exe')) {
    $source = Get-ChildItem -LiteralPath $unpack -Recurse -File -Filter $binary | Select-Object -First 1
    if (-not $source) { throw "Missing $binary in the archive." }
    Copy-Item -LiteralPath $source.FullName -Destination (Join-Path $toolsDirectory $binary) -Force
}
# Preserve accompanying license/readme files alongside the installed executables.
Get-ChildItem -LiteralPath $unpack -Recurse -File | Where-Object { $_.Name -match '^(LICENSE|COPYING|README)' } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $toolsDirectory $_.Name) -Force
}
$resolvedUnpack = [System.IO.Path]::GetFullPath($unpack)
if (-not $resolvedUnpack.StartsWith($toolsDirectory + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe extraction cleanup path.' }
Remove-Item -LiteralPath $resolvedUnpack -Recurse -Force
Remove-Item -LiteralPath $zip

& (Join-Path $toolsDirectory 'yt-dlp.exe') --version
if ($LASTEXITCODE -ne 0) { throw 'yt-dlp did not start.' }
& (Join-Path $toolsDirectory 'ffmpeg.exe') -version | Select-Object -First 1
& (Join-Path $toolsDirectory 'ffprobe.exe') -version | Select-Object -First 1
Write-Host 'Installed in service/tools. Restart the service; no global PATH changes are needed.'
