"""Synthetic offline regressions, including all 41 sealed v0.1 regressions."""

import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).parent


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


scorer = module_at("m3_v02_test_scorer", HERE / "scorer.py")
legacy_path = HERE.parent / "eval-v0" / "test_scorer.py"
assert hashlib.sha256(legacy_path.read_bytes()).hexdigest() == "169f90d15cc94d5875ea02332516e15da4d25e2143b952054464ae548bca27a2"
legacy = module_at("m3_v01_frozen_regressions", legacy_path)
legacy.scorer = scorer
# Legacy temporary fixtures stay in v1; no writes to the sealed predecessor.
legacy.__file__ = str(Path(__file__))
LegacyScorerTests = legacy.ScorerTests
LegacyFileAndCliTests = legacy.FileAndCliTests
check, gold, prediction = legacy.check, legacy.gold, legacy.prediction


def capture():
    return {"capture_complete": True, "capture_ref": "synthetic@fixture:request#1",
            "capture_sha256": "b" * 64, "fresh_values": ["approved"],
            "history_memory_values": [], "effective_active_values": ["approved"],
            "all_input_values": ["approved"], "fresh_tokens": 600,
            "token_method": "tokenizer:synthetic-unit-test", "emitted": True,
            "replacement_header": False, "withdrawn_slots": [],
            "rendered_item_ids": ["fact-1", "episode-1"],
            "recorded_item_ids": ["episode-1", "fact-1"]}


class ContextTests(unittest.TestCase):
    def setUp(self):
        self.g, self.p = gold(), prediction()
        self.g["checks"][1] = check("input_scope", "/artifacts/context/all_input_values",
                                    "excludes", "other_principal", metric="scope")
        self.p["artifacts"].update(context=capture(), history_watch_values=["withdrawn"])

    def result(self):
        return scorer.score([self.g], [self.p])

    def extra_check(self, path, value, operator="eq"):
        self.g["checks"].append(check("extra", path, operator, value, metric="extra"))

    def test_complete_capture_pass_does_not_certify_physical_deletion(self):
        result = self.result()
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["context_coverage"]["passed"], 1)
        self.assertEqual(result["physical_deletion"], "not_measured")
        self.assertFalse(result["policy_pass_implies_history_zero_exposure"])

    def test_s4_only_clean_projection_cannot_pass_context(self):
        del self.p["artifacts"]["context"]
        result = self.result()
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["metrics"]["scope"]["unknown"], 1)
        self.assertEqual(result["history_exposure"]["unknown"], 1)

    def test_capture_flag_and_provenance_all_required(self):
        variants = [{"capture_complete": False}, {"capture_ref": " "},
                    {"capture_complete": None}, {"capture_ref": None}, {"capture_sha256": None}]
        for mutation in variants:
            with self.subTest(mutation=mutation):
                p = copy.deepcopy(self.p)
                for key, value in mutation.items():
                    if value is None:
                        del p["artifacts"]["context"][key]
                    else:
                        p["artifacts"]["context"][key] = value
                result = scorer.score([self.g], [p])
                self.assertEqual(result["metrics"]["scope"]["unknown"], 1)
                self.assertEqual(result["context_coverage"]["unknown"], 1)

    def test_missing_all_input_values_is_not_empty_array(self):
        del self.p["artifacts"]["context"]["all_input_values"]
        self.assertEqual(self.result()["metrics"]["scope"]["unknown"], 1)

    def test_quiet_answer_and_clean_s4_do_not_hide_full_input_leak(self):
        self.p["artifacts"]["context"]["all_input_values"].append("other_principal")
        result = self.result()
        self.assertEqual(result["semantic"]["passed"], 1)
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["gate_overall"]["failed"], 1)

    def test_projection_is_computed_including_episodes_not_manual_boolean(self):
        self.extra_check("/artifacts/load_projection_matches", True)
        self.p["artifacts"]["load_projection_matches"] = False
        self.assertEqual(self.result()["status"], "pass")
        self.p["artifacts"]["load_projection_matches"] = True
        self.p["artifacts"]["context"]["recorded_item_ids"] = ["fact-1"]
        self.assertEqual(self.result()["metrics"]["extra"]["failed"], 1)

    def test_projection_context_alias_also_ignores_manual_success(self):
        self.extra_check("/artifacts/context/load_projection_matches", True)
        self.p["artifacts"]["context"].update(load_projection_matches=True, rendered_item_ids=[])
        self.assertEqual(self.result()["metrics"]["extra"]["failed"], 1)

    def test_projection_missing_ids_or_capture_is_unknown_even_with_manual_true(self):
        self.extra_check("/artifacts/load_projection_matches", True)
        self.p["artifacts"]["load_projection_matches"] = True
        for missing in ("rendered_item_ids", "recorded_item_ids", "capture_complete"):
            with self.subTest(missing=missing):
                p = copy.deepcopy(self.p)
                del p["artifacts"]["context"][missing]
                self.assertEqual(scorer.score([self.g], [p])["metrics"]["extra"]["unknown"], 1)

    def test_duplicate_item_ids_are_input_errors_even_without_capture(self):
        for key in ("rendered_item_ids", "recorded_item_ids"):
            with self.subTest(key=key):
                p = copy.deepcopy(self.p)
                p["artifacts"]["context"].update(capture_complete=False)
                p["artifacts"]["context"][key] = ["same", "same"]
                with self.assertRaises(scorer.InputError):
                    scorer.score([self.g], [p])

    def test_exposure_counts_old_history_even_with_replacement_header(self):
        self.p["artifacts"]["context"].update(
            history_memory_values=["withdrawn", "withdrawn"], replacement_header=True)
        result = self.result()
        self.assertEqual(result["status"], "pass")
        self.assertEqual(result["history_exposure"]["strict_zero_status"], "fail")
        self.assertEqual(result["history_exposure"]["measured_exposed_values"], 1)
        self.assertFalse(result["history_exposure"]["policy_gate"])

    def test_history_watch_and_history_capture_are_both_required(self):
        for parent, key in (("artifacts", "history_watch_values"), ("context", "history_memory_values")):
            with self.subTest(key=key):
                p = copy.deepcopy(self.p)
                container = p["artifacts"] if parent == "artifacts" else p["artifacts"]["context"]
                del container[key]
                result = scorer.score([self.g], [p])
                self.assertEqual(result["history_exposure"]["unknown"], 1)
                self.assertIsNone(result["targets"][0]["history_exposure"]["exposed_count"])

    def test_fresh_empty_does_not_erase_history(self):
        self.p["artifacts"]["context"].update(fresh_values=[], emitted=False,
                                             history_memory_values=["withdrawn"])
        self.assertEqual(self.result()["history_exposure"]["strict_zero_status"], "fail")

    def test_empty_watch_list_is_observed_but_no_values_are_imputed(self):
        self.p["artifacts"]["history_watch_values"] = []
        result = self.result()["history_exposure"]
        self.assertEqual((result["strict_zero_status"], result["measured_watch_values"]), ("incomplete", 0))
        self.assertEqual(result["planned"], 1)

    def test_expected_watch_cannot_be_replaced_by_empty_partial_or_missing_projection(self):
        self.g["history_watch_values"] = ["withdrawn", "replaced"]
        for actual in ([], ["withdrawn"], None):
            with self.subTest(actual=actual):
                p = copy.deepcopy(self.p)
                if actual is None:
                    del p["artifacts"]["history_watch_values"]
                else:
                    p["artifacts"]["history_watch_values"] = actual
                result = scorer.score([self.g], [p])
                observed = result["targets"][0]["history_exposure"]
                self.assertEqual(observed["status"], "unknown")
                self.assertEqual(observed["reason"], "watch_projection_incomplete")
                self.assertIsNone(observed["watched_count"])
                self.assertIsNone(observed["exposed_count"])
                self.assertEqual(result["history_exposure"]["relevant_planned"], 1)
                self.assertEqual(result["history_exposure"]["measured_watch_values"], 0)

    def test_gold_watch_is_coverage_metadata_not_observed_history(self):
        self.g["history_watch_values"] = ["withdrawn"]
        self.assertEqual(self.result()["history_exposure"]["strict_zero_status"], "pass")
        self.p["artifacts"]["context"]["history_memory_values"] = ["withdrawn"]
        self.assertEqual(self.result()["history_exposure"]["strict_zero_status"], "fail")
        del self.p["artifacts"]["context"]["history_memory_values"]
        result = self.result()
        self.assertEqual(result["history_exposure"]["strict_zero_status"], "incomplete")
        self.assertIsNone(result["targets"][0]["history_exposure"]["exposed_values"])

    def test_not_applicable_is_not_counted_as_exposure_success(self):
        self.g["history_watch_values"] = []
        result = self.result()
        observed = result["targets"][0]["history_exposure"]
        self.assertEqual(observed["status"], "not_applicable")
        summary = result["history_exposure"]
        self.assertEqual((summary["planned"], summary["relevant_planned"], summary["not_applicable"]), (1, 0, 1))
        self.assertEqual(summary["passed"], 0)
        self.assertEqual(summary["strict_zero_status"], "incomplete")
        self.assertIsNone(summary["pass_rate_relevant"])

    def test_relevant_and_full_denominators_do_not_drop_not_applicable_targets(self):
        self.g["history_watch_values"] = ["withdrawn"]
        second = copy.deepcopy(self.g)
        second.update(id="not-relevant", history_watch_values=[])
        result = scorer.score([self.g, second], [self.p])
        summary = result["history_exposure"]
        self.assertEqual((summary["planned"], summary["relevant_planned"], summary["not_applicable"]), (2, 1, 1))
        self.assertEqual(summary["strict_zero_status"], "pass")
        self.assertEqual(result["coverage"]["unknown"], 1)
        self.assertEqual(result["context_coverage"]["unknown"], 1)
        self.assertEqual(result["status"], "incomplete")

    def test_invalid_gold_watch_metadata_is_rejected_by_public_wrapper(self):
        for value in ("withdrawn", None, [1], [True], ["withdrawn", "withdrawn"]):
            with self.subTest(value=value):
                g = copy.deepcopy(self.g)
                g["history_watch_values"] = value
                with self.assertRaises(scorer.InputError):
                    scorer.index_gold([g])
                with self.assertRaises(scorer.InputError):
                    scorer.score([g], [self.p])

    def test_public_prediction_wrapper_checks_extension_types(self):
        indexed_gold = scorer.index_gold([self.g])
        indexed, run_id = scorer.index_predictions([self.p], indexed_gold)
        self.assertEqual(indexed[self.p["id"]], self.p)
        self.assertEqual(run_id, self.p["run_id"])
        self.p["artifacts"]["context"]["capture_complete"] = 1
        with self.assertRaises(scorer.InputError):
            scorer.index_predictions([self.p], indexed_gold)

    def test_all_84_missing_targets_preserve_context_and_exposure_denominators(self):
        gs = []
        for i in range(84):
            g = copy.deepcopy(self.g)
            g["id"] = f"target-{i}"
            gs.append(g)
        result = scorer.score(gs, [])
        for key in ("coverage", "semantic", "context_coverage", "history_exposure"):
            self.assertEqual((result[key]["planned"], result[key]["unknown"]), (84, 84))
        self.assertEqual(result["token_measurements"]["unknown"], 84)

    def test_exposure_zero_denominator_is_incomplete_and_rates_null(self):
        result = scorer.score([], [])["history_exposure"]
        self.assertEqual(result["strict_zero_status"], "incomplete")
        self.assertIsNone(result["pass_rate_planned"])

    def test_actual_token_boundary_and_estimate_are_distinct(self):
        self.extra_check("/artifacts/context/fresh_tokens", 600, "lte")
        self.assertEqual(self.result()["status"], "pass")
        self.p["artifacts"]["context"]["fresh_tokens"] = 601
        self.assertEqual(self.result()["metrics"]["extra"]["failed"], 1)
        for method in ("estimate", "tokensEst", "estimate:chars", "unrecognized", ""):
            with self.subTest(method=method):
                self.p["artifacts"]["context"].update(token_method=method, fresh_tokens=1)
                result = self.result()
                self.assertEqual(result["metrics"]["extra"]["unknown"], 1)
                self.assertEqual(result["targets"][0]["token_measurement"]["fresh_tokens"], 1)

    def test_missing_token_method_cannot_pass_exact_budget(self):
        self.extra_check("/artifacts/context/fresh_tokens", 600, "lte")
        del self.p["artifacts"]["context"]["token_method"]
        self.assertEqual(self.result()["metrics"]["extra"]["unknown"], 1)

    def test_context_types_are_validated_even_if_capture_false(self):
        bad_values = {"capture_complete": 1, "emitted": 0, "replacement_header": "true",
                      "fresh_tokens": True, "fresh_values": "approved",
                      "history_memory_values": [True], "all_input_values": [1],
                      "effective_active_values": {}, "withdrawn_slots": [None],
                      "rendered_item_ids": [""], "token_method": 600,
                      "capture_ref": 1, "capture_sha256": "bad"}
        for key, value in bad_values.items():
            with self.subTest(key=key):
                p = copy.deepcopy(self.p)
                p["artifacts"]["context"].update(capture_complete=False)
                p["artifacts"]["context"][key] = value
                with self.assertRaises(scorer.InputError):
                    scorer.score([self.g], [p])

    def test_negative_float_and_boolean_token_counts_are_rejected(self):
        for value in (-1, 1.0, True):
            with self.subTest(value=value):
                self.p["artifacts"]["context"]["fresh_tokens"] = value
                with self.assertRaises(scorer.InputError):
                    self.result()

    def test_new_state_flags_and_watch_types_are_strict(self):
        for key, value in (("c_completed", 1), ("source_bound", "true"),
                           ("old_process_closed", 0), ("dropped_reasons", [1]),
                           ("history_watch_values", "withdrawn")):
            with self.subTest(key=key):
                p = copy.deepcopy(self.p)
                p["artifacts"][key] = value
                with self.assertRaises(scorer.InputError):
                    scorer.score([self.g], [p])

    def test_auto_episode_projection_and_prior_count_types(self):
        self.p["artifacts"].update(auto_episode_values=["synthetic episode"], relation_prior_count=0)
        self.assertEqual(self.result()["status"], "pass")
        for key, value in (("auto_episode_values", [1]), ("relation_prior_count", True),
                           ("relation_prior_count", -1), ("relation_prior_count", 1.0)):
            with self.subTest(key=key, value=value):
                p = copy.deepcopy(self.p)
                p["artifacts"][key] = value
                with self.assertRaises(scorer.InputError):
                    scorer.score([self.g], [p])

    def test_missing_causal_or_job_result_is_not_success(self):
        self.extra_check("/artifacts/source_bound", True)
        self.assertEqual(self.result()["metrics"]["extra"]["unknown"], 1)
        self.p["artifacts"]["source_bound"] = True
        del self.p["evidence"]
        self.assertEqual(self.result()["metrics"]["extra"]["unknown"], 1)

    def test_normalization_does_not_mutate_inputs_or_change_raw_hashes(self):
        self.p["artifacts"]["context"]["token_method"] = "estimate"
        original = copy.deepcopy(self.p)
        hashes = {"predictions_sha256": "d" * 64}
        result = scorer.score([self.g], [self.p], hashes)
        self.assertEqual(self.p, original)
        self.assertEqual(result["input_hashes"], hashes)

    def test_contract_and_challenge_exposure_remain_separate_and_in_total(self):
        self.g["interpretation"] = "contract"
        second_g, second_p = copy.deepcopy(self.g), copy.deepcopy(self.p)
        second_g.update(id="challenge", interpretation="challenge")
        second_p["id"] = "challenge"
        second_p["artifacts"]["context"]["all_input_values"].append("other_principal")
        second_p["artifacts"]["context"]["history_memory_values"] = ["withdrawn"]
        result = scorer.score([self.g, second_g], [self.p, second_p])
        self.assertEqual(result["status"], "fail")
        self.assertEqual(result["coverage"]["planned"], 2)
        self.assertEqual(result["by_interpretation"]["contract"]["passed"], 1)
        self.assertEqual(result["by_interpretation"]["challenge"]["failed"], 1)
        self.assertEqual(result["history_exposure"]["by_interpretation"]["challenge"]["failed"], 1)


if __name__ == "__main__":
    unittest.main()
