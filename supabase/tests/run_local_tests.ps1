# ============================================================================
# THE FITNESS HOUSE - GYM MANAGEMENT ADMIN PANEL
# LOCAL DISPOSABLE TEST RUNNER: run_local_tests.ps1
# ============================================================================
# Safety Enforcements:
#   1. Strictly bound to container 'tfh-pg-staging' and database 'tfh_test'.
#   2. Local-only port binding enforced on 127.0.0.1:5433:5432.
#   3. Port 5432 and careertwin_db are NEVER touched, inspected, or reused.
#   4. Zero remote/host psql connections allowed: execution is strictly via
#      docker exec on the verified local container 'tfh-pg-staging'.
#   5. Bounded pg_isready health checks verify PostgreSQL accepts connections.
#   6. Exact trimmed database verification (SELECT current_database() == 'tfh_test').
#   7. Fails immediately and exits with non-zero code on any failure.
# ============================================================================

param(
    [string]$ContainerName = "tfh-pg-staging",
    [string]$Database = "tfh_test",
    [string]$User = "postgres"
)

$ErrorActionPreference = "Stop"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "THE FITNESS HOUSE - AUTOMATED LOCAL POSTGRESQL TEST RUNNER" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Strict Target Identity Validation
if ($ContainerName -ne "tfh-pg-staging") {
    Write-Host ""
    Write-Host "[FATAL] Safety Violation: Container target must be strictly 'tfh-pg-staging'. Received: '$ContainerName'" -ForegroundColor Red
    exit 1
}

if ($Database -ne "tfh_test") {
    Write-Host ""
    Write-Host "[FATAL] Safety Violation: Database target must be strictly 'tfh_test'. Received: '$Database'" -ForegroundColor Red
    exit 1
}

if ($User -ne "postgres") {
    Write-Host ""
    Write-Host "[FATAL] Safety Violation: Database user must be strictly 'postgres'. Received: '$User'" -ForegroundColor Red
    exit 1
}

# 2. Verify Container Existence and Running State
Write-Host ""
Write-Host "[1/6] Verifying container state for '$ContainerName'..." -ForegroundColor Cyan
$runningStatus = docker inspect -f '{{.State.Running}}' $ContainerName 2>$null
if ($LASTEXITCODE -ne 0 -or "$runningStatus".Trim() -ne "true") {
    Write-Host ""
    Write-Host "[BLOCKED] Docker container '$ContainerName' is not running (State.Running='$runningStatus')." -ForegroundColor Red
    Write-Host "To launch the isolated disposable container on 127.0.0.1:5433, run:" -ForegroundColor Yellow
    Write-Host "  docker run --name tfh-pg-staging -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tfh_test -p 127.0.0.1:5433:5432 -d postgres:15" -ForegroundColor White
    exit 1
}
Write-Host "[OK] Container '$ContainerName' exists and is running." -ForegroundColor Green

# 3. Verify Container Image is PostgreSQL 15
Write-Host ""
Write-Host "[2/6] Verifying PostgreSQL 15 image..." -ForegroundColor Cyan
$imageName = docker inspect -f '{{.Config.Image}}' $ContainerName 2>$null
if ($LASTEXITCODE -ne 0 -or (-not ("$imageName".Trim() -match "^(docker\.io\/library\/)?postgres:15(\b|$)"))) {
    Write-Host ""
    Write-Host "[FATAL] Image mismatch: Container '$ContainerName' is running '$imageName', but postgres:15 is strictly required." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Container '$ContainerName' is running verified image '$imageName'." -ForegroundColor Green

# 4. Verify Container Port Bindings (Strictly 127.0.0.1:5433 -> 5432/tcp)
Write-Host ""
Write-Host "[3/6] Verifying container port bindings (strictly 127.0.0.1:5433 -> 5432/tcp)..." -ForegroundColor Cyan
$rawPorts = docker inspect -f '{{json .NetworkSettings.Ports}}' $ContainerName 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[FATAL] Failed to inspect port bindings for container '$ContainerName'." -ForegroundColor Red
    exit 1
}

try {
    $portsObj = $rawPorts | ConvertFrom-Json
} catch {
    Write-Host ""
    Write-Host "[FATAL] Failed to parse port bindings JSON: $rawPorts" -ForegroundColor Red
    exit 1
}

$portKeys = @($portsObj.PSObject.Properties.Name)
if ($portKeys.Count -ne 1 -or $portKeys[0] -ne "5432/tcp") {
    Write-Host ""
    Write-Host "[FATAL] Port binding security violation! Container has exposed ports: $($portKeys -join ', '). Expected only '5432/tcp'." -ForegroundColor Red
    exit 1
}

$binding = $portsObj.'5432/tcp'
if ($null -eq $binding -or $binding.Count -ne 1) {
    Write-Host ""
    Write-Host "[FATAL] Port binding security violation! Expected exactly 1 host binding on '5432/tcp', found $($binding.Count)." -ForegroundColor Red
    exit 1
}

$hostIp = $binding[0].HostIp
$hostPort = $binding[0].HostPort

if ($hostIp -ne "127.0.0.1" -or $hostPort -ne "5433") {
    Write-Host ""
    Write-Host "[FATAL] Port binding security violation!" -ForegroundColor Red
    Write-Host "Expected strictly '127.0.0.1:5433', but container is bound to '$($hostIp):$($hostPort)'." -ForegroundColor Red
    Write-Host "Remote (0.0.0.0), conflicting (5432), or non-loopback port bindings are strictly forbidden." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Port binding verified: strictly 127.0.0.1:5433 -> 5432/tcp." -ForegroundColor Green

# 5. Bounded PostgreSQL Readiness Check (pg_isready)
Write-Host ""
Write-Host "[4/6] Verifying database engine readiness via pg_isready..." -ForegroundColor Cyan
$maxAttempts = 30
$isReady = $false
for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
    $null = docker exec $ContainerName pg_isready -U $User -d $Database 2>&1
    if ($LASTEXITCODE -eq 0) {
        $isReady = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $isReady) {
    Write-Host ""
    Write-Host "[FATAL] PostgreSQL engine in '$ContainerName' did not become ready after $maxAttempts seconds." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] PostgreSQL engine is ready to accept connections." -ForegroundColor Green

# 6. Exact Trimmed Database Name Verification
Write-Host ""
Write-Host "[5/6] Verifying current database identity..." -ForegroundColor Cyan
$rawDb = docker exec $ContainerName psql -U $User -d $Database -tAc 'SELECT current_database();' 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[FATAL] Failed to query current database from container '$ContainerName'." -ForegroundColor Red
    Write-Host "Error output: $rawDb" -ForegroundColor Red
    exit 1
}
$trimmedDb = "$rawDb".Trim()
if ($trimmedDb -ne $Database) {
    Write-Host ""
    Write-Host "[FATAL] Target database mismatch: Expected exact database '$Database', but container returned '$trimmedDb'." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Target database verified: strictly '$trimmedDb'." -ForegroundColor Green

# 7. Step Execution Function with Strict Exit-Code Propagation
function Run-SqlFile {
    param(
        [string]$StepTitle,
        [string]$FilePath
    )
    Write-Host ""
    Write-Host "--> Step: $StepTitle ($FilePath)" -ForegroundColor Yellow
    if (-not (Test-Path -LiteralPath $FilePath)) {
        Write-Host "[FATAL] SQL file not found: $FilePath" -ForegroundColor Red
        exit 1
    }

    $resolvedPath = (Resolve-Path -LiteralPath $FilePath).ProviderPath

    # 1. Open SQL file BEFORE launching Docker process to prevent orphan processes
    $fileStream = $null
    $proc = $null
    $stepExit = 1

    try {
        $fileStream = [System.IO.File]::OpenRead($resolvedPath)

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = "docker"
        $psi.Arguments = "exec -i $ContainerName psql -U $User -d $Database -v ON_ERROR_STOP=1"
        $psi.UseShellExecute = $false
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $false
        $psi.RedirectStandardError = $false
        $psi.CreateNoWindow = $true

        $proc = [System.Diagnostics.Process]::Start($psi)

        # Stream raw bytes directly to stdin (preserves UTF-8 and handles spaces safely)
        $fileStream.CopyTo($proc.StandardInput.BaseStream)
        $proc.StandardInput.Close()

        $proc.WaitForExit()
        $stepExit = $proc.ExitCode
    }
    catch {
        Write-Host ""
        Write-Host "[ERROR] Exception occurred during execution of step '$StepTitle': $_" -ForegroundColor Red
        if ($proc -ne $null -and -not $proc.HasExited) {
            try { $proc.Kill() } catch { }
        }
        throw
    }
    finally {
        if ($fileStream -ne $null) {
            $fileStream.Dispose()
        }
        if ($proc -ne $null) {
            $proc.Dispose()
        }
    }

    if ($stepExit -ne 0) {
        Write-Host ""
        Write-Host "[ERROR] Step failed with non-zero exit code ($stepExit): $StepTitle" -ForegroundColor Red
        Write-Host "[ABORT] Halting test runner immediately. Zero downstream execution." -ForegroundColor Red
        exit $stepExit
    }
    Write-Host "[OK] Step completed successfully: $StepTitle" -ForegroundColor Green
}

# 8. Execute Test Pipeline
Write-Host ""
Write-Host "[6/6] Executing SQL Migration and Test Pipeline..." -ForegroundColor Cyan

# Step 1: Initialize Local Supabase-Mock Harness
Run-SqlFile "Initialize Local Harness Dependencies" "supabase\tests\01_local_harness_setup.sql"

# Step 2: First-Run Migration
Run-SqlFile "Apply Migration 20261019_001 (First Run)" "supabase\migrations\20261019_001_phase7c_core_schema.sql"

# Step 3: Immediate Rerun Migration (Idempotency Verification)
Run-SqlFile "Apply Migration 20261019_001 (Immediate Rerun)" "supabase\migrations\20261019_001_phase7c_core_schema.sql"

# Step 4: Run Integration Tests
Run-SqlFile "Run Comprehensive Integration Test Suite" "supabase\tests\02_run_integration_tests.sql"

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "ALL LOCAL TESTS PASSED SUCCESSFULLY!" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
exit 0
