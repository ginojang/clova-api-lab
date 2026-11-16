import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import bundle

ROOT = Path(__file__).resolve().parent


class BundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix=".bundle-test-", dir=ROOT)
        self.root = Path(self.temp.name)
        for name in bundle.REQUIRED | {"manifest.json"}:
            source = ROOT / name
            if source.is_file():
                destination = self.root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        self.stories = bundle.rows(self.root / "scenarios.jsonl")

    def tearDown(self):
        self.temp.cleanup()

    def write_stories(self):
        (self.root / "scenarios.jsonl").write_text("".join(json.dumps(s, ensure_ascii=False) + "\n" for s in self.stories), encoding="utf-8")

    def test_complete_bundle(self):
        result = bundle.validate(self.root, check_manifest=False)
        self.assertEqual((result["stories"], result["checkpoints"]), (28, 84))

    def test_plan_mutation(self):
        path = self.root / "plan.json"
        path.write_text(path.read_text() + " ")
        with self.assertRaisesRegex(ValueError, "plan changed"):
            bundle.validate(self.root, check_manifest=False)

    def test_contract_mutation(self):
        path = self.root / "CONTRACT.md"
        path.write_text(path.read_text() + " ")
        with self.assertRaisesRegex(ValueError, "contract changed"):
            bundle.validate(self.root, check_manifest=False)

    def test_control_without_source(self):
        cp = self.stories[0]["checkpoints"][0]
        control = next(e for e in cp["events"] if e["kind"] == "control" and e["action"] == "settle_turn")
        control["params"] = {}
        self.write_stories()
        with self.assertRaisesRegex(ValueError, "source required"):
            bundle.validate(self.root, check_manifest=False)

    def test_future_source(self):
        cp = self.stories[0]["checkpoints"][0]
        control = next(e for e in cp["events"] if e["kind"] == "control" and e["action"] == "settle_turn")
        control["params"]["source_event_id"] = "future-turn"
        self.write_stories()
        with self.assertRaisesRegex(ValueError, "future/missing"):
            bundle.validate(self.root, check_manifest=False)

    def test_duplicate_mapping(self):
        path = self.root / "private/blind_map.json"
        mapping = bundle.parse(path.read_text())
        keys = list(mapping["targets"])
        mapping["targets"][keys[1]] = mapping["targets"][keys[0]]
        path.write_text(json.dumps(mapping))
        with self.assertRaisesRegex(ValueError, "mapping collision"):
            bundle.validate(self.root, check_manifest=False)

    def test_clock_cannot_move_backward_within_checkpoint(self):
        cp = self.stories[0]["checkpoints"][0]
        cp["events"] += [
            {"id": "clock-future", "kind": "control", "action": "advance_time", "params": {"to": "2099-01-02T12:00:00Z"}},
            {"id": "clock-backward", "kind": "control", "action": "advance_time", "params": {"to": "2099-01-02T11:00:00Z"}},
        ]
        self.write_stories()
        with self.assertRaisesRegex(ValueError, "backward fixture clock"):
            bundle.validate(self.root, check_manifest=False)

    def test_next_checkpoint_cannot_precede_clock(self):
        cp = self.stories[0]["checkpoints"][0]
        cp["events"].append({"id": "clock-future", "kind": "control", "action": "advance_time", "params": {"to": "2099-01-02T12:00:00Z"}})
        self.write_stories()
        with self.assertRaisesRegex(ValueError, "checkpoint before fixture clock"):
            bundle.validate(self.root, check_manifest=False)

    def test_blind_future_history_tamper(self):
        path = self.root / "blind/scenarios.jsonl"
        rows = bundle.rows(path)
        rows[0]["checkpoints"][0]["events"] += rows[0]["checkpoints"][2]["events"]
        path.write_text("".join(json.dumps(row) + "\n" for row in rows))
        with self.assertRaisesRegex(ValueError, "blind data/map mismatch"):
            bundle.validate(self.root, check_manifest=False)

    def test_current_checkpoint_only_export(self):
        # Validate with the same full source graph while an unsealed test copy
        # has no registration yet. Export itself may never select future input.
        with patch.object(bundle, "validate", side_effect=lambda root: BundleTests._validate_unsealed(root)):
            payload = bundle.export_checkpoint(self.root, self.stories[0]["id"], 2)
        self.assertEqual(set(payload), {"story_id", "scope", "checkpoint"})
        self.assertNotIn("family", payload)
        mapping = bundle.parse((self.root / "private/blind_map.json").read_text())
        future = mapping["checkpoints"][self.stories[0]["checkpoints"][2]["id"]]
        self.assertNotIn(future, json.dumps(payload))
        self.assertEqual(payload["checkpoint"]["id"], mapping["checkpoints"][self.stories[0]["checkpoints"][1]["id"]])

    def test_duplicate_json_keys(self):
        with self.assertRaisesRegex(ValueError, "duplicate JSON key"):
            bundle.parse('{"x":1,"x":2}')

    def test_unicode_separator_preserved(self):
        path = self.root / "unicode.jsonl"
        path.write_text('{"text":"가\u2028나"}\n', encoding="utf-8")
        self.assertEqual(bundle.rows(path), [{"text": "가\u2028나"}])

    def test_nonfinite_rejected(self):
        for content in ('{"x":NaN}', '{"x":1e999}'):
            with self.assertRaises(ValueError): bundle.parse(content)

    def test_exclusive_output(self):
        path = self.root / "result.json"
        bundle.write_new(path, {"first": 1})
        with self.assertRaises(FileExistsError): bundle.write_new(path, {"second": 2})
        self.assertEqual(bundle.parse(path.read_text()), {"first": 1})

    def test_unblind_preserves_answer_and_hash(self):
        mapping = bundle.parse((self.root / "private/blind_map.json").read_text())
        original, masked = next(iter(mapping["targets"].items()))
        story, blind_story = next(iter(mapping["stories"].items()))
        prediction = {"id": masked, "answer": blind_story + " 그대로", "judgment": {"answer_sha256": "a" * 64},
                      "artifacts": {}, "transport": {"story_id": blind_story}}
        saved = copy.deepcopy(prediction)
        result = bundle.unblind_observations([prediction], mapping, "b" * 64, "c" * 64)[0]
        self.assertEqual(result["id"], original)
        self.assertEqual(result["transport"]["story_id"], story)
        self.assertEqual(result["answer"], saved["answer"])
        self.assertEqual(result["judgment"], saved["judgment"])
        self.assertEqual(prediction, saved)

    def test_unblind_unknown_transport(self):
        mapping = bundle.parse((self.root / "private/blind_map.json").read_text())
        masked = next(iter(mapping["targets"].values()))
        with self.assertRaisesRegex(ValueError, "unknown blind transport"):
            bundle.unblind_observations([{"id": masked, "transport": {"job_id": "unknown"}}], mapping, "a" * 64, "b" * 64)

    def test_unblind_duplicate_target(self):
        mapping = bundle.parse((self.root / "private/blind_map.json").read_text())
        masked = next(iter(mapping["targets"].values()))
        with self.assertRaisesRegex(ValueError, "duplicate blind target"):
            bundle.unblind_observations([{"id": masked}, {"id": masked}], mapping, "a" * 64, "b" * 64)


BundleTests._validate_unsealed = staticmethod(lambda root, validator=bundle.validate: validator(root, check_manifest=False))

if __name__ == "__main__": unittest.main()
