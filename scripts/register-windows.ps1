param(
    [switch]$IncludeStructured
)

$ErrorActionPreference = 'Stop'
$RootDir = Split-Path -Parent $PSScriptRoot
$ExeDir = Join-Path $RootDir 'dist\Skimd'
$ExePath = Join-Path $ExeDir 'Skimd.exe'

if (-not (Test-Path $ExePath)) {
    throw "Skimd.exe not found at $ExePath. Run scripts\build-portable.ps1 first."
}

$Flags = if ($IncludeStructured) { @('--register-all') } else { @('--register-path', '--register-md') }
$Proc = Start-Process -FilePath $ExePath -ArgumentList $Flags -Wait -NoNewWindow -PassThru
if ($Proc.ExitCode -ne 0) {
    throw "Skimd.exe exited with code $($Proc.ExitCode)"
}

$UserPath = (Get-ItemProperty 'HKCU:\Environment' -Name Path -ErrorAction SilentlyContinue).Path
$InPath = ($UserPath -split ';') -contains $ExeDir
$MdCmd = (Get-ItemProperty 'HKCU:\Software\Classes\Skimd.Markdown\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
$RegApp = (Get-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name Skimd -ErrorAction SilentlyContinue).Skimd
$UserChoice = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice' -ErrorAction SilentlyContinue).ProgId

Write-Host "inUserPath           : $InPath ($ExeDir)"
Write-Host "Skimd.Markdown cmd   : $MdCmd"
Write-Host "RegisteredApps\Skimd : $RegApp"
Write-Host "Explorer .md Choice  : $UserChoice"

if ($UserChoice -and $UserChoice -ne 'Skimd.Markdown') {
    Write-Host "Note: Windows currently pins .md to '$UserChoice'. Open Windows Default Apps (or Skimd Settings -> Open Windows Default Apps) and pick Skimd for .md."
}
