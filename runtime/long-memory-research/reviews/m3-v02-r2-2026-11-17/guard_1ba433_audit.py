#!/usr/bin/env python3
"""Reproduce pinned pure guard self-tests without importing serving modules."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


REF = "1ba433abdc3e43fd9486d099cd854e16768912fa"
FILES = {
    "memory": ("elda-orchestrator/src/core/eldacore/s6memory.ts", "130512935a038e78cdf5d1118771a14bc4def27cd1620304d3e8b0bb62bae4de"),
    "chat": ("elda-orchestrator/src/core/eldacore/s6chatEnd.ts", "f8076f81f6587be59bea007ee0bdaa1b2c51c11ec60c4a1ffce6d772101106a3"),
    "selftest": ("elda-orchestrator/src/tools/s6GuardSelfTest.ts", "32acdf35dea0925c87d533d46e2b71fdc366b085b06d793dcf839e64cadb40e4"),
}

NODE_HARNESS = r"""
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const sources = JSON.parse(readFileSync(0, 'utf8'));
function extract(source, name) {
  const pattern = new RegExp('^(?:export )?function ' + name + '\\b[\\s\\S]*?^}', 'm');
  const found = source.match(pattern);
  if (!found) throw new Error('Missing reviewed function ' + name);
  return found[0].replace(/^export /, '');
}
const human = sources.memory.match(/^const HUMAN = .*;$/m);
if (!human) throw new Error('Missing HUMAN constant');
const parts = [human[0], extract(sources.memory, 'locateIn'),
  extract(sources.memory, 'checkEvidence'), extract(sources.memory, 'correctionGuard'),
  extract(sources.chat, 'didSourceWhy')];
const test = sources.selftest.replace(/^import[^\n]*\n/gm, '');
const logs = [];
let reportedExit = null;
const context = vm.createContext({
  console: { log: (...xs) => logs.push(xs.join(' ')) },
  process: { exit: code => { reportedExit = code; } },
});
// Only the reviewed function declarations, HUMAN, and test body reach the VM.
// No application imports, environment, DB, model client, or service main run.
const code = stripTypeScriptTypes(parts.join('\n') + '\n' + test);
new vm.Script(code, { filename: 'pinned-extracted-guards-and-selftest.js' })
  .runInContext(context, { timeout: 1000 });
const official = JSON.parse(vm.runInContext('JSON.stringify({n, fail})', context));
const diagnostics = JSON.parse(vm.runInContext(`JSON.stringify((() => {
  const ts = [{turn_index:1, speaker:'assistant', text:'안녕하세요.'}];
  const rows = [];
  const add = (id, actual, expected) => rows.push({id, actual, expected,
    matches_observation:JSON.stringify(actual)===JSON.stringify(expected)});
  add('known_block_rejected', didSourceWhy({turn_index:1}, ts, {'1':'block'}), 'did_source_bad');
  add('genuine_unknown_is_accepted', didSourceWhy({turn_index:1}, ts, {'1':'unknown'}), null);
  add('authoritative_lookup_error_rejected', didSourceWhy({turn_index:1}, ts, {'1':'lookup_error'}), 'did_s6_lookup_error');
  add('out_of_allowlist_abstain_rejected', didSourceWhy({turn_index:1}, ts, {'1':'abstain'}), 'did_s6_unexpected');
  add('out_of_allowlist_arbitrary_string_rejected', didSourceWhy({turn_index:1}, ts, {'1':'unexpected_status'}), 'did_s6_unexpected');
  add('missing_status_entry_accepted', didSourceWhy({turn_index:1}, ts, {}), null);
  return rows;
})())`, context, {timeout:1000}));
const ok = official.n === 22 && official.fail === 0 && reportedExit === 0
  && diagnostics.every(d => d.matches_observation);
console.log(JSON.stringify({ok, selftest:{...official, reported_exit:reportedExit, logs}, diagnostics}));
process.exitCode = ok ? 0 : 1;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, help="Write the audit artifact only")
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    repo = subprocess.check_output(["git", "-C", str(here), "rev-parse", "--show-toplevel"], text=True).strip()
    sources = {}
    for label, (path, digest) in FILES.items():
        body = subprocess.check_output(["git", "-C", repo, "show", f"{REF}:{path}"])
        if hashlib.sha256(body).hexdigest() != digest:
            raise SystemExit(f"Pinned source hash mismatch: {path}")
        sources[label] = body.decode("utf-8")
    run = subprocess.run(["node", "--input-type=module", "-e", NODE_HARNESS],
                         input=json.dumps(sources), text=True, capture_output=True, timeout=10)
    if run.returncode not in (0, 1) or not run.stdout.strip():
        raise SystemExit(run.stderr or f"Node failed: {run.returncode}")
    result = json.loads(run.stdout)
    report = {
        "source_repo": "ginojang/GanpanAI", "source_sha": REF,
        "sources": {key: {"path": path, "sha256": digest} for key, (path, digest) in FILES.items()},
        "method": "Hash-pinned read-only git blobs; extracted locateIn/checkEvidence/correctionGuard/didSourceWhy plus HUMAN and original 22-test body; Node stripTypeScriptTypes and isolated VM; application imports removed.",
        "model_api_calls": 0, "db_calls": 0, "serving_imports": 0,
        "interpretation": "Diagnostic expectations describe observed guard behavior, not desired policy or human gold. The lookup-error diagnostic supplies the authoritative marker directly; it does not run gather or a DB failure. The fixed gather/model/save boundary is a separate static source finding.",
        "results": result,
        "contract_ref": "ginojang/elda-resoner@b91323f4580e17fec9431289c88e0f601dccd669:memory/S6_MEMORY_CONTRACT_v0.md:3",
        "static_findings": [
            {"path": FILES["chat"][0], "lines": [103, 107],
             "finding": "CLOSED: explicit pass/unknown/none allowlist replaces blacklist. Missing status becomes none; fix/block and unexpected status strings are rejected. Pure diagnostics reproduce abstain and arbitrary-string rejection."},
            {"path": FILES["chat"][0], "lines": [106],
             "finding": "CLOSED for actual lookup_error: reason renamed from did_source_lookup_error to contractual did_s6_lookup_error."},
            {"path": FILES["chat"][0], "lines": [107],
             "finding": "CLASSIFICATION DIFFERENCE: runtime rejects out-of-list values as did_s6_unexpected. Contract b91323f requires normalization to lookup_error and a single did_s6_lookup_error reason. Rejection outcome agrees; exact cause keys and their aggregation do not yet agree."},
            {"path": FILES["chat"][0], "lines": [101],
             "finding": "Source index now requires an integer; the original self-test adds float and boolean rejection. This audit claims only pure-guard execution, not deployment or end-to-end operation."},
        ],
    }
    if args.json:
        expected = here / "guard_1ba433_audit.json"
        if args.json.resolve() != expected:
            raise SystemExit(f"Artifact path must be {expected}")
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": result["ok"], "selftest": f"{result['selftest']['n']-result['selftest']['fail']}/{result['selftest']['n']}",
                      "diagnostics": len(result["diagnostics"]), "artifact": str(args.json) if args.json else None}, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
