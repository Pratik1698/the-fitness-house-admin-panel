# ============================================================================
# THE FITNESS HOUSE — PRE-DEPLOYMENT PACKAGE VERIFICATION SCRIPT (PowerShell)
# File: scripts/deployment/verify-deployment-package.ps1
# ============================================================================

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "THE FITNESS HOUSE -- DEPLOYMENT PACKAGE VERIFICATION" -ForegroundColor Cyan
Write-Host "Target Project: xfagvgypgboplonokntk" -ForegroundColor Cyan
Write-Host "Time: $(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')" -ForegroundColor Cyan
Write-Host "================================================================`n" -ForegroundColor Cyan

$TotalChecks = 0
$PassedChecks = 0

function Assert-Check {
    param (
        [string]$Title,
        [bool]$Condition,
        [string]$Details = ""
    )
    $script:TotalChecks++
    if ($Condition) {
        $script:PassedChecks++
        Write-Host "[PASS] $Title" -ForegroundColor Green
        if ($Details) { Write-Host "       $Details" -ForegroundColor DarkGray }
    } else {
        Write-Host "[FAIL] $Title" -ForegroundColor Red
        if ($Details) { Write-Host "       $Details" -ForegroundColor Yellow }
    }
}

# 1. Migrations
$Migrations = Get-ChildItem -Path "supabase\migrations\*.sql" | Sort-Object Name
Assert-Check -Title "Migration File Count" -Condition ($Migrations.Count -eq 21) -Details "Found $($Migrations.Count) migrations (Expected 21)"

$KeyFiles = @(
    "20261019_001_phase7c_core_schema.sql",
    "20261102000002_phase4_reminder_settings_and_triggers.sql",
    "20261102000003_phase5_staff_security_and_invitations.sql",
    "20261102050000_phase5_staff_summary_schema_fix.sql"
)
foreach ($kf in $KeyFiles) {
    Assert-Check -Title "Key Migration: $kf" -Condition (Test-Path "supabase\migrations\$kf")
}

# 2. Seed File
$SeedExists = Test-Path "supabase\seed.sql"
$SeedValid = $false
if ($SeedExists) {
    $content = Get-Content -Path "supabase\seed.sql" -Raw
    $SeedValid = ($content.Contains("gym_info") -and $content.Contains("membership_plans"))
}
Assert-Check -Title "Seed File Present and Validated" -Condition ($SeedExists -and $SeedValid)

# 3. Supabase config
$ConfigExists = Test-Path "supabase\config.toml"
$ConfigValid = $false
if ($ConfigExists) {
    $cfg = Get-Content -Path "supabase\config.toml" -Raw
    $ConfigValid = $cfg.Contains("major_version = 17")
}
Assert-Check -Title "PostgreSQL 17 Configured in config.toml" -Condition ($ConfigExists -and $ConfigValid)

# 4. Edge Functions
Assert-Check -Title "Edge Function: invite-staff" -Condition (Test-Path "supabase\functions\invite-staff\index.ts")
Assert-Check -Title "Edge Function: manage-staff-session" -Condition (Test-Path "supabase\functions\manage-staff-session\index.ts")

# 5. Pre-Reset Backup
$BackupPath = "E:\TFH-Database-Backup\tfh-hosted-production-20261103_111744.dump"
$BackupExists = Test-Path $BackupPath
$HashMatches = $false
$BackupSize = 0

if ($BackupExists) {
    $item = Get-Item $BackupPath
    $BackupSize = $item.Length
    $hash = (Get-FileHash -Path $BackupPath -Algorithm SHA256).Hash.ToUpper()
    $ExpectedHash = "65173E740E9A18930546C90F1B38562584F7678ED3CDEEDDBEFC0AC9DEEF8A1C"
    $HashMatches = ($hash -eq $ExpectedHash)
}

Assert-Check -Title "Pre-Reset Backup Exists" -Condition $BackupExists -Details "Path: $BackupPath (Size: $BackupSize bytes)"
Assert-Check -Title "Backup SHA-256 Checksum Verified" -Condition $HashMatches -Details "Expected: 65173E740E9A18930546C90F1B38562584F7678ED3CDEEDDBEFC0AC9DEEF8A1C"

# 6. Deployment Documents
$Docs = @(
    "docs\deployment\FINAL_DEPLOYMENT_RUNBOOK.md",
    "docs\deployment\HOSTED_RESET_CHECKLIST.md",
    "docs\deployment\AUTH_RECREATION_GUIDE.md",
    "docs\deployment\EDGE_FUNCTION_DEPLOYMENT.md",
    "docs\deployment\POST_DEPLOYMENT_SMOKE_TESTS.md"
)
foreach ($doc in $Docs) {
    Assert-Check -Title "Deployment Doc: $doc" -Condition (Test-Path $doc)
}

Write-Host "`n================================================================" -ForegroundColor Cyan
Write-Host "TOTAL CHECKS:  $TotalChecks" -ForegroundColor Cyan
Write-Host "PASSED CHECKS: $PassedChecks" -ForegroundColor Green
Write-Host "FAILED CHECKS: $($TotalChecks - $PassedChecks)" -ForegroundColor $(if ($TotalChecks -eq $PassedChecks) { "Green" } else { "Red" })
Write-Host "================================================================" -ForegroundColor Cyan

if ($PassedChecks -eq $TotalChecks) {
    Write-Host "`n*** RESULT: DEPLOYMENT PACKAGE IS COMPLETE AND READY FOR PHASE 2 ***`n" -ForegroundColor Green
    exit 0
} else {
    Write-Host "`n*** RESULT: DISCREPANCY DETECTED. DO NOT PROCEED TO PHASE 2 ***`n" -ForegroundColor Red
    exit 1
}
