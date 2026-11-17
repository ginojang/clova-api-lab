#!/usr/bin/env python3
"""Reproduce pinned pure guard self-tests without importing serving modules."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess


REF = "f31375dd8a1f8cdbaa61d167d47ee66606f007f5"
FILES = {
    "memory": ("elda-orchestrator/src/core/eldacore/s6memory.ts", "130512935a038e78cdf5d1118771a14bc4def27cd1620304d3e8b0bb62bae4de"),
    "chat": ("elda-orchestrator/src/core/eldacore/s6chatEnd.ts", "a2bca6075f28289cc40fdb724c02719b9d1e6e566b56dfd9a75f4c8bb83f430f"),
    "selftest": ("elda-orchestrator/src/tools/s6GuardSelfTest.ts", "f535c0e569681bf86952b4349b65582db25adb2267655812a98ef529c6e95443"),
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
  add('lookup_failure_mapped_to_unknown_is_accepted', didSourceWhy({turn_index:1}, ts, {'1':'unknown'}), null);
  add('what_and_outcome_not_bound_to_source_text', didSourceWhy({turn_index:1,kind:'install',what:'설치를 끝냈다',outcome:'완료'}, ts, {'1':'pass'}), null);
  function correction(id, text, origin, t, n) {
    const o = {op:'SUPERSEDE',target_id:'m1',new:{t:'카페'},
      correction_evidence:{turn_index:0,t,n}};
    correctionGuard(o, {turns:[{turn_index:0,speaker:'user',origin_kind:origin,text}],now_index:0,chat_memory:[]});
    add(id, {op:o.op, start:o.correction_evidence.start, target:o.target_id}, {op:'SUPERSEDE',start:text.indexOf(t),target:'m1'});
  }
  correction('non_correction_span_retained','저희 카페 간판 문의드려요','human','카페',0);
  correction('negated_correction_span_retained','이제 카페로 바꾼다는 뜻은 아니에요','human','이제',0);
  correction('mixed_origin_accepted','이제 카페로 바꿨어요','mixed','이제',0);
  correction('missing_nth_occurrence_falls_back','이제 카페로 바꿨어요','human','이제',99);
  return rows;
})())`, context, {timeout:1000}));
const ok = official.n === 17 && official.fail === 0 && reportedExit === 0
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
        "method": "Hash-pinned read-only git blobs; extracted locateIn/checkEvidence/correctionGuard/didSourceWhy plus HUMAN and original 17-test body; Node stripTypeScriptTypes and isolated VM; application imports removed.",
        "model_api_calls": 0, "db_calls": 0, "serving_imports": 0,
        "interpretation": "Diagnostic expectations describe observed guard behavior, not desired policy or human gold. The lookup-failure diagnostic simulates gather's unknown output; it does not run gather or a DB failure.",
        "results": result,
        "static_findings": [
            {"path": FILES["chat"][0], "lines": [43, 46, 98, 103, 203],
             "finding": "S6 lookup failure still maps all assistant turns to unknown; didSourceWhy accepts unknown. Existing block may be hidden by a failed lookup. No DB exploit or failure was executed."},
            {"path": FILES["chat"][0], "lines": [36, 40, 204, 213, 217],
             "finding": "Stored did now retains the C flattened turn_index. It is not the DB chat_turn, response hash, or judge ID, and what/outcome are not checked against source text."},
            {"path": FILES["memory"][0], "lines": [12, 38, 55, 58, 65],
             "finding": "Correction logic unchanged: human/mixed literal span, missing positive nth occurrence falls back, self-correction meaning not checked. The pinned reasoner scorer 5bbf43b2 only allows human and ignores n."},
            {"path": "elda-orchestrator/src/tools/s6ChatEndBatch.ts", "lines": [24, 31],
             "finding": "Batch and serving share didSourceWhy; full C parity does not follow. Batch promise check uses literal includes and pass, without serving's loose-markdown/actual-judge-range handling or applied-promise reuse reconstruction."},
        ],
    }
    if args.json:
        expected = here / "guard_f313_audit.json"
        if args.json.resolve() != expected:
            raise SystemExit(f"Artifact path must be {expected}")
        args.json.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": result["ok"], "selftest": f"{result['selftest']['n']-result['selftest']['fail']}/{result['selftest']['n']}",
                      "diagnostics": len(result["diagnostics"]), "artifact": str(args.json) if args.json else None}, ensure_ascii=False))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
