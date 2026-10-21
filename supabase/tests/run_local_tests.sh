#!/usr/bin/env bash
# ============================================================================
# THE FITNESS HOUSE — GYM MANAGEMENT ADMIN PANEL
# LOCAL DISPOSABLE TEST RUNNER: run_local_tests.sh
# ============================================================================
# Safety Enforcements:
#   1. Strictly bound to container 'tfh-pg-staging' and database 'tfh_test'.
#   2. Local-only port binding enforced on 127.0.0.1:5433:5432.
#   3. Port 5432 and careertwin_db are NEVER touched, inspected, or reused.
#   4. Zero remote/host psql connections allowed: execution is strictly via
#      docker exec on the verified local container 'tfh-pg-staging'.
#   5. Bounded pg_isready health checks verify PostgreSQL accepts connections.
#   6. Exact trimmed database verification (SELECT current_database() == 'tfh_test').
#   7. Fails immediately and exits with non-zero code on any failure (set -euo pipefail).
# ============================================================================
set -euo pipefail

CONTAINER_NAME="tfh-pg-staging"
DB_NAME="tfh_test"
DB_USER="postgres"

echo "================================================================="
echo "THE FITNESS HOUSE — AUTOMATED LOCAL POSTGRESQL TEST RUNNER"
echo "================================================================="

# 1. Strict Target Identity Validation
TARGET_CONTAINER="${1:-tfh-pg-staging}"
if [[ "${TARGET_CONTAINER}" != "tfh-pg-staging" ]]; then
    echo -e "\n[FATAL] Safety Violation: Container target must be strictly 'tfh-pg-staging'. Received: '${TARGET_CONTAINER}'" >&2
    exit 1
fi

# 2. Verify Container Existence and Running State
echo -e "\n[1/6] Verifying container state for '${CONTAINER_NAME}'..."
RUNNING_STATE=$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)
if [[ "${RUNNING_STATE}" != "true" ]]; then
    echo -e "\n[BLOCKED] Docker container '${CONTAINER_NAME}' is not running (State.Running='${RUNNING_STATE}')." >&2
    echo "To launch the isolated disposable container on 127.0.0.1:5433, run:" >&2
    echo "  docker run --name tfh-pg-staging -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tfh_test -p 127.0.0.1:5433:5432 -d postgres:15" >&2
    exit 1
fi
echo "[OK] Container '${CONTAINER_NAME}' exists and is running."

# 3. Verify Container Image is PostgreSQL 15
echo "[2/6] Verifying PostgreSQL 15 image..."
IMAGE_NAME=$(docker inspect -f '{{.Config.Image}}' "${CONTAINER_NAME}" 2>/dev/null || true)
if [[ ! "${IMAGE_NAME}" =~ ^(docker\.io/library/)?postgres:15(:.*)?$ && "${IMAGE_NAME}" != "postgres:15" ]]; then
    echo -e "\n[FATAL] Image mismatch: Container '${CONTAINER_NAME}' is running '${IMAGE_NAME}', expected postgres:15." >&2
    exit 1
fi
echo "[OK] Container '${CONTAINER_NAME}' is running verified image '${IMAGE_NAME}'."

# 4. Verify Container Port Bindings (Strictly 127.0.0.1:5433 -> 5432/tcp)
echo "[3/6] Verifying container port bindings (strictly 127.0.0.1:5433 -> 5432/tcp)..."
HOST_IP=$(docker inspect -f '{{range .NetworkSettings.Ports."5432/tcp"}}{{.HostIp}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)
HOST_PORT=$(docker inspect -f '{{range .NetworkSettings.Ports."5432/tcp"}}{{.HostPort}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)

if [[ "${HOST_IP}" != "127.0.0.1" || "${HOST_PORT}" != "5433" ]]; then
    echo -e "\n[FATAL] Port binding security violation!" >&2
    echo "Expected strictly '127.0.0.1:5433', but container is bound to '${HOST_IP}:${HOST_PORT}'." >&2
    echo "Remote (0.0.0.0), conflicting (5432), or non-loopback port bindings are strictly forbidden." >&2
    exit 1
fi

OTHER_PORTS=$(docker inspect -f '{{range $p, $conf := .NetworkSettings.Ports}}{{if ne $p "5432/tcp"}}{{$p}}{{end}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || true)
if [[ -n "${OTHER_PORTS}" ]]; then
    echo -e "\n[FATAL] Port binding violation: Unexpected additional exposed ports found: ${OTHER_PORTS}" >&2
    exit 1
fi
echo "[OK] Port binding verified: strictly 127.0.0.1:5433 -> 5432/tcp."

# 5. Bounded PostgreSQL Readiness Check (pg_isready)
echo "[4/6] Verifying database engine readiness via pg_isready..."
MAX_ATTEMPTS=30
IS_READY=0
for ((i=1; i<=MAX_ATTEMPTS; i++)); do
    if docker exec "${CONTAINER_NAME}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
        IS_READY=1
        break
    fi
    sleep 1
done

if [[ "${IS_READY}" -ne 1 ]]; then
    echo -e "\n[FATAL] PostgreSQL engine in '${CONTAINER_NAME}' did not become ready after ${MAX_ATTEMPTS} seconds." >&2
    exit 1
fi
echo "[OK] PostgreSQL engine is ready to accept connections."

# 6. Exact Trimmed Database Name Verification
echo "[5/6] Verifying current database identity..."
RAW_DB=$(docker exec "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT current_database();" 2>/dev/null || true)
TRIMMED_DB=$(echo "${RAW_DB}" | tr -d '[:space:]')
if [[ "${TRIMMED_DB}" != "${DB_NAME}" ]]; then
    echo -e "\n[FATAL] Target database mismatch: Expected exact database '${DB_NAME}', but got '${TRIMMED_DB}'." >&2
    exit 1
fi
echo "[OK] Target database verified: strictly '${TRIMMED_DB}'."

# 7. Step Execution Function with Strict Exit-Code Propagation
run_step() {
    local title="$1"
    local file_path="$2"
    echo -e "\n--> Step: ${title} (${file_path})"
    if [[ ! -f "${file_path}" ]]; then
        echo -e "\n[FATAL] SQL file not found: ${file_path}" >&2
        exit 1
    fi

    # Explicit if/else captures failure reliably under set -e, preserves the exact exit code,
    # prints a failure message, and halts execution before any subsequent steps run.
    if docker exec -i "${CONTAINER_NAME}" psql -U "${DB_USER}" -d "${DB_NAME}" -v ON_ERROR_STOP=1 < "${file_path}"; then
        echo "[OK] Step completed successfully: ${title}"
    else
        local step_exit=$?
        echo -e "\n[ERROR] Step failed with non-zero exit code (${step_exit}): ${title}" >&2
        echo "[ABORT] Halting test runner immediately. Zero downstream execution." >&2
        exit "${step_exit}"
    fi
}

# 8. Execute Test Pipeline
echo -e "\n[6/6] Executing SQL Migration & Test Pipeline..."

# Step 1: Initialize Local Supabase-Mock Harness
run_step "Initialize Local Harness Dependencies" "supabase/tests/01_local_harness_setup.sql"

# Step 2: First-Run Migration
run_step "Apply Migration 20261019_001 (First Run)" "supabase/migrations/20261019_001_phase7c_core_schema.sql"

# Step 3: Immediate Rerun Migration (Idempotency Verification)
run_step "Apply Migration 20261019_001 (Immediate Rerun)" "supabase/migrations/20261019_001_phase7c_core_schema.sql"

# Step 4: Run Integration Tests
run_step "Run Comprehensive Integration Test Suite" "supabase/tests/02_run_integration_tests.sql"

echo -e "\n================================================================="
echo "ALL LOCAL TESTS PASSED SUCCESSFULLY!"
echo "================================================================="
exit 0
