<#
.SYNOPSIS
  Creates (or updates) the SERENE MANAGEMENT development role and databases on
  a native Windows PostgreSQL installation. No Docker required.

.DESCRIPTION
  Reads DATABASE_URL from .env (user, password, host, port, database), then
  connects as a PostgreSQL superuser (default "postgres"; psql prompts for its
  password) and runs setup-native-postgres.sql. Creates:
    - role <user> (LOGIN, CREATEDB, not superuser) with the password from .env
    - database <database> and <database>_test owned by that role
  Idempotent. The app password is passed through an environment variable,
  never on the command line.

.EXAMPLE
  npm run db:setup
  npm run db:setup -- -SuperUser postgres -PsqlPath "C:\Program Files\PostgreSQL\18\bin\psql.exe"
#>
param(
  [string]$SuperUser = "postgres",
  [string]$PsqlPath = ""
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw ".env not found. Copy .env.example to .env and set DATABASE_URL first." }

$line = Get-Content $envFile | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1
if (-not $line) { throw "DATABASE_URL is not set in .env" }
$url = ($line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
$uri = [System.Uri]$url
$userInfo = $uri.UserInfo.Split(':', 2)
$appUser = [System.Uri]::UnescapeDataString($userInfo[0])
$appPassword = if ($userInfo.Length -gt 1) { [System.Uri]::UnescapeDataString($userInfo[1]) } else { "" }
$appDb = $uri.AbsolutePath.TrimStart('/')
$dbHost = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

if (-not $appUser -or -not $appDb) { throw "DATABASE_URL must include a user and a database name." }
if ($appPassword.Length -lt 16 -or $appPassword -eq "change-me") {
  throw "Set a strong password (16+ characters) for the app role in DATABASE_URL in .env first."
}

if (-not $PsqlPath) {
  $cmd = Get-Command psql -ErrorAction SilentlyContinue
  if ($cmd) { $PsqlPath = $cmd.Source }
  else {
    $PsqlPath = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
}
if (-not $PsqlPath -or -not (Test-Path $PsqlPath)) { throw "psql.exe not found. Pass -PsqlPath." }

Write-Host "PostgreSQL : $dbHost`:$port"
Write-Host "App role   : $appUser"
Write-Host "Databases  : $appDb, ${appDb}_test"
Write-Host "Connecting as superuser '$SuperUser' (psql will ask for its password)..."

$env:SERENE_DB_PASSWORD = $appPassword
try {
  & $PsqlPath -h $dbHost -p $port -U $SuperUser -d postgres -X -q `
    -v "app_user=$appUser" -v "app_db=$appDb" -v "test_db=${appDb}_test" `
    -f (Join-Path $PSScriptRoot "setup-native-postgres.sql")
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item Env:SERENE_DB_PASSWORD -ErrorAction SilentlyContinue
}
Write-Host "Done. Next: npm run db:deploy"
