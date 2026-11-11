#!/usr/bin/env python3
"""Aggregate two independent AI reviews without promoting them to human truth."""
from collections import Counter
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN = ROOT / 'results/teacher-v1-2026-11-11'
AXES = ('meaningPreserved', 'styleConsistent', 'natural')


def read(name):
    return json.loads((RUN / name).read_text())


def score(row):
    return all(row[k] for k in AXES) and not row['uncertain']


def main():
    samples = read('samples-first-attempt.json')['outputs']
    sample_ids = {s['id'] for s in samples}
    reviews = {}
    for name in ('a', 'b'):
        review = read('review-' + name + '.json')
        rows = review['rows']
        assert len(rows) == len(samples) and {r['id'] for r in rows} == sample_ids
        for row in rows:
            assert all(type(row[k]) is bool for k in (*AXES, 'uncertain'))
            assert isinstance(row['reason'], str) and row['reason'].strip()
        reviews[name] = {r['id']: r for r in rows}
    lexical = read('slot-check.json')
    lexical_ids = {r['id'] for r in lexical['results'] if r['lexicalPass']}
    axes = {}
    for axis in AXES:
        disagree = sorted(i for i in sample_ids if reviews['a'][i][axis] != reviews['b'][i][axis])
        axes[axis] = {'aPass': sum(r[axis] for r in reviews['a'].values()),
                      'bPass': sum(r[axis] for r in reviews['b'].values()),
                      'bothPass': sum(reviews['a'][i][axis] and reviews['b'][i][axis] for i in sample_ids),
                      'agreementCount': len(samples) - len(disagree),
                      'agreementRate': (len(samples) - len(disagree)) / len(samples),
                      'disagreementIds': disagree}
    both_all = sorted(i for i in sample_ids if all(score(reviews[r][i]) for r in reviews))
    both_meaning_fail = sorted(i for i in lexical_ids if all(not reviews[r][i]['meaningPreserved'] for r in reviews))
    per_style = {}
    for style in ('friendly', 'blunt', 'historical'):
        ids = {s['id'] for s in samples if s['style'] == style}
        per_style[style] = {'reviewed': len(ids), 'planned': 40,
                            'lexicalPass': len(ids & lexical_ids),
                            'bothAllCertain': len(ids & set(both_all)),
                            'axes': {axis: {r: sum(reviews[r][i][axis] for i in ids) for r in reviews} for axis in AXES}}
    text_counts = Counter(s['text'] for s in samples)
    summary = {
        'schema': 'realizer-independent-ai-evaluation-v1',
        'scope': 'Two independent AI judgments; no human gold labels and no proof of full persona retention.',
        'plannedPairs': 120, 'reviewedPairs': len(samples), 'reviewedSkeletons': len({s['skeletonId'] for s in samples}),
        'coverage': len(samples) / 120, 'transport': read('transport-extraction.json'),
        'lexical': lexical['summary'], 'lexicalPassAmongRecovered': len(lexical_ids) / len(samples),
        'independentReviewAxes': axes,
        'reviewAllCertain': {r: sum(score(v) for v in rows.values()) for r, rows in reviews.items()},
        'reviewUncertain': {r: sum(v['uncertain'] for v in rows.values()) for r, rows in reviews.items()},
        'bothAllCertain': len(both_all), 'bothAllCertainIds': both_all,
        'bothAllCertainAmongRecovered': len(both_all) / len(samples),
        'bothAllCertainAmongPlanned': len(both_all) / 120,
        'lexicalPassButBothReviewsRejectMeaning': both_meaning_fail,
        'lexicalPassAndBothAllCertain': sorted(lexical_ids & set(both_all)),
        'perStyle': per_style,
        'duplicates': {'uniqueTexts': len(text_counts), 'repeatedExactTexts': {t: n for t, n in text_counts.items() if n > 1},
                       'note': 'Two variants and three styles per skeleton are correlated, not independent population samples.'},
        'fallback': read('fallback.json')['finalSummary'],
        'decision': 'Do not treat the unfiltered teacher corpus or lexical fallback output as accepted training data.',
    }
    (RUN / 'evaluation-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({k: summary[k] for k in ['plannedPairs', 'reviewedPairs', 'bothAllCertain', 'reviewAllCertain', 'reviewUncertain']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
