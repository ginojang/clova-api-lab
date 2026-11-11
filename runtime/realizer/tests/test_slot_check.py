#!/usr/bin/env python3
"""Adversarial contract tests using authored Korean examples, without a model."""
import argparse
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unicodedata
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("slot_check", ROOT / "slot-check.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SlotCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixtures = module.load_fixtures()
        cls.checker = module.Checker(cls.fixtures)

    def check(self, skeleton, text, passes):
        result = self.checker.check_text(skeleton, text)
        self.assertEqual(result["lexicalPass"], passes, result)
        self.assertTrue(result["semanticReviewRequired"])
        self.assertEqual(result["semanticVerdict"], "unreviewed")
        return result

    def test_exact_twenty_by_three_by_two_plan(self):
        self.assertEqual(len(self.fixtures["skeletons"]), 20)
        self.assertEqual(set(self.fixtures["styles"]), {"friendly", "blunt", "historical"})
        self.assertEqual(len(self.fixtures["plan"]), 120)
        self.assertEqual(self.fixtures["plan"][0]["id"], "R01-friendly-v1")
        self.assertEqual(self.fixtures["plan"][-1]["id"], "R20-historical-v2")

    def test_all_authored_references_are_lexically_valid_but_not_model_evidence(self):
        report = self.checker.evaluate(self.checker.references())
        self.assertTrue(report["summary"]["completeLexicalPass"], [r for r in report["results"] if not r["lexicalPass"]])
        self.assertEqual(report["summary"]["lexicalPass"], 120)
        self.assertEqual(report["summary"]["rawModelLexicalPass"], 0)
        self.assertEqual(report["summary"]["semanticAccepted"], 0)

    def test_name_prefix_collision_min_minsu(self):
        result = self.check("R01", "민수는 어제 도서관에서 책 3권을 빌렸어요.", False)
        self.assertIn("actor", result["missingSlots"])
        self.assertIn({"type": "person", "value": "민수"}, result["unexpectedProtected"])

    def test_name_prefix_collision_jun_seojun(self):
        self.check("R04", "서준은 오후 3시에 사무실에서 보고서 1부를 제출해 주세요.", False)

    def test_one_syllable_name_does_not_match_ordinary_attached_particle(self):
        result = self.check("R12", "민은 오전 10시에 사무실에서 지아의 노트 3권을 돌려줬어요.", False)
        self.assertIn("actor", result["missingSlots"])

    def test_one_syllable_name_does_not_match_separated_particle(self):
        result = self.check("R12", "민 은 오전 10시에 사무실에서 지아의 노트 3권을 돌려줬어요.", False)
        self.assertIn("actor", result["missingSlots"])

    def test_separated_particles_do_not_invent_actor_eun(self):
        self.check("R01", "민 은 어제 도서관 에서 책 3 권 을 빌렸어요.", True)

    def test_nfc_normalizes_decomposed_hangul(self):
        self.check("R01", unicodedata.normalize("NFD", "민은 어제 도서관에서 책 3권을 빌렸어요."), True)

    def test_native_count_and_postpositions(self):
        self.check("R01", "어제 도서관에서는 민이 책 세 권을 빌렸어요.", True)

    def test_number_substring_3_in_13_is_not_allowed(self):
        result = self.check("R01", "민은 어제 도서관에서 책 13권을 빌렸어요.", False)
        self.assertIn("count", result["missingSlots"])
        self.assertTrue(result["unexpectedNumeric"])

    def test_number_30_is_not_3(self):
        self.check("R01", "민은 어제 도서관에서 책 30권을 빌렸어요.", False)

    def test_leading_zero_is_not_implicitly_equivalent(self):
        self.check("R01", "민은 어제 도서관에서 책 03권을 빌렸어요.", False)

    def test_decimal_3_point_0_is_not_implicitly_equivalent(self):
        self.check("R01", "민은 어제 도서관에서 책 3.0권을 빌렸어요.", False)

    def test_negative_quantity_not_allowed(self):
        self.check("R01", "민은 어제 도서관에서 책 -3권을 빌렸어요.", False)

    def test_changed_unit_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3장을 빌렸어요.", False)

    def test_unlisted_equivalent_is_deliberately_rejected(self):
        self.check("R07", "철수는 오전 9시에 연구실에서 물 0.5L를 마셨어요.", False)

    def test_allowed_metric_spelling(self):
        self.check("R07", "철수는 09:00에 연구실에서 물 오백 밀리리터를 마셨어요.", True)

    def test_decimal_and_unit_spacing(self):
        self.check("R11", "민은 오늘 부엌에서 쌀 1.5 kg을 재 주세요.", True)

    def test_explicit_money_separator(self):
        self.check("R13", "소율은 어제 지갑에 현금 3,000원을 보관했어요.", True)

    def test_malformed_money_separator_rejected(self):
        self.check("R13", "소율은 어제 지갑에 현금 30,00원을 보관했어요.", False)

    def test_time_clock_alias(self):
        self.check("R04", "준은 15:00에 사무실에서 보고서 한 부를 제출해 주세요.", True)

    def test_wrong_time_meridiem_rejected(self):
        self.check("R04", "준은 오전 3시에 사무실에서 보고서 1부를 제출해 주세요.", False)

    def test_extra_clock_minutes_rejected(self):
        self.check("R04", "준은 오후 3시 30분에 사무실에서 보고서 1부를 제출해 주세요.", False)

    def test_missing_object_rejected(self):
        result = self.check("R01", "민은 어제 도서관에서 3권을 빌렸어요.", False)
        self.assertIn("object", result["missingSlots"])

    def test_extra_known_actor_is_rejected(self):
        self.check("R01", "민은 어제 민수와 도서관에서 책 3권을 빌렸어요.", False)

    def test_extra_known_location_is_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸어요. 사무실에도 갔어요.", False)

    def test_extra_known_time_is_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸어요. 오늘도 그랬어요.", False)

    def test_extra_unseen_arabic_number_is_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸어요. 추가로 77개도 샀어요.", False)

    def test_extra_native_number_is_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸어요. 스물한 권도 샀어요.", False)

    def test_extra_sino_number_is_rejected(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸어요. 삼십 권도 샀어요.", False)

    def test_known_location_gongwon_is_not_zero_won(self):
        self.check("R18", "유진은 내일 공원에서 약속 한 건을 확인할 예정이에요.", True)

    def test_ownership_name_must_be_present(self):
        result = self.check("R06", "영희는 지금 현관에서 우산 1개를 들고 있어요.", False)
        self.assertIn("owner", result["missingSlots"])

    def test_obvious_negative_to_positive_flip_flagged(self):
        result = self.check("R02", "민수는 오늘 서재에서 편지 13통을 보냈어요.", False)
        self.assertTrue(result["polarityHintIssues"])

    def test_obvious_positive_to_negative_flip_flagged(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌리지 않았어요.", False)

    def test_negative_lookalike_annae_does_not_satisfy_negation(self):
        self.check("R02", "민수는 오늘 서재에서 안내에 따라 편지 13통을 보냈어요.", False)

    def test_subject_ian_does_not_trigger_short_negative_an(self):
        self.check("R09", "이안은 어제 회의실에서 문서 7장을 검토했어요.", True)

    def test_empty_and_nonstring_text_never_pass(self):
        for value in (None, "", " \n\t", [], {}, 3, False):
            with self.subTest(value=value):
                self.check("R01", value, False)

    def test_missing_model_outputs_never_count_as_success(self):
        report = self.checker.evaluate([])
        self.assertEqual(report["summary"]["present"], 0)
        self.assertEqual(report["summary"]["lexicalPass"], 0)
        self.assertEqual(report["summary"]["rawModelLexicalPass"], 0)
        self.assertFalse(report["summary"]["completeLexicalPass"])

    def test_invalid_container_never_silently_passes(self):
        for payload in ({}, {"outputs": "not a list"}, None, "", [None]):
            with self.subTest(payload=payload):
                report = self.checker.evaluate(payload)
                self.assertTrue(report["inputErrors"])
                self.assertFalse(report["summary"]["completeLexicalPass"])

    def test_duplicate_id_invalidates_duplicated_row(self):
        data = self.checker.references()
        data.append(copy.deepcopy(data[0]))
        report = self.checker.evaluate(data)
        self.assertTrue(report["inputErrors"])
        self.assertFalse(report["results"][0]["lexicalPass"])
        self.assertEqual(report["summary"]["lexicalPass"], 119)

    def test_metadata_bound_to_id(self):
        for field, wrong in (("skeletonId", "R02"), ("style", "blunt"), ("variant", 2), ("variant", True)):
            data = self.checker.references()
            data[0][field] = wrong
            with self.subTest(field=field, wrong=wrong):
                report = self.checker.evaluate(data)
                self.assertFalse(report["results"][0]["lexicalPass"])
                self.assertFalse(report["summary"]["completeLexicalPass"])

    def test_hostile_id_cannot_rebind_or_add_cases(self):
        for hostile in ("R01-friendly-v1-extra", "../../R01", "R01-friendly-v01", ["R01-friendly-v1"], ""):
            data = self.checker.references()
            data[0]["id"] = hostile
            with self.subTest(hostile=hostile):
                report = self.checker.evaluate(data)
                self.assertFalse(report["results"][0]["present"])
                self.assertFalse(report["summary"]["completeLexicalPass"])

    def test_fallback_is_deterministic_and_cannot_inflate_model_success(self):
        repaired = self.checker.fallback([])
        self.assertEqual(repaired, self.checker.fallback([]))
        self.assertEqual(repaired["rawSummary"]["rawModelLexicalPass"], 0)
        self.assertEqual(repaired["finalSummary"]["rawModelLexicalPass"], 0)
        self.assertEqual(repaired["finalSummary"]["fallbackCount"], 120)
        self.assertEqual(repaired["finalSummary"]["fallbackLexicalPass"], 120)
        self.assertEqual(repaired["finalSummary"]["semanticAccepted"], 0)

    def test_fallback_preserves_model_count_separately(self):
        data = self.checker.references()
        for row in data:
            row.pop("provenance")
        data[0]["text"] = ""
        repaired = self.checker.fallback(data)
        self.assertEqual(repaired["rawSummary"]["rawModelLexicalPass"], 119)
        self.assertEqual(repaired["finalSummary"]["rawModelLexicalPass"], 119)
        self.assertEqual(repaired["finalSummary"]["fallbackCount"], 1)

    def test_changed_roles_require_semantic_review_even_with_all_slots(self):
        # Both names survive but ownership and actor have been reversed.
        self.check("R06", "민은 지금 현관에서 영희의 우산 1개를 들고 있어요.", True)

    def test_wrong_tense_requires_review_even_when_slots_survive(self):
        self.check("R03", "지아는 내일 교실로 연필 2자루를 가져왔어요.", True)

    def test_request_to_completed_requires_review(self):
        self.check("R04", "준은 오후 3시에 사무실에서 보고서 1부를 제출했어요.", True)

    def test_evidential_addition_requires_review(self):
        self.check("R01", "민은 어제 도서관에서 책 3권을 빌렸다고 들었어요.", True)

    def test_unseen_name_is_explicitly_outside_controlled_vocab(self):
        self.check("R01", "민은 어제 가람과 도서관에서 책 3권을 빌렸어요.", True)

    def test_wrong_negation_scope_requires_review(self):
        self.check("R02", "민수는 오늘 서재에서 편지 13통을 보냈어요. 기쁘지 않았어요.", True)

    def test_cli_absent_file_and_empty_response_fail_closed(self):
        with tempfile.TemporaryDirectory(dir=ROOT / "tests") as temp:
            folder = Path(temp)
            missing = subprocess.run([sys.executable, str(ROOT / "slot-check.py"), "check", str(folder / "missing.json")], capture_output=True, text=True)
            self.assertEqual(missing.returncode, 2)
            (folder / "empty.json").write_text("[]\n", encoding="utf-8")
            empty = subprocess.run([sys.executable, str(ROOT / "slot-check.py"), "check", str(folder / "empty.json")], capture_output=True, text=True)
            self.assertEqual(empty.returncode, 1)
            self.assertEqual(json.loads(empty.stdout)["summary"]["rawModelLexicalPass"], 0)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(SlotCheckTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if args.result:
        data = {"createdAt": datetime.now(timezone.utc).isoformat(), "scope": "offline stdlib tests; no model calls",
                "testsRun": result.testsRun, "failures": len(result.failures), "errors": len(result.errors),
                "successful": result.wasSuccessful(),
                "failureDetails": [{"test": str(case), "traceback": tb} for case, tb in result.failures + result.errors],
                "referenceSummary": SlotCheckTests.checker.evaluate(SlotCheckTests.checker.references())["summary"],
                "emptyModelSummary": SlotCheckTests.checker.evaluate([])["summary"],
                "emptyModelFallbackSummary": SlotCheckTests.checker.fallback([])["finalSummary"]}
        args.result.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(0 if result.wasSuccessful() else 1)
