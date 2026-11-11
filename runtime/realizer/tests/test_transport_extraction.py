"""Check that transport recovery cannot silently rewrite model text."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('transport_extraction', ROOT / 'extract-first-attempt.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TransportTest(unittest.TestCase):
    def test_one_missing_root_brace_only(self):
        text = '민은 책 3권을 빌리지 않았다. "오늘"이 아니다.'
        raw = json.dumps({'outputs': [{'id': 'x', 'text': text}]}, ensure_ascii=False)
        parsed, repaired = module.recover(raw[:-1])
        self.assertTrue(repaired)
        self.assertEqual(parsed['outputs'][0]['text'], text)

    def test_valid_json_is_not_repaired(self):
        self.assertEqual(module.recover('{"outputs":[]}'), ({'outputs': []}, False))

    def test_truncated_text_is_not_repaired(self):
        with self.assertRaises(json.JSONDecodeError):
            module.recover('{"outputs":[{"id":"x","text":"민은')

    def test_trailing_comma_is_not_repaired(self):
        with self.assertRaises(json.JSONDecodeError):
            module.recover('{"outputs":[{"id":"x","text":"문장",}]')

    def test_actual_evidence_uses_first_response_without_text_edits(self):
        run = ROOT / 'results/teacher-v1-2026-11-11'
        samples, audit = module.extract(run, ROOT / 'fixtures.json')
        self.assertEqual((audit['selectedPairs'], audit['rejectedBatches'], audit['unusedRetryResponses']), (108, 1, 6))
        original = json.loads((run / 'report.json').read_text())
        first_texts = {}
        for attempt in original['attempts']:
            if attempt['attempt'] == 1:
                parsed, _ = module.recover(attempt['answer']['message']['content'])
                first_texts.update({r['id']: r['text'] for r in parsed['outputs']})
        for row in samples['outputs']:
            self.assertEqual(row['text'], first_texts[row['id']])
        self.assertFalse(any(r['skeletonId'] in {'R05', 'R06'} for r in samples['outputs']))
        self.assertEqual(audit['textEdits'], 0)
        self.assertEqual(audit['additionalCalls'], 0)


if __name__ == '__main__':
    unittest.main()
