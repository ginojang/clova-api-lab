#!/usr/bin/env bash
set -euo pipefail
lab_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
mkdir -p "$lab_dir/.tmp" "$lab_dir/.pip-cache"
export TMPDIR="$lab_dir/.tmp"
export PIP_CACHE_DIR="$lab_dir/.pip-cache"
python3 -m venv "$lab_dir/.venv.local"
"$lab_dir/.venv.local/bin/python" -m pip install -r "$lab_dir/requirements.lock"
