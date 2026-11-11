#!/usr/bin/env bash
set -euo pipefail
lab_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
project_dir="$(cd -- "$lab_dir/../.." && pwd)"
mkdir -p "$project_dir/.local/memory-setup/tmp" "$project_dir/.local/npm-cache"
export TMPDIR="$project_dir/.local/memory-setup/tmp"
export npm_config_cache="$project_dir/.local/npm-cache"
npm ci --prefix "$project_dir/runtime/harness-lab/pi" --no-audit --no-fund
bash "$lab_dir/agno/setup.sh"
