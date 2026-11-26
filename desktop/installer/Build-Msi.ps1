param(
    [Parameter(Mandatory)] [string] $RcloneFolder,
    [Parameter(Mandatory)] [string] $WinFspFolder,
    [Parameter(Mandatory)] [string] $WorkDirectory,
    [Parameter(Mandatory)] [string] $OutputMsi,
    [string] $Version = '0.6.6',
    [string] $Dotnet = 'dotnet',
    [string] $Wix = 'wix'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$work = (New-Item -ItemType Directory -Force -Path $WorkDirectory).FullName
$payload = (New-Item -ItemType Directory -Force -Path (Join-Path $work 'payload')).FullName
$output = [IO.Path]::GetFullPath($OutputMsi)
$null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $output)

$driver = Join-Path $WinFspFolder 'WinFsp.msi'
$driverHash = '36CE01F9EEDBBE6842B7FB4BEDC79D7D4F71983E8ACEB6877B46A07B331C7E19'
if ((Get-FileHash -LiteralPath $driver).Hash -ne $driverHash) {
    throw 'Use o MSI oficial WinFsp 2.2.26323.'
}

$project = Join-Path $repo 'desktop/SingleDrive.Desktop/SingleDrive.Desktop.csproj'
$publishArgs = @(
    'publish', $project, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '-p:PublishSingleFile=true', '-p:IncludeNativeLibrariesForSelfExtract=true',
    '-p:EnableCompressionInSingleFile=true', '-p:DebugType=None', "-p:Version=$Version", '-o', $payload
)
& $Dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw 'A compilação do SingleDrive falhou.' }

Copy-Item -LiteralPath (Join-Path $RcloneFolder 'rclone.exe'),(Join-Path $RcloneFolder 'Licenca-rclone.txt') -Destination $payload
foreach ($name in 'WinFsp.msi','Licenca-WinFsp.txt','WinFsp-v2.2-source.tar.gz') {
    Copy-Item -LiteralPath (Join-Path $WinFspFolder $name) -Destination $payload
}
Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination (Join-Path $payload 'Licenca-SingleDrive.txt')

$license = (Get-Content -Raw -LiteralPath (Join-Path $repo 'LICENSE')).TrimEnd()
$license = $license.Replace('\', '\\').Replace('{', '\{').Replace('}', '\}')
$license = $license.Replace([string][char]13, '').Replace([string][char]10, '\par ')
$rtf = Join-Path $work 'License.rtf'
[IO.File]::WriteAllText($rtf, ('{\rtf1\ansi\deff0{\fonttbl{\f0 Segoe UI;}}\f0\fs26\b SingleDrive\b0\par \fs18 ' + $license + '}'), [Text.Encoding]::ASCII)
$brandIcon = Join-Path $repo 'desktop/branding/SingleDrive.ico'
& (Join-Path $PSScriptRoot 'New-InstallerArtwork.ps1') -IconPath $brandIcon -OutputDirectory $work

$buildArgs = @(
    'build', (Join-Path $PSScriptRoot 'SingleDrive.wxs'), '-arch', 'x64', '-culture', 'pt-BR',
    '-ext', 'WixToolset.UI.wixext', '-ext', 'WixToolset.Util.wixext',
    '-d', "Payload=$payload", '-d', "ProductVersion=$Version", '-d', "LicenseRtf=$rtf",
    '-d', "BrandIcon=$brandIcon", '-d', "BrandBanner=$(Join-Path $work 'Banner.bmp')", '-d', "BrandDialog=$(Join-Path $work 'Dialog.bmp')",
    '-intermediateFolder', (Join-Path $work 'wixobj'), '-pdbtype', 'none', '-out', $output
)
& $Wix @buildArgs
if ($LASTEXITCODE -ne 0) { throw 'A geração do MSI falhou.' }
