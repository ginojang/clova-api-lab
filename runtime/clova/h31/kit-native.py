#!/usr/bin/env python3
"""Official-kit loader: genuine installed Elda loop/events, explicit test profile."""
import argparse
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
p = argparse.ArgumentParser()
p.add_argument('--profile', required=True)
p.add_argument('--workspace', required=True)
p.add_argument('--cli-dir', required=True)
a = p.parse_args()
profile = json.loads(Path(a.profile).read_text())
sys.path.insert(0, a.cli_dir)
from adapters.loop import LoopAdapter
import events
adapter = LoopAdapter(profile)
try:
    sys.exit(events.run('kit-native', {'kit-native': {'kind': 'giant', 'gate': 'loop', 'quota': False}},
                       lambda _: adapter, ['--cwd', a.workspace, '--approve', 'ask', '--model', profile['model']]))
finally:
    adapter.close()
