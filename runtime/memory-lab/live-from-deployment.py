#!/usr/bin/env python3
"""Read the existing project's CLOVA credential over SSH; run locally; remove its private copy.

The remote project is read only. Key material never appears in command arguments or output.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
if "--live" not in sys.argv[1:]:
    raise SystemExit("Pass --live to use the configured project's real CLOVA API.")

# Fixed existing service and project, not an arbitrary credential discovery mechanism.
REMOTE = r'''
import json
from pathlib import Path
import sys
try:
    values = {}
    for line in Path('/home/gino/apps/clova-api-lab/.env').read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.removeprefix('export ').split('=', 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        values[key.strip()] = value
    secret = values.get('CLOVA_API_KEY', '')
    if not secret and values.get('CLOVA_API_KEY_FILE'):
        secret = Path(values['CLOVA_API_KEY_FILE']).read_text().strip()
    if not secret or '\n' in secret or '\r' in secret:
        raise ValueError('unconfigured')
    sys.stdout.write(secret)
except Exception:
    sys.stderr.write('Configured project credential unavailable\n')
    sys.exit(1)
'''
local = ROOT / '.local' / 'memory-live-credentials'
local.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(local, 0o700)
credential_path = None
arguments = sys.argv[1:]
if sum(flag in arguments for flag in ("--h31-r2", "--h31", "--provider-smoke", "--policy-eval", "--policy-probe")) > 1:
    raise SystemExit("Choose one live runner.")
runner = ROOT / "runtime/memory-lab/live.mjs"
if "--h31-r2" in arguments:
    arguments.remove("--h31-r2")
    runner = ROOT / "runtime/clova/h31/run-r2.mjs"
if "--h31" in arguments:
    arguments.remove("--h31")
    runner = ROOT / "runtime/clova/h31/run.mjs"
if "--provider-smoke" in arguments:
    arguments.remove("--provider-smoke")
    runner = ROOT / "runtime/clova/provider-smoke.ts"
if "--policy-eval" in arguments and "--policy-probe" in arguments:
    raise SystemExit("Choose one live runner.")
if "--policy-probe" in arguments:
    arguments.remove("--policy-probe")
    runner = ROOT / "runtime/memory-lab/policy/voice-probe.mjs"
if "--policy-eval" in arguments:
    arguments.remove("--policy-eval")
    runner = ROOT / "runtime/memory-lab/policy/live.mjs"
try:
    received = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', 'hellcat', 'python3 -'],
        input=REMOTE.encode(), capture_output=True, timeout=20, check=False,
    )
    if received.returncode or not received.stdout.strip():
        raise RuntimeError('Existing deployment credential could not be read; no model request made.')
    with tempfile.NamedTemporaryFile(dir=local, prefix='clova-', suffix='.key', delete=False) as private:
        credential_path = Path(private.name)
        os.chmod(credential_path, 0o600)
        private.write(received.stdout.strip())
    del received
    env = dict(os.environ)
    env['CLOVA_API_KEY_FILE'] = str(credential_path)
    env['CLOVA_BASE_URL'] = 'https://clovastudio.stream.ntruss.com'
    child = subprocess.run(['node', str(runner), *arguments], cwd=ROOT, env=env)
    raise SystemExit(child.returncode)
except (RuntimeError, subprocess.TimeoutExpired):
    # Do not print subprocess objects or captured streams: they may contain key bytes.
    print('Unable to run with the existing deployment credential; see configured SSH/API settings.', file=sys.stderr)
    raise SystemExit(1)
finally:
    if credential_path is not None:
        credential_path.unlink(missing_ok=True)
