$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
$HostDir = Join-Path $RootDir 'host'
$LibDir = Join-Path $HostDir 'lib'
$InstallerDir = Join-Path $RootDir 'installer'
$DistDir = Join-Path $RootDir 'dist'
$PortableDir = Join-Path $DistDir 'Skimd'
$StageDir = Join-Path $DistDir '.installer-stage'
$PayloadZip = Join-Path $DistDir 'Skimd.payload.zip'
$IconPath = Join-Path $RootDir 'assets\skimd.ico'
$ManifestPath = Join-Path $HostDir 'app.manifest'
$CscPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $CscPath)) {
    throw "C# compiler not found at $CscPath"
}

$Pkg = Get-Content -Path (Join-Path $RootDir 'package.json') -Raw | ConvertFrom-Json
$Version = $Pkg.version

$WebView2Core = Join-Path $LibDir 'Microsoft.Web.WebView2.Core.dll'
$WebView2WinForms = Join-Path $LibDir 'Microsoft.Web.WebView2.WinForms.dll'
$WebView2Loader = Join-Path $LibDir 'WebView2Loader.dll'
if (-not ((Test-Path $WebView2Core) -and (Test-Path $WebView2WinForms) -and (Test-Path $WebView2Loader))) {
    throw 'WebView2 assemblies missing in host/lib. Run scripts\build-portable.ps1 first.'
}

Write-Host "Building Skimd v$Version frontend bundle..."
Push-Location $RootDir
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw 'Vite frontend build failed.'
}
Pop-Location

# Ensure portable marker stays in dist/Skimd
$PortableFlag = Join-Path $PortableDir 'portable.flag'
if (-not (Test-Path $PortableFlag)) {
    Set-Content -Path $PortableFlag -Value 'portable' -Encoding ASCII
}

if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
if (Test-Path $PayloadZip) { Remove-Item -Force $PayloadZip }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

Write-Host 'Compiling Skimd.exe for installer payload...'
$StageExe = Join-Path $StageDir 'Skimd.exe'
$HostCsFiles = Get-ChildItem -Path $HostDir -Filter '*.cs' | ForEach-Object { $_.FullName }

$HostCscArgs = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    "/out:$StageExe",
    "/win32icon:$IconPath",
    "/win32manifest:$ManifestPath",
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Web.Extensions.dll',
    "/reference:$WebView2Core",
    "/reference:$WebView2WinForms"
) + $HostCsFiles

& $CscPath @HostCscArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Host csc.exe compilation failed.'
}

Copy-Item $WebView2Core $StageDir -Force
Copy-Item $WebView2WinForms $StageDir -Force
Copy-Item $WebView2Loader $StageDir -Force
Copy-Item (Join-Path $PortableDir 'app') (Join-Path $StageDir 'app') -Recurse -Force

# Update portable Skimd.exe as well when unlocked
$PortableExe = Join-Path $PortableDir 'Skimd.exe'
try {
    Copy-Item $StageExe $PortableExe -Force -ErrorAction Stop
} catch {
    Write-Host 'Portable Skimd.exe is currently in use; kept running executable and built fresh installer payload.'
}

Write-Host 'Packing installer payload...'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($StageDir, $PayloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

$VersionCs = @"
namespace SkimdSetup
{
    internal static class InstallerVersion
    {
        public const string Version = "$Version";
    }
}
"@
Set-Content -Path (Join-Path $InstallerDir 'InstallerVersion.cs') -Value $VersionCs -Encoding UTF8

$InstallerOut = Join-Path $DistDir "Skimd-Setup-$Version.exe"
$SetupCsFiles = Get-ChildItem -Path $InstallerDir -Filter '*.cs' | ForEach-Object { $_.FullName }

Write-Host "Compiling $InstallerOut..."
$SetupCscArgs = @(
    '/nologo',
    '/target:winexe',
    '/platform:x64',
    '/optimize+',
    "/out:$InstallerOut",
    "/win32icon:$IconPath",
    "/win32manifest:$ManifestPath",
    "/resource:$PayloadZip,Skimd.payload.zip",
    '/reference:System.dll',
    '/reference:System.Drawing.dll',
    '/reference:System.Windows.Forms.dll',
    '/reference:System.IO.Compression.dll',
    '/reference:System.IO.Compression.FileSystem.dll'
) + $SetupCsFiles

& $CscPath @SetupCscArgs
if ($LASTEXITCODE -ne 0) {
    throw 'Installer csc.exe compilation failed.'
}

Remove-Item -Recurse -Force $StageDir -ErrorAction SilentlyContinue
Remove-Item -Force $PayloadZip -ErrorAction SilentlyContinue

$InstallerMB = [math]::Round((Get-Item $InstallerOut).Length / 1MB, 2)
Write-Host "Installer build complete: $InstallerOut ($InstallerMB MB)"
