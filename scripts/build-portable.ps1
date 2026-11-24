$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent $PSScriptRoot
$HostDir = Join-Path $RootDir 'host'
$LibDir = Join-Path $HostDir 'lib'
$DistDir = Join-Path $RootDir 'dist\Skimd'
$AppDistDir = Join-Path $DistDir 'app'
$IconPath = Join-Path $RootDir 'assets\skimd.ico'
$ManifestPath = Join-Path $HostDir 'app.manifest'
$CscPath = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'

if (-not (Test-Path $CscPath)) {
    throw "C# compiler not found at $CscPath"
}

$WebView2Core = Join-Path $LibDir 'Microsoft.Web.WebView2.Core.dll'
$WebView2WinForms = Join-Path $LibDir 'Microsoft.Web.WebView2.WinForms.dll'
$WebView2Loader = Join-Path $LibDir 'WebView2Loader.dll'

if (-not ((Test-Path $WebView2Core) -and (Test-Path $WebView2WinForms) -and (Test-Path $WebView2Loader))) {
    Write-Host 'Downloading Microsoft.Web.WebView2 NuGet package...'
    New-Item -ItemType Directory -Force -Path $LibDir | Out-Null
    $NupkgVersion = '1.0.2903.40'
    $NupkgUrl = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$NupkgVersion/microsoft.web.webview2.$NupkgVersion.nupkg"
    $TempZip = Join-Path $env:TEMP "webview2_$NupkgVersion.zip"
    $TempExtract = Join-Path $env:TEMP "webview2_$NupkgVersion"
    if (Test-Path $TempExtract) { Remove-Item -Recurse -Force $TempExtract }

    Invoke-WebRequest -Uri $NupkgUrl -OutFile $TempZip -UseBasicParsing
    Expand-Archive -Path $TempZip -DestinationPath $TempExtract -Force

    $NetLibDir = Join-Path $TempExtract 'lib\net462'
    if (-not (Test-Path $NetLibDir)) {
        $NetLibDir = Join-Path $TempExtract 'lib\net45'
    }
    Copy-Item (Join-Path $NetLibDir 'Microsoft.Web.WebView2.Core.dll') $WebView2Core -Force
    Copy-Item (Join-Path $NetLibDir 'Microsoft.Web.WebView2.WinForms.dll') $WebView2WinForms -Force
    Copy-Item (Join-Path $TempExtract 'runtimes\win-x64\native\WebView2Loader.dll') $WebView2Loader -Force

    Remove-Item $TempZip -Force -ErrorAction SilentlyContinue
    Remove-Item $TempExtract -Recurse -Force -ErrorAction SilentlyContinue
}

if (-not (Test-Path $IconPath)) {
    Write-Host 'Generating Skimd icon...'
    Push-Location $RootDir
    node scripts/generate-icon.mjs
    Pop-Location
}

Write-Host 'Building Skimd frontend bundle...'
Push-Location $RootDir
npm.cmd run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    throw 'Vite frontend build failed.'
}
Pop-Location

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

Write-Host 'Compiling Skimd.exe native host...'
$OutExe = Join-Path $DistDir 'Skimd.exe'
$CsFiles = Get-ChildItem -Path $HostDir -Filter '*.cs' | ForEach-Object { $_.FullName }

# Skip re-linking Skimd.exe if existing binary is already newer than all host sources/icon/manifest
$LatestHostInput = (@($CsFiles + @($IconPath, $ManifestPath)) | ForEach-Object { (Get-Item $_).LastWriteTimeUtc } | Sort-Object -Descending | Select-Object -First 1)
if ((Test-Path $OutExe) -and ((Get-Item $OutExe).LastWriteTimeUtc -ge $LatestHostInput)) {
    Write-Host 'Skimd.exe is up to date with native host sources; keeping existing Skimd.exe.'
} else {
    $CscArgs = @(
        '/nologo',
        '/target:winexe',
        '/platform:x64',
        '/optimize+',
        "/out:$OutExe",
        "/win32icon:$IconPath",
        "/win32manifest:$ManifestPath",
        '/reference:System.dll',
        '/reference:System.Drawing.dll',
        '/reference:System.Windows.Forms.dll',
        '/reference:System.Web.Extensions.dll',
        "/reference:$WebView2Core",
        "/reference:$WebView2WinForms"
    ) + $CsFiles

    & $CscPath @CscArgs
    if ($LASTEXITCODE -ne 0) {
        throw 'csc.exe compilation failed.'
    }

    Copy-Item $WebView2Core $DistDir -Force
    Copy-Item $WebView2WinForms $DistDir -Force
    Copy-Item $WebView2Loader $DistDir -Force
}

$PortableFlag = Join-Path $DistDir 'portable.flag'
if (-not (Test-Path $PortableFlag)) {
    Set-Content -Path $PortableFlag -Value 'portable' -Encoding ASCII
}

$TotalBytes = (Get-ChildItem -Path $DistDir -Recurse -File | Measure-Object -Property Length -Sum).Sum
$TotalMB = [math]::Round($TotalBytes / 1MB, 2)
Write-Host "Portable build complete: $DistDir ($TotalMB MB)"
