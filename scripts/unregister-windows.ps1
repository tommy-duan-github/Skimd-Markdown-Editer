$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
$ExeDir = Join-Path $RootDir 'dist\Skimd'
$ExePath = Join-Path $ExeDir 'Skimd.exe'

if (-not (Test-Path $ExePath)) {
    throw "Skimd.exe not found at $ExePath."
}

$Proc = Start-Process -FilePath $ExePath -ArgumentList @('--unregister') -Wait -NoNewWindow -PassThru
if ($Proc.ExitCode -ne 0) {
    throw "Skimd.exe exited with code $($Proc.ExitCode)"
}

$UserPath = (Get-ItemProperty 'HKCU:\Environment' -Name Path -ErrorAction SilentlyContinue).Path
$InPath = ($UserPath -split ';') -contains $ExeDir
$MdCmd = (Get-ItemProperty 'HKCU:\Software\Classes\Skimd.Markdown\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
$RegApp = (Get-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name Skimd -ErrorAction SilentlyContinue).Skimd

Write-Host "inUserPath           : $InPath"
Write-Host "Skimd.Markdown cmd   : $MdCmd"
Write-Host "RegisteredApps\Skimd : $RegApp"
