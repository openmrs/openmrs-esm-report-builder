#!/usr/bin/env bash
set -eu

# Builds and starts the OpenMRS 3.x reference stack (gateway, frontend, backend, db)
# with this module assembled into the frontend, and waits for the backend to be
# ready. Adapted from openmrs-esm-core's e2e setup for this single-module repo.
#
# In CI it exits once the stack is ready, exporting E2E_BASE_URL and E2E_PORT for
# the workflow. Locally it runs Playwright afterwards and tears the stack down.

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
repository_root=$(cd -- "$script_dir/../../.." && pwd)
compose_file="$script_dir/docker-compose.yml"

find_available_port() {
  local port=8080
  while lsof -i:"$port" >/dev/null 2>&1 || nc -z localhost "$port" 2>/dev/null; do
    port=$((port + 1))
    if [[ $port -gt 9000 ]]; then
      echo "ERROR: Could not find available port in range 8080-9000" >&2
      exit 1
    fi
  done
  echo "$port"
}

generate_project_name() {
  local branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "local")
  # Sanitize: lowercase, replace non-alphanumeric with dash, limit length
  echo "openmrs-e2e-$(echo "$branch" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-40)"
}

wait_for_gateway() {
  local max_attempts=30
  local attempt=0
  echo "Waiting for gateway container to start..."
  while ! docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" ps --status running --services 2>/dev/null | grep -q "^gateway$"; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "ERROR: Gateway container failed to start within 60 seconds" >&2
      echo "Container status:" >&2
      docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" ps >&2
      echo "Gateway logs:" >&2
      docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" logs gateway >&2
      exit 1
    fi
    sleep 2
  done
  echo "Gateway container is running!"
}

wait_for_backend() {
  local url="$1"
  local max_attempts=60
  local attempt=0
  echo "Waiting for backend to be ready at $url..."
  while ! curl -sf "$url/login.htm" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $max_attempts ]]; then
      echo "ERROR: Backend failed to start within 5 minutes" >&2
      exit 1
    fi
    echo "  Attempt $attempt/$max_attempts - waiting 5 seconds..."
    sleep 5
  done
  echo "Backend is ready!"
}

cleanup() {
  # In CI mode, don't clean up (CI handles its own cleanup)
  if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "CI environment detected - skipping cleanup"
    return
  fi
  echo ""
  echo "Stopping Docker containers..."
  docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" down -v 2>/dev/null || true
  echo "Cleanup complete."
}
trap cleanup EXIT

project_name=$(generate_project_name)
export E2E_PORT=$(find_available_port)
base_url="http://localhost:$E2E_PORT/openmrs"

echo "========================================"
echo "OpenMRS E2E Test Runner"
echo "Project name: $project_name"
echo "Port: $E2E_PORT"
echo "Base URL: $base_url"
echo "========================================"

echo ""
echo "Building and starting Docker containers..."
docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" build frontend
docker compose --project-directory "$repository_root" -p "$project_name" -f "$compose_file" up -d

wait_for_gateway
wait_for_backend "$base_url"

if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo ""
  echo "CI environment detected - backend ready, exiting for CI to run tests"
  echo "Base URL: $base_url"
  # Export environment variables for GitHub Actions
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "E2E_BASE_URL=$base_url" >> "$GITHUB_ENV"
    echo "E2E_PORT=$E2E_PORT" >> "$GITHUB_ENV"
  fi
  exit 0
fi

# Local mode: run Playwright from the repository root, then clean up via trap
cd "$repository_root"
if [[ ! -f .env ]]; then
  echo "Copying example.env to .env..."
  cp example.env .env
fi

echo ""
echo "========================================"
echo "Running Playwright tests..."
echo "========================================"

set +e # Don't exit on test failure so cleanup still runs
E2E_BASE_URL="$base_url" yarn playwright test "$@"
test_exit_code=$?
set -e

exit $test_exit_code
