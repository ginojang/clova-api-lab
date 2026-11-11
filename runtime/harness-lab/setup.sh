#!/usr/bin/env bash
set -euo pipefail
lab_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(cd -- "$lab_dir/../.." && pwd)"
mkdir -p "$project_dir/.local/harness-setup/tmp" "$project_dir/.local/npm-cache"
export TMPDIR="$project_dir/.local/harness-setup/tmp"
export npm_config_cache="$project_dir/.local/npm-cache"
npm ci --prefix "$lab_dir/vercel" --no-audit --no-fund
npm ci --prefix "$lab_dir/pi" --no-audit --no-fund
bash "$lab_dir/pydantic/setup.sh"
