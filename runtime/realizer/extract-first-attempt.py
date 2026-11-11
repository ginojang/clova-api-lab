#!/usr/bin/env python3
"""Recover transport framing, never rewrite teacher text or select by quality."""
import argparse
import hashlib
import json
from pathlib import Path


def recover(content):
    try:
        return json.loads(content), False
    except json.JSONDecodeError:
        # HCX-005 omitted the final root-object brace in five first attempts.
        # Only this exact, auditable suffix repair is allowed; never repair text.
        if not content.rstrip().endswith('}]'):
            raise
        return json.loads(content.rstrip() + '}'), True


def extract(run, fixture):
    source = json.loads((run / 'report.json').read_text())
    requests = json.loads((run / 'requests.json').read_text())
    fixture_bytes = fixture.read_bytes()
    assert hashlib.sha256(fixture_bytes).hexdigest() == source['fixtureSha256']
    outputs, audit = [], []
    for request in requests:
        first = [a for a in source['attempts'] if a['batch'] == request['batch'] and a['attempt'] == 1]
        assert len(first) == 1
        record = first[0]
        assert record['answer']['finishReason'] == 'stop'
        content = record['answer']['message']['content']
        value, repaired = recover(content)
        assert set(value) == {'outputs'}
        rows, jobs = value['outputs'], {j['id']: j for j in request['jobs']}
        batch_audit = {'batch': request['batch'], 'attempt': 1, 'ordinal': record['ordinal'],
                       'rawContentSha256': hashlib.sha256(content.encode()).hexdigest(),
                       'appendedRootBrace': repaired, 'originalStrictParserAccepted': not bool(record.get('error')),
                       'additionalFieldsNotUsedAsText': []}
        if len(rows) != len(jobs) or {r['id'] for r in rows} != set(jobs):
            batch_audit.update({'rejected': 'Whole batch rejected: incomplete or mismatched request IDs.',
                                'rawRowCount': len(rows), 'rawIds': [r['id'] for r in rows],
                                'missingIds': sorted(set(jobs) - {r['id'] for r in rows}),
                                'unexpectedIds': sorted({r['id'] for r in rows} - set(jobs))})
            audit.append(batch_audit)
            continue
        extra = []
        for row in rows:
            assert isinstance(row['text'], str) and row['text'].strip()
            additional = {k: v for k, v in row.items() if k not in {'id', 'text'}}
            if additional:
                extra.append({'id': row['id'], 'additionalFields': additional})
            outputs.append({**jobs[row['id']], 'text': row['text'], 'source': 'model_raw'})
        batch_audit['additionalFieldsNotUsedAsText'] = extra
        audit.append(batch_audit)
    assert len(outputs) == len({r['id'] for r in outputs}) <= 120
    return {'schemaVersion': '1.0', 'model': source['model'], 'fixtureSha256': source['fixtureSha256'],
            'selection': 'First attempt for every batch; reject whole batches with mismatched IDs; no semantic selection; exact text retained.',
            'outputs': outputs}, {
                'schema': 'realizer-transport-extraction-v1', 'selectedFirstAttempts': len(audit),
                'selectedPairs': len(outputs), 'strictlyAcceptedBatches': sum(a['originalStrictParserAccepted'] for a in audit),
                'rejectedBatches': sum('rejected' in a for a in audit), 'plannedPairs': 120,
                'missingPlannedIds': sorted({j['id'] for q in requests for j in q['jobs']} - {r['id'] for r in outputs}),
                'rootBraceRepairs': sum(a['appendedRootBrace'] for a in audit),
                'rowsWithAdditionalFields': sum(len(a['additionalFieldsNotUsedAsText']) for a in audit),
                'textEdits': 0, 'additionalCalls': 0, 'unusedRetryResponses': len(source['attempts']) - len(audit),
                'clientCallAttemptsIncludingRetries': source['clientCallAttempts'], 'usageAllAttempts': source['usage'],
                'audit': audit}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    samples, audit = extract(args.run, Path(__file__).with_name('fixtures.json'))
    for name, value in [('samples-first-attempt.json', samples), ('transport-extraction.json', audit)]:
        (args.run / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: v for k, v in audit.items() if k != 'audit'}, ensure_ascii=False))
