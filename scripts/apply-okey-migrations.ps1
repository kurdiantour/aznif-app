param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'
$migrationRoot = Resolve-Path "$PSScriptRoot\..\supabase\okey\migrations"
$files = Get-ChildItem -LiteralPath $migrationRoot -Filter '*.sql' -File | Sort-Object Name
if ($files.Count -eq 0) { throw 'No Okey migrations found.' }

foreach ($file in $files) {
  Write-Host "Applying Okey migration: $($file.Name)"
  & psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $file.FullName
  if ($LASTEXITCODE -ne 0) { throw "Okey migration failed: $($file.Name)" }
}
