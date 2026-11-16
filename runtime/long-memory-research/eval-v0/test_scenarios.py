"""Consistency checks using deliberately synthetic observations, not a model eval."""
import copy
import hashlib
import unittest

import build_dataset
import bundle
import scorer


def mock_observation(target):
    artifacts = {}
    grouped = {}
    for check in target["checks"]:
        grouped.setdefault(check["path"], []).append(check)
    for path, checks in grouped.items():
        fixed = next((c["value"] for c in checks if c["operator"] in {"eq", "set_eq"}), None)
        if any(c["operator"] in {"eq", "set_eq"} for c in checks):
            actual = copy.deepcopy(fixed)
        elif any(c["operator"] == "lte" for c in checks):
            actual = 0
        else:
            actual = []
            for check in checks:
                if check["operator"] == "contains" and check["value"] not in actual:
                    actual.append(copy.deepcopy(check["value"]))
        current = artifacts
        parts = scorer.pointer_parts(path)[1:]
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = actual
    answer = "합성 채점기 점검용 응답. 모델이 만든 결과가 아닙니다."
    return {"id": target["id"], "run_id": "synthetic-scorer-test-only", "answer": answer,
            "artifacts": artifacts,
            "evidence": {"source_ref": "synthetic-unit-test; generated from gold, never serving evidence",
                         "source_sha256": "0" * 64},
            "judgment": {"verdict": "pass", "answer_sha256": hashlib.sha256(answer.encode()).hexdigest(),
                         "judge_id": "synthetic-unit-test", "judge_version": "v0.1",
                         "rationale": "채점 함수 검사용 모의 라벨; 의미 품질 측정 아님"}}


class ScenarioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gold = bundle.rows(bundle.ROOT / "gold.jsonl")
        cls.stories = bundle.rows(bundle.ROOT / "scenarios.jsonl")

    def test_generated_files_are_byte_reproducible(self):
        for name, content in build_dataset.build().items():
            self.assertEqual((bundle.ROOT / name).read_bytes(), content.encode("utf-8"), name)

    def test_all_targets_have_jointly_satisfiable_structural_checks(self):
        predictions = [mock_observation(row) for row in self.gold]
        report = scorer.score(self.gold, predictions)
        self.assertEqual(report["status"], "pass", [t for t in report["targets"] if t["status"] != "pass"])
        self.assertEqual(report["coverage"]["passed"], 96)
        self.assertEqual(report["semantic"]["passed"], 96)
        self.assertEqual(report["physical_deletion"], "not_measured")

    def test_real_gold_missing_results_do_not_shrink_denominator(self):
        report = scorer.score(self.gold, [])
        self.assertEqual(report["coverage"]["unknown"], 96)
        self.assertEqual(report["semantic"]["unknown"], 96)
        self.assertEqual(report["status"], "incomplete")
        self.assertEqual(report["gate_overall"]["passed"], 0)

    def test_actual_isolation_probe_fails_for_quiet_injected_leak(self):
        target = next(g for g in self.gold if g["family"] == "principal_isolation" and g["id"].endswith("q2"))
        prediction = mock_observation(target)
        forbidden = next(c["value"] for c in target["checks"] if c["path"] == "/artifacts/injected_values" and c["operator"] == "excludes")
        prediction["artifacts"]["injected_values"].append(forbidden)
        report = scorer.score([target], [prediction])
        self.assertEqual(report["semantic"]["passed"], 1)
        self.assertEqual(report["gate_overall"]["status"], "fail")

    def test_positive_denominator_comes_from_recall_targets(self):
        positives = sum(g["positive"] for g in self.gold)
        recall_targets = sum(any(c["metric"] == "eligible_recall" for c in g["checks"]) for g in self.gold)
        self.assertEqual(positives, recall_targets)
        self.assertEqual(positives, 80)

    def test_challenge_is_identified_separately(self):
        challenges = [g for g in self.gold if g["interpretation"] == "challenge"]
        self.assertEqual(len(challenges), 2)
        self.assertEqual({g["family"] for g in challenges}, {"implicit_recall_budget"})

    def test_memory_value_checks_have_synthetic_source_spans(self):
        inputs = {s["id"]: "\n".join(e.get("text", "") for session in s["sessions"] for e in session["events"]) for s in self.stories}
        for target in self.gold:
            for check in target["checks"]:
                if check["path"].endswith("_values") and isinstance(check["value"], str):
                    self.assertIn(check["value"], inputs[target["scenario_id"]], (target["id"], check["id"]))

    def test_blind_observation_restores_event_keys_without_changing_answer(self):
        mapping = bundle.parse((bundle.ROOT / "private/blind_map.json").read_text(encoding="utf-8"))
        target = next(g for g in self.gold if g["family"] == "episode_provenance" and g["id"].endswith("q1"))
        original = mock_observation(target)
        blinded = copy.deepcopy(original)
        blinded["id"] = mapping["targets"][original["id"]]
        blinded["artifacts"]["episode_sources"] = {mapping["events"][key]: value for key, value in original["artifacts"]["episode_sources"].items()}
        raw_before = copy.deepcopy(blinded)
        restored = bundle.unblind_observations([blinded], mapping, "1" * 64, "2" * 64)[0]
        self.assertEqual(blinded, raw_before)
        self.assertEqual(restored["id"], original["id"])
        self.assertEqual(restored["artifacts"], original["artifacts"])
        self.assertEqual(restored["answer"], original["answer"])
        self.assertEqual(restored["judgment"], original["judgment"])
        self.assertEqual(restored["normalization"]["source_blind_id"], blinded["id"])

    def test_blind_observation_rejects_unknown_duplicate_and_mixed_source_ids(self):
        mapping = bundle.parse((bundle.ROOT / "private/blind_map.json").read_text(encoding="utf-8"))
        target = next(g for g in self.gold if g["family"] == "episode_provenance" and g["id"].endswith("q1"))
        row = mock_observation(target)
        with self.assertRaises(ValueError):
            bundle.unblind_observations([row], mapping, "1" * 64, "2" * 64)
        row["id"] = mapping["targets"][target["id"]]
        with self.assertRaisesRegex(ValueError, "unknown blind source"):
            bundle.unblind_observations([row], mapping, "1" * 64, "2" * 64)
        row["artifacts"].pop("episode_sources")
        with self.assertRaisesRegex(ValueError, "duplicate blind target"):
            bundle.unblind_observations([row, row], mapping, "1" * 64, "2" * 64)


if __name__ == "__main__":
    unittest.main()
