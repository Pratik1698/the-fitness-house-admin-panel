#!/usr/bin/env node
// ============================================================================
// THE FITNESS HOUSE — PRE-DEPLOYMENT PACKAGE VERIFICATION SCRIPT
// File: scripts/deployment/verify-deployment-package.js
// ============================================================================
// Strictly READ-ONLY. Validates that local files, migrations, seed, functions,
// and backup archives are completely in place before any hosted operation.
// ============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

console.log('================================================================');
console.log('THE FITNESS HOUSE — DEPLOYMENT PACKAGE VERIFICATION');
console.log('Target Project: xfagvgypgboplonokntk');
console.log('Time: ' + new Date().toISOString());
console.log('================================================================\n');

let totalChecks = 0;
let passedChecks = 0;

function check(title, condition, details = '') {
    totalChecks++;
    if (condition) {
        passedChecks++;
        console.log(`[PASS] ${title}`);
        if (details) console.log(`       ${details}`);
    } else {
        console.error(`[FAIL] ${title}`);
        if (details) console.error(`       ${details}`);
    }
}

// 1. Verify 21 Migrations
const migrationsDir = path.resolve('supabase/migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
check(
    'Migration File Count',
    migrationFiles.length === 21,
    `Found ${migrationFiles.length} migrations in supabase/migrations/ (Expected 21)`
);

// Verify specific key migrations
const expectedKeyMigrations = [
    '20261019_001_phase7c_core_schema.sql',
    '20261102000002_phase4_reminder_settings_and_triggers.sql',
    '20261102000003_phase5_staff_security_and_invitations.sql',
    '20261102050000_phase5_staff_summary_schema_fix.sql'
];
expectedKeyMigrations.forEach(file => {
    check(`Key Migration Present: ${file}`, fs.existsSync(path.join(migrationsDir, file)));
});

// 2. Verify Seed SQL
const seedPath = path.resolve('supabase/seed.sql');
const seedExists = fs.existsSync(seedPath);
const seedContent = seedExists ? fs.readFileSync(seedPath, 'utf8') : '';
check(
    'Seed File Present & Validated',
    seedExists && seedContent.includes('gym_info') && seedContent.includes('membership_plans'),
    `File size: ${seedExists ? fs.statSync(seedPath).size : 0} bytes`
);

// 3. Verify Supabase config.toml
const configPath = path.resolve('supabase/config.toml');
const configExists = fs.existsSync(configPath);
const configContent = configExists ? fs.readFileSync(configPath, 'utf8') : '';
check(
    'Supabase config.toml PostgreSQL 17 configured',
    configExists && configContent.includes('major_version = 17'),
    'PostgreSQL major version set to 17'
);

// 4. Verify Edge Functions
const fnInvite = path.resolve('supabase/functions/invite-staff/index.ts');
const fnManage = path.resolve('supabase/functions/manage-staff-session/index.ts');
check('Edge Function: invite-staff/index.ts present', fs.existsSync(fnInvite));
check('Edge Function: manage-staff-session/index.ts present', fs.existsSync(fnManage));

// 5. Verify Pre-Reset Backup on Disk
const backupPath = 'E:/TFH-Database-Backup/tfh-hosted-production-20261103_111744.dump';
const backupExists = fs.existsSync(backupPath);
let backupHashMatches = false;
let backupSize = 0;

if (backupExists) {
    backupSize = fs.statSync(backupPath).size;
    const fileBuffer = fs.readFileSync(backupPath);
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex').toUpperCase();
    const expectedHash = '65173E740E9A18930546C90F1B38562584F7678ED3CDEEDDBEFC0AC9DEEF8A1C';
    backupHashMatches = (hash === expectedHash);
}

check(
    'Pre-Reset Production Backup Exists',
    backupExists,
    `Path: ${backupPath} (Size: ${backupSize} bytes)`
);
check(
    'Backup SHA-256 Checksum Verified',
    backupHashMatches,
    'Expected: 65173E740E9A18930546C90F1B38562584F7678ED3CDEEDDBEFC0AC9DEEF8A1C'
);

// 6. Verify Deployment Documentation Suite
const docs = [
    'docs/deployment/FINAL_DEPLOYMENT_RUNBOOK.md',
    'docs/deployment/HOSTED_RESET_CHECKLIST.md',
    'docs/deployment/AUTH_RECREATION_GUIDE.md',
    'docs/deployment/EDGE_FUNCTION_DEPLOYMENT.md',
    'docs/deployment/POST_DEPLOYMENT_SMOKE_TESTS.md',
    'docs/deployment/PHASE6_FINAL_GO_NO_GO.md',
    'docs/deployment/PHASE7_AUTH_BOOTSTRAP_FINAL_VALIDATION.md'
];
docs.forEach(doc => {
    check(`Deployment Document Present: ${doc}`, fs.existsSync(path.resolve(doc)));
});

// Summary
console.log('\n================================================================');
console.log(`TOTAL CHECKS:  ${totalChecks}`);
console.log(`PASSED CHECKS: ${passedChecks}`);
console.log(`FAILED CHECKS: ${totalChecks - passedChecks}`);
console.log('================================================================');

if (passedChecks === totalChecks) {
    console.log('\n>>> RESULT: DEPLOYMENT PACKAGE IS COMPLETE & READY FOR PHASE 2 <<<');
    process.exit(0);
} else {
    console.error('\n>>> RESULT: DISCREPANCY DETECTED. DO NOT PROCEED TO PHASE 2 <<<');
    process.exit(1);
}
