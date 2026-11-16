# Windows dev stack for Talas: MongoDB 7 (replica set) + Redis + SeaweedFS S3.
# PowerShell counterpart of scripts/dev-stack.sh: same ports, URLs, and data
# layout under .data/dev-stack (gitignored). No Docker required.
#
#   scripts/dev-stack.ps1 start [-Seed] [-Fresh]
#   scripts/dev-stack.ps1 stop | status | env [-Write] | seed | worker [-Db <name>]
#
# Binaries are resolved in order: env override (MONGO_BIN / REDIS_BIN / WEED_BIN)
# -> PATH -> .data/dev-stack -> automatic download. `worker` loads .env.local
# (the web app reads it itself; the worker does not).
#
# Requires: Windows 10+ (PowerShell 5.1), node, pnpm (npm i -g pnpm@9.15.9),
# and the Visual C++ 2015-2022 x64 redistributable for mongod.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$REPO_ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $REPO_ROOT

$MONGO_VERSION = '7.0.14'
$WEED_VERSION = '4.54'
$MONGO_PORT = if ($env:MONGO_PORT) { [int]$env:MONGO_PORT } else { 27098 }
$REDIS_PORT = if ($env:REDIS_PORT) { [int]$env:REDIS_PORT } else { 6399 }
$S3_PORT = if ($env:S3_PORT) { [int]$env:S3_PORT } else { 9002 }
$DATA_DIR = if ($env:DATA_DIR) { $env:DATA_DIR } else { Join-Path (Get-Location) '.data\dev-stack' }
$MONGO_DIR = Join-Path $DATA_DIR 'mongo'
$REDIS_DIR = Join-Path $DATA_DIR 'redis'
$WEED_DIR = Join-Path $DATA_DIR 'weed'
$LOG_DIR = Join-Path $DATA_DIR 'logs'
New-Item -ItemType Directory -Force -Path $DATA_DIR, $LOG_DIR | Out-Null

function Log([string]$Message) { Write-Host "[dev-stack] $Message" }
function Die([string]$Message) {
  Write-Host "[dev-stack] ERROR: $Message" -ForegroundColor Red
  exit 1
}

function Ensure-Pnpm {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Die 'pnpm not found. Install with: npm install -g pnpm@9.15.9'
  }
}

function Test-PortOpen {
  param([string]$Ip = '127.0.0.1', [int]$Port)
  $client = New-Object Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($Ip, $Port, $null, $null)
    if ($async.AsyncWaitHandle.WaitOne(1500) -and $client.Connected) { return $true }
    return $false
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-PortOpen {
  param([int]$Port, [int]$Seconds)
  for ($attempt = 0; $attempt -lt $Seconds; $attempt += 1) {
    if (Test-PortOpen -Port $Port) { return $true }
    Start-Sleep -Seconds 1
  }
  return (Test-PortOpen -Port $Port)
}

function Save-Download([string]$Url, [string]$Destination) {
  Log "Downloading $Url (first run only)..."
  Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
}

function Find-Exe([string]$Directory, [string]$Name) {
  if (-not (Test-Path $Directory)) { return $null }
  $hit = Get-ChildItem -Path $Directory -Recurse -Filter $Name -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($hit) { return $hit.FullName }
  return $null
}

function Stop-PortOwners([int[]]$Ports) {
  foreach ($port in $Ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($connection in $connections) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
}

# ---------------------------------------------------------------- binaries

function Resolve-Mongod {
  if ($env:MONGO_BIN -and (Test-Path $env:MONGO_BIN)) { return $env:MONGO_BIN }
  $pathCommand = Get-Command mongod -ErrorAction SilentlyContinue
  if ($pathCommand) { return $pathCommand.Source }
  $local = Find-Exe (Join-Path $DATA_DIR 'mongo-dist') 'mongod.exe'
  if ($local) { return $local }
  New-Item -ItemType Directory -Force -Path $DATA_DIR | Out-Null
  $zip = Join-Path $DATA_DIR "mongodb-windows-x86_64-$MONGO_VERSION.zip"
  if (-not (Test-Path $zip)) {
    Save-Download "https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-$MONGO_VERSION.zip" $zip
  }
  Log 'Extracting MongoDB...'
  Expand-Archive -Path $zip -DestinationPath (Join-Path $DATA_DIR 'mongo-dist') -Force
  $local = Find-Exe (Join-Path $DATA_DIR 'mongo-dist') 'mongod.exe'
  if (-not $local) { Die 'mongod.exe not found in the MongoDB archive' }
  return $local
}

function Resolve-Redis {
  if ($env:REDIS_BIN -and (Test-Path $env:REDIS_BIN)) { return $env:REDIS_BIN }
  $pathCommand = Get-Command redis-server -ErrorAction SilentlyContinue
  if ($pathCommand) { return $pathCommand.Source }
  $dist = Join-Path $DATA_DIR 'redis-dist'
  $local = Find-Exe $dist 'redis-server.exe'
  if ($local) { return $local }
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  # Primary: community Redis 7.4.5 build (redis-windows/redis-windows, SHA256
  # hashes published on the release). Fallback: tporadowski 5.0.14 port. Both
  # support the commands BullMQ needs; dev use only.
  $zip = Join-Path $DATA_DIR 'Redis-7.4.5-Windows-x64-msys2.zip'
  try {
    if (-not (Test-Path $zip)) {
      Save-Download 'https://github.com/redis-windows/redis-windows/releases/download/7.4.5/Redis-7.4.5-Windows-x64-msys2.zip' $zip
    }
    Log 'Extracting Redis...'
    Expand-Archive -Path $zip -DestinationPath $dist -Force
    $local = Find-Exe $dist 'redis-server.exe'
    if ($local) { return $local }
    throw 'redis-server.exe not found in the Redis archive'
  } catch {
    Log "Redis 7.4.5 download failed ($($_.Exception.Message)); falling back to Redis 5.0.14"
    $zip = Join-Path $DATA_DIR 'redis-x64-5.0.14.1.zip'
    if (-not (Test-Path $zip)) {
      Save-Download 'https://github.com/tporadowski/redis/releases/download/v5.0.14.1/redis-x64-5.0.14.1.zip' $zip
    }
    Log 'Extracting Redis (fallback)...'
    Expand-Archive -Path $zip -DestinationPath $dist -Force
    $local = Find-Exe $dist 'redis-server.exe'
    if (-not $local) { Die 'redis-server.exe not found in any Redis archive' }
    return $local
  }
}

function Resolve-Weed {
  if ($env:WEED_BIN -and (Test-Path $env:WEED_BIN)) { return $env:WEED_BIN }
  $pathCommand = Get-Command weed -ErrorAction SilentlyContinue
  if ($pathCommand) { return $pathCommand.Source }
  $dist = Join-Path $DATA_DIR 'weed-dist'
  $local = Find-Exe $dist 'weed.exe'
  if ($local) { return $local }
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $zip = Join-Path $DATA_DIR "seaweedfs-$WEED_VERSION-windows_amd64.zip"
  if (-not (Test-Path $zip)) {
    Save-Download "https://github.com/seaweedfs/seaweedfs/releases/download/$WEED_VERSION/windows_amd64.zip" $zip
  }
  Log 'Extracting SeaweedFS...'
  Expand-Archive -Path $zip -DestinationPath $dist -Force
  $local = Find-Exe $dist 'weed.exe'
  if (-not $local) { Die 'weed.exe not found in the SeaweedFS archive' }
  return $local
}

# ---------------------------------------------------------------- services

function Start-Mongo {
  $mongod = Resolve-Mongod
  if (Test-PortOpen -Port $MONGO_PORT) {
    Log "Mongo already running at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
  } else {
    New-Item -ItemType Directory -Force -Path $MONGO_DIR, $LOG_DIR | Out-Null
    Log "Starting mongod ($mongod, data in $MONGO_DIR)..."
    # Repo paths contain no spaces; if yours does, set MONGO_BIN to a quoted-safe location.
    $proc = Start-Process -FilePath $mongod -ArgumentList @(
      '--replSet', 'rs0', '--port', "$MONGO_PORT", '--bind_ip', '127.0.0.1',
      '--dbpath', $MONGO_DIR, '--logpath', (Join-Path $LOG_DIR 'mongod.log')
    ) -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $DATA_DIR 'mongod.pid') -Value $proc.Id
    Log 'Waiting for mongod (first start can be slow: Windows Defender scans the WiredTiger files)...'
    if (-not (Wait-PortOpen -Port $MONGO_PORT -Seconds 120)) {
      Die "mongod did not open port $MONGO_PORT (see $(Join-Path $LOG_DIR 'mongod.log'))"
    }
    Log "Mongo ready at mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0"
  }
  # Initiate the replica set (idempotent) and wait for a writable primary.
  # Shared with the Linux stack: scripts/init-replica-set.mjs.
  Ensure-Pnpm
  $env:MONGO_URI = "mongodb://127.0.0.1:$MONGO_PORT"
  $env:MONGO_HOST = "127.0.0.1:$MONGO_PORT"
  & node scripts/init-replica-set.mjs
  if ($LASTEXITCODE -ne 0) { Die 'replica set init failed (see the mongod log)' }
}

function Start-Redis {
  $redis = Resolve-Redis
  if (Test-PortOpen -Port $REDIS_PORT) {
    Log "Redis already running at redis://127.0.0.1:$REDIS_PORT"
    return
  }
  New-Item -ItemType Directory -Force -Path $REDIS_DIR, $LOG_DIR | Out-Null
  Log "Starting redis-server ($redis)..."
  # Working directory doubles as the persistence dir, so no --dir path argument
  # is needed (community Windows builds want Cygwin-style paths on the command line).
  $proc = Start-Process -FilePath $redis -ArgumentList @('--port', "$REDIS_PORT", '--bind', '127.0.0.1') `
    -WorkingDirectory $REDIS_DIR -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $LOG_DIR 'redis.log') `
    -RedirectStandardError (Join-Path $LOG_DIR 'redis.err.log')
  Set-Content -Path (Join-Path $DATA_DIR 'redis.pid') -Value $proc.Id
  if (-not (Wait-PortOpen -Port $REDIS_PORT -Seconds 30)) {
    Die "redis did not open port $REDIS_PORT (see $(Join-Path $LOG_DIR 'redis.log'))"
  }
  Log "Redis ready at redis://127.0.0.1:$REDIS_PORT"
}

function Start-S3 {
  $weed = Resolve-Weed
  if (Test-PortOpen -Port $S3_PORT) {
    Log "S3 already running at http://127.0.0.1:$S3_PORT"
  } else {
    New-Item -ItemType Directory -Force -Path $WEED_DIR, $LOG_DIR | Out-Null
    # Clear stale instances from a previous unclean stop: they hold the master
    # port 9333 even when the S3 port is free, and the bind failure is silent.
    Stop-PortOwners @(9333)
    Start-Sleep -Seconds 1
    Log "Starting SeaweedFS S3 ($weed, data in $WEED_DIR)..."
    $proc = Start-Process -FilePath $weed -ArgumentList @(
      'server', '-dir', $WEED_DIR, '-ip', '127.0.0.1', '-s3', '-s3.port', "$S3_PORT"
    ) -WorkingDirectory $WEED_DIR -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput (Join-Path $LOG_DIR 'weed.log') `
      -RedirectStandardError (Join-Path $LOG_DIR 'weed.err.log')
    Set-Content -Path (Join-Path $DATA_DIR 'weed.pid') -Value $proc.Id
    if (-not (Wait-PortOpen -Port $S3_PORT -Seconds 60)) {
      Die "SeaweedFS did not open port $S3_PORT (see $(Join-Path $LOG_DIR 'weed.log'))"
    }
    Log "S3 ready at http://127.0.0.1:$S3_PORT (bucket talas-local)"
  }
  # Create the bucket and set browser-upload CORS (idempotent). Requires
  # @aws-sdk/client-s3 from node_modules.
  Ensure-Pnpm
  $setup = @"
import { S3Client, CreateBucketCommand, PutBucketCorsCommand } from '@aws-sdk/client-s3';
const client = new S3Client({
  region: 'us-east-1',
  endpoint: 'http://127.0.0.1:$S3_PORT',
  forcePathStyle: true,
  credentials: { accessKeyId: 'talas', secretAccessKey: 'talas-local-secret' },
});
try { await client.send(new CreateBucketCommand({ Bucket: 'talas-local' })); console.log('bucket created'); }
catch (e) { if (!/BucketAlready|already exists/i.test(String(e.name ?? e))) throw e; }
await client.send(new PutBucketCorsCommand({
  Bucket: 'talas-local',
  CORSConfiguration: { CORSRules: [{
    AllowedOrigins: ['*'], AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600,
  }] },
}));
console.log('bucket CORS configured');
"@
  & pnpm exec node --input-type=module -e $setup
  if ($LASTEXITCODE -ne 0) { Die 'bucket creation/CORS setup failed (needs pnpm install first)' }
  Log 'Bucket talas-local + CORS verified'
}

# ---------------------------------------------------------------- env file

function New-DevSecret([string]$Fallback) {
  $hex = & node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" 2>$null
  $line = if ($hex) { @($hex | Select-Object -First 1) } else { '' }
  if ($LASTEXITCODE -ne 0 -or $line -notmatch '^[0-9a-f]{48}$') { return $Fallback }
  return $line
}

function New-EnvLines {
  @(
    'NODE_ENV=development',
    'APP_URL=http://localhost:3000',
    '',
    "DATABASE_URL=mongodb://127.0.0.1:$MONGO_PORT/talas?replicaSet=rs0",
    "REDIS_URL=redis://127.0.0.1:$REDIS_PORT",
    '',
    "S3_ENDPOINT=http://127.0.0.1:$S3_PORT",
    'S3_REGION=us-east-1',
    'S3_BUCKET=talas-local',
    'S3_ACCESS_KEY_ID=talas',
    'S3_SECRET_ACCESS_KEY=talas-local-secret',
    'S3_FORCE_PATH_STYLE=true',
    'S3_FAKE=false',
    '',
    'CLAMAV_FAKE=clean',
    '',
    "JWT_ACCESS_SECRET=$(New-DevSecret 'dev-access-secret-please-replace-me-123456')",
    "JWT_REFRESH_SECRET=$(New-DevSecret 'dev-refresh-secret-please-replace-me-12345')",
    "CSRF_SECRET=$(New-DevSecret 'dev-csrf-secret-please-replace-me-123456')",
    '',
    'AI_PROVIDER=openai',
    'AI_DAILY_BUDGET_USD=2.00',
    'AI_FAULT_INJECTION=false',
    'AI_FAKE_LESSON=true',
    '',
    'EMAIL_TRANSPORT=memory',
    'EMAIL_FROM=Talas <no-reply@talas.local>',
    '',
    'LOG_LEVEL=debug',
    'CORS_ALLOWED_ORIGINS=http://localhost:3000',
    'WORKER_CONCURRENCY=2',
    'MAX_JOB_MS=120000'
  )
}

function Show-Env {
  $lines = New-EnvLines
  if ($script:WriteFlag) {
    # ASCII (no BOM) so dotenv-style loaders parse it everywhere.
    Set-Content -Path '.env.local' -Value $lines -Encoding Ascii
    Log 'Wrote .env.local. Login/AI/email run in fake modes; point AI_PROVIDER at a real key when needed.'
  } else {
    Write-Output $lines
    Write-Host ''
    Write-Host 'Tip: scripts/dev-stack.ps1 env -Write creates .env.local (PowerShell redirects are UTF-16 by default).'
  }
}

function Load-DotEnv([string]$Path) {
  foreach ($line in Get-Content $Path) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $name = $line.Substring(0, $line.IndexOf('=')).Trim()
    $value = $line.Substring($line.IndexOf('=') + 1).Trim()
    if ($value.Length -ge 2 -and (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    Set-Item -Path "Env:$name" -Value $value
  }
}

# ---------------------------------------------------------------- commands

function Invoke-Seed {
  Ensure-Pnpm
  if (-not (Test-Path '.env.local')) { Die 'No .env.local yet. Run: scripts/dev-stack.ps1 env -Write' }
  Load-DotEnv '.env.local'
  & pnpm db:indexes
  if ($LASTEXITCODE -ne 0) { exit 1 }
  & pnpm db:seed
  if ($LASTEXITCODE -ne 0) { exit 1 }
}

function Start-Worker {
  Ensure-Pnpm
  if (-not (Test-Path '.env.local')) { Die 'No .env.local yet. Run: scripts/dev-stack.ps1 env -Write' }
  Load-DotEnv '.env.local'
  if ($script:DbName -ne '') {
    $env:DATABASE_URL = $env:DATABASE_URL -replace "/talas(\?|$)", "/$($script:DbName)`$1"
  }
  Log "Starting worker (DATABASE_URL=$env:DATABASE_URL)..."
  & pnpm worker:start
}

function Stop-Stack([bool]$Quiet = $false) {
  $released = @()
  foreach ($entry in @(@('mongod.pid', 'mongo'), @('redis.pid', 'redis'), @('weed.pid', 'seaweedfs'))) {
    $pidFile = Join-Path $DATA_DIR $entry[0]
    if (Test-Path $pidFile) {
      $procId = Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($procId -match '^\d+$') {
        try {
          Stop-Process -Id ([int]$procId) -Force -ErrorAction SilentlyContinue
          $released += $entry[1]
        } catch { }
      }
      Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
  }
  # Dying processes accept TCP connects during shutdown grace; wait until every
  # port actually refuses connections so a following start is not confused.
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    if ((Test-PortOpen -Port $MONGO_PORT) -or (Test-PortOpen -Port $REDIS_PORT) -or (Test-PortOpen -Port $S3_PORT)) {
      Stop-PortOwners @($MONGO_PORT, $REDIS_PORT, $S3_PORT, 9333)
      Start-Sleep -Seconds 1
    } else {
      break
    }
  }
  if (-not $Quiet) {
    if ($released.Count -gt 0) { Log ("Stopped: " + ($released -join ' ')) }
    Log 'Note: web (pnpm dev) and worker are app processes; stop them separately.'
  }
}

function Show-Status {
  $ok = $true
  if (Test-PortOpen -Port $MONGO_PORT) {
    Log "mongo   : up   (mongodb://127.0.0.1:$MONGO_PORT, rs0)"
  } else { Log 'mongo   : down'; $ok = $false }
  if (Test-PortOpen -Port $REDIS_PORT) {
    Log "redis   : up   (redis://127.0.0.1:$REDIS_PORT)"
  } else { Log 'redis   : down'; $ok = $false }
  if (Test-PortOpen -Port $S3_PORT) {
    Log "s3      : up   (http://127.0.0.1:$S3_PORT, bucket talas-local)"
  } else { Log 's3      : down'; $ok = $false }

  $webUp = $false
  $workerUp = $false
  $nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
  foreach ($nodeProc in $nodeProcs) {
    if ($nodeProc.CommandLine -match 'next') { $webUp = $true }
    if ($nodeProc.CommandLine -match 'worker') { $workerUp = $true }
  }
  if ($webUp) { Log 'web     : up   (pnpm dev, http://localhost:3000)' }
  else { Log 'web     : down (run: pnpm dev)'; $ok = $false }
  if ($workerUp) { Log 'worker  : up   (scripts/dev-stack.ps1 worker)' }
  else { Log 'worker  : down (run: scripts/dev-stack.ps1 worker)'; $ok = $false }

  if (-not $ok) { exit 1 }
}

function Start-Stack {
  if ($script:FreshFlag) {
    Stop-Stack $true
    Remove-Item $MONGO_DIR, $WEED_DIR -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $MONGO_DIR, $WEED_DIR | Out-Null
    Log 'Wiped service data (--fresh)'
  }
  Start-Mongo
  Start-Redis
  Start-S3
  if ($script:SeedFlag) {
    Log 'Syncing indexes and seeding demo accounts...'
    Invoke-Seed
    Log 'Seeded: alice@talas.local / bob@talas.local (password talas-local-password)'
  }
  Write-Host ''
  if (-not (Test-Path '.env.local')) {
    Log 'No .env.local found - create one:'
    Log '  scripts/dev-stack.ps1 env -Write'
  }
  Log 'Next steps:'
  Log '  pnpm dev                             # web at http://localhost:3000'
  Log '  scripts/dev-stack.ps1 worker         # worker (loads .env.local; -Db <name> to change db)'
  Log '  scripts/dev-stack.ps1 seed           # indexes + demo accounts (idempotent)'
  Log "Logs: $LOG_DIR"
}

# ---------------------------------------------------------------- dispatch

$script:SeedFlag = $false
$script:FreshFlag = $false
$script:WriteFlag = $false
$script:DbName = ''
$command = ''
$pendingDb = $false

foreach ($arg in $args) {
  if ($pendingDb) { $script:DbName = $arg; $pendingDb = $false; continue }
  if ($arg -match '^-') {
    $flag = ($arg -replace '^-+', '').ToLower()
    switch ($flag) {
      'seed' { $script:SeedFlag = $true }
      'fresh' { $script:FreshFlag = $true }
      'write' { $script:WriteFlag = $true }
      'db' { $pendingDb = $true }
      default { Die "Unknown flag: $arg. Usage: scripts/dev-stack.ps1 start [-Seed] [-Fresh] | stop | status | env [-Write] | seed | worker [-Db <name>]" }
    }
  } else {
    switch ($arg.ToLower()) {
      'start' { $command = 'start' }
      'stop' { $command = 'stop' }
      'status' { $command = 'status' }
      'env' { $command = 'env' }
      'seed' { $command = 'seed' }
      'worker' { $command = 'worker' }
      default { Die "Unknown argument: $arg. Usage: scripts/dev-stack.ps1 start [-Seed] [-Fresh] | stop | status | env [-Write] | seed | worker [-Db <name>]" }
    }
  }
}
if ($pendingDb) { Die 'The -Db flag needs a database name (e.g. worker -Db talas-e2e)' }
if (-not $command) { Die 'Usage: scripts/dev-stack.ps1 start [-Seed] [-Fresh] | stop | status | env [-Write] | seed | worker [-Db <name>]' }

switch ($command) {
  'start' { Start-Stack }
  'stop' { Stop-Stack $false }
  'status' { Show-Status }
  'env' { Show-Env }
  'seed' { Invoke-Seed }
  'worker' { Start-Worker }
  default { Die 'Usage: scripts/dev-stack.ps1 start [-Seed] [-Fresh] | stop | status | env [-Write] | seed | worker [-Db <name>]' }
}
