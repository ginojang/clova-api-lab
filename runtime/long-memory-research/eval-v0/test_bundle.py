"""Offline structural/transport regressions; no model or service calls."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import bundle


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=bundle.ROOT)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for path in bundle.ROOT.rglob("*"):
            if path.is_file() and "__pycache__" not in path.parts and not path.is_relative_to(self.root):
                dest = self.root / path.relative_to(bundle.ROOT)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)

    def change_rows(self, name, change):
        path = self.root / name
        data = bundle.rows(path)
        change(data)
        path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in data), encoding="utf-8")

    def test_full_bundle(self):
        report = bundle.validate(self.root, check_manifest=False)
        self.assertEqual((report["stories"], report["sessions"], report["targets"]), (32, 96, 96))

    def test_plan_tamper(self):
        path = self.root / "plan.json"
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(ValueError, "preregistered plan"):
            bundle.validate(self.root, check_manifest=False)

    def test_duplicate_probe(self):
        def change(data):
            data[0]["sessions"][1]["probe"]["id"] = data[0]["sessions"][0]["probe"]["id"]
        self.change_rows("scenarios.jsonl", change)
        with self.assertRaisesRegex(ValueError, "duplicate probe"):
            bundle.validate(self.root, check_manifest=False)

    def test_future_session_reordering(self):
        self.change_rows("scenarios.jsonl", lambda data: data[0]["sessions"].reverse())
        with self.assertRaisesRegex(ValueError, "chronology"):
            bundle.validate(self.root, check_manifest=False)

    def test_gold_leak_into_input(self):
        self.change_rows("scenarios.jsonl", lambda data: data[0]["sessions"][0]["probe"].update(answer_rubric="leaked"))
        with self.assertRaisesRegex(ValueError, "gold field leaked"):
            bundle.validate(self.root, check_manifest=False)

    def test_prefilled_blind_labels_rejected(self):
        self.change_rows("blind/annotation_template.jsonl", lambda data: data[0].update(verdict="pass"))
        with self.assertRaisesRegex(ValueError, "prefilled annotation"):
            bundle.validate(self.root, check_manifest=False)

    def test_export_contains_only_requested_session(self):
        story = bundle.rows(self.root / "scenarios.jsonl")[0]
        payload = bundle.export_stage(self.root, story["id"], 1)
        self.assertEqual(payload["session"], story["sessions"][0])
        self.assertNotIn("family", payload)
        self.assertNotIn("domain", payload)
        encoded = json.dumps(payload, ensure_ascii=False)
        for later in story["sessions"][1:]:
            self.assertNotIn(later["probe"]["id"], encoded)
        self.assertNotIn("answer_rubric", encoded)

    def test_export_uses_probe_scope_after_scope_change(self):
        story = next(s for s in bundle.rows(self.root / "scenarios.jsonl") if s["family"] == "principal_isolation")
        payload = bundle.export_stage(self.root, story["id"], 2)
        self.assertEqual(payload["scope"], story["sessions"][1]["probe"]["scope"])
        self.assertNotEqual(payload["scope"], story["scope"])

    def test_export_rejects_unknown_and_invalid_stage(self):
        with self.assertRaises(ValueError):
            bundle.export_stage(self.root, "missing", 1)
        story_id = bundle.rows(self.root / "scenarios.jsonl")[0]["id"]
        for index in (0, 4, -1):
            with self.assertRaises(ValueError):
                bundle.export_stage(self.root, story_id, index)

    def test_export_rejects_gold_injection_before_transport(self):
        self.change_rows("scenarios.jsonl", lambda data: data[0]["sessions"][0]["probe"].update(answer_rubric="leaked"))
        story_id = bundle.rows(self.root / "scenarios.jsonl")[0]["id"]
        with self.assertRaisesRegex(ValueError, "gold field leaked"):
            bundle.export_stage(self.root, story_id, 1)

    def test_export_requires_sealed_manifest(self):
        (self.root / "manifest.json").unlink()
        story_id = bundle.rows(self.root / "scenarios.jsonl")[0]["id"]
        with self.assertRaises(OSError):
            bundle.export_stage(self.root, story_id, 1)

    def test_no_overwrite(self):
        path = self.root / "out.json"
        bundle.write_new(path, {"original": True})
        with self.assertRaises(FileExistsError):
            bundle.write_new(path, {"replacement": True})
        self.assertEqual(json.loads(path.read_text()), {"original": True})

    def test_duplicate_json_keys_and_nonfinite_rejected(self):
        for text in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '{"x":1e9999}'):
            with self.assertRaises(ValueError):
                bundle.parse(text)


if __name__ == "__main__":
    unittest.main()
