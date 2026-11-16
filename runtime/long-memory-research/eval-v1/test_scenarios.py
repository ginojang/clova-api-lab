"""Offline checks for fixture design, source wiring and exclusive generation."""
from __future__ import annotations

import copy
from datetime import datetime
import json
from pathlib import Path
import tempfile
import unittest

import build_dataset as dataset


def rows(payload):
    return [json.loads(line) for line in payload.splitlines()]


def strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from strings(item)


def criterion(row, path, operator, value):
    return any(check["path"] == "/artifacts/" + path and check["operator"] == operator
               and type(check["value"]) is type(value) and check["value"] == value
               for check in row["checks"])


class DatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payloads = dataset.build()
        cls.stories = rows(cls.payloads["scenarios.jsonl"])
        cls.gold = rows(cls.payloads["gold.jsonl"])
        cls.by_id = {row["id"]: row for row in cls.gold}
        cls.mapping = json.loads(cls.payloads["private/blind_map.json"])

    def family(self, number):
        return [story for story in self.stories if story["id"].startswith(f"n{number:02d}-")]

    def gold_for(self, story, checkpoint):
        return self.by_id[story["checkpoints"][checkpoint - 1]["probe"]["id"]]

    def test_deterministic_and_frozen_counts(self):
        self.assertEqual(self.payloads, dataset.build())
        self.assertEqual((len(self.stories), len(self.gold)), (28, 84))
        self.assertEqual({s["family"] for s in self.stories}, set(dataset.FAMILIES))
        self.assertEqual({s["domain"] for s in self.stories}, set(dataset.DOMAINS))
        self.assertTrue(all(len(s["checkpoints"]) == 3 for s in self.stories))

    def test_every_target_has_meaningful_capture_and_state_checks(self):
        for row in self.gold:
            self.assertGreaterEqual(len(row["checks"]), 2)
            self.assertTrue(criterion(row, "context/capture_complete", "eq", True))
            self.assertTrue(row["answer_rubric"])
            self.assertEqual(row["positive"], any(c["metric"] == "recall" for c in row["checks"]))
            self.assertTrue(all(c["path"].startswith("/artifacts/") for c in row["checks"]))
            self.assertTrue(all(c["operator"] in {"eq", "contains", "excludes", "set_eq", "lte"} for c in row["checks"]))

    def test_all_identifiers_unique_with_bijective_maps(self):
        self.assertEqual(set(self.mapping), set(dataset.TABLES))
        all_originals, all_blind = [], []
        for table in self.mapping.values():
            self.assertEqual(len(table), len(set(table.values())))
            all_originals += list(table)
            all_blind += list(table.values())
        self.assertEqual(len(all_originals), len(set(all_originals)))
        self.assertEqual(len(all_blind), len(set(all_blind)))
        self.assertEqual(len(self.mapping["targets"]), 84)

    def test_blind_roundtrip_exact_after_removing_only_conditions(self):
        forward = {key: value for table in self.mapping.values() for key, value in table.items()}
        backward = {value: key for key, value in forward.items()}
        blind = rows(self.payloads["blind/scenarios.jsonl"])
        self.assertFalse(set(strings(blind)) & set(forward))
        for original, masked in zip(self.stories, blind):
            cleaned = {key: value for key, value in original.items() if key not in {"family", "domain"}}
            self.assertEqual(dataset.replace_strings(masked, backward), cleaned)
            self.assertNotIn("family", masked)
            self.assertNotIn("domain", masked)

    def test_no_gold_or_condition_fields_inside_model_inputs(self):
        prohibited = {"checks", "answer_rubric", "expected", "gold", "positive", "judgment", "history_watch_values"}
        def inspect(value):
            if isinstance(value, dict):
                self.assertFalse(prohibited.intersection(value))
                for item in value.values(): inspect(item)
            elif isinstance(value, list):
                for item in value: inspect(item)
        inspect(self.stories)
        inspect(rows(self.payloads["blind/scenarios.jsonl"]))

    def test_blank_annotation_coverage(self):
        labels = rows(self.payloads["blind/annotation_template.jsonl"])
        self.assertEqual({row["id"] for row in labels}, set(self.mapping["targets"].values()))
        self.assertEqual(len(labels), 84)
        for row in labels:
            self.assertTrue(all(value == "" for key, value in row.items() if key != "id"))

    def test_event_sources_and_jobs_are_already_available(self):
        plan = json.loads((dataset.ROOT / "plan.json").read_text())
        for story in self.stories:
            turns, jobs, cids = {}, set(), set()
            for checkpoint in story["checkpoints"]:
                cids.add(checkpoint["conversation_id"])
                self.assertTrue(checkpoint["events"])
                for event in checkpoint["events"]:
                    cids.add(event["conversation_id"])
                    self.assertIn(event["conversation_id"], self.mapping["conversations"])
                    if event["kind"] == "turn":
                        turns[event["id"]] = event
                        continue
                    params = event["params"]
                    self.assertIn(event["action"], plan["controls"])
                    for key in ("source_event_id", "through_event_id"):
                        if key in params: self.assertIn(params[key], turns)
                    for source in params.get("source_event_ids", []): self.assertIn(source, turns)
                    for key in ("conversation_id", "closed_conversation_id"):
                        if key in params: self.assertIn(params[key], cids)
                    if event["action"] == "queue_c":
                        self.assertNotIn(params["job_id"], jobs)
                        self.assertTrue(params["source_event_ids"])
                        jobs.add(params["job_id"])
                    if event["action"] == "release_c": self.assertIn(params["job_id"], jobs)

    def test_timezone_and_clock_never_go_backwards(self):
        for story in self.stories:
            previous = None
            for checkpoint in story["checkpoints"]:
                instant = datetime.fromisoformat(checkpoint["at"])
                self.assertIsNotNone(instant.tzinfo)
                if previous: self.assertGreaterEqual(instant, previous)
                previous = instant
                for event in checkpoint["events"]:
                    if event.get("action") == "advance_time":
                        target = datetime.fromisoformat(event["params"]["to"])
                        self.assertGreaterEqual(target, previous)
                        previous = target

    def test_actual_same_conversation_cases_and_new_conversation_for_forget(self):
        for number in (2, 3, 7, 8, 14):
            for story in self.family(number):
                self.assertEqual(story["checkpoints"][0]["conversation_id"], story["checkpoints"][1]["conversation_id"])
        for story in self.family(4):
            old, fresh = story["checkpoints"][:2]
            self.assertNotEqual(old["conversation_id"], fresh["conversation_id"])
            self.assertTrue(criterion(self.gold_for(story, 2), "old_process_closed", "eq", True))
            self.assertTrue(criterion(self.gold_for(story, 2), "resume_allowed", "eq", False))
            self.assertFalse(any(e.get("action") == "trim_context" for k in story["checkpoints"] for e in k["events"]))

    def test_corrected_raw_history_is_diagnostic_not_blanket_failure(self):
        for number in (2, 3, 14):
            for story in self.family(number):
                row = self.gold_for(story, 2)
                self.assertTrue(row["history_watch_values"])
                for value in row["history_watch_values"]:
                    self.assertFalse(criterion(row, "context/all_input_values", "excludes", value))
                    self.assertTrue(criterion(row, "context/effective_active_values", "excludes", value))

    def test_forget_checks_full_input_not_only_fresh_block(self):
        for number in (4, 5):
            for story in self.family(number):
                for checkpoint in (2, 3):
                    row = self.gold_for(story, checkpoint)
                    self.assertTrue(row["history_watch_values"])
                    for value in row["history_watch_values"]:
                        self.assertTrue(criterion(row, "context/all_input_values", "excludes", value))

    def test_stale_jobs_keep_epoch_and_have_pre_barrier_sources(self):
        for number in (5, 6):
            for story in self.family(number):
                first, second, third = story["checkpoints"]
                queue = next(e for e in first["events"] if e.get("action") == "queue_c")
                self.assertEqual(queue["params"]["capture_epoch"], "job_start")
                allowed = {"after_source_read_before_epoch", "during_model_before_commit"} if number == 5 else {"before_commit"}
                self.assertIn(queue["params"]["barrier"], allowed)
                for checkpoint in (second, third):
                    release = next(e for e in checkpoint["events"] if e.get("action") == "release_c")
                    self.assertEqual(release["params"]["job_id"], queue["params"]["job_id"])
                    self.assertIs(release["params"]["preserve_captured_epoch"], True)
                    self.assertTrue(criterion(self.by_id[checkpoint["probe"]["id"]], "late_commit_accepted", "eq", False))

    def test_session_value_never_requires_structured_current(self):
        for story in self.family(7):
            row = self.gold_for(story, 2)
            temporary = next(c["value"] for c in row["checks"] if c["path"] == "/artifacts/context/all_input_values")
            self.assertTrue(criterion(row, "principal_values", "excludes", temporary))
            self.assertFalse(criterion(row, "current_values", "contains", temporary))
            self.assertTrue(criterion(self.gold_for(story, 3), "context/all_input_values", "excludes", temporary))

    def test_promise_s6_is_bound_to_source_not_unrelated_pass(self):
        for story in self.family(8):
            first, second, third = story["checkpoints"]
            promise = next(e for e in first["events"] if e.get("speaker") == "assistant")
            self.assertNotIn("s6", promise)
            attachment = next(e for e in second["events"] if e.get("action") == "attach_s6")
            self.assertEqual(attachment["params"]["source_event_id"], promise["id"])
            self.assertEqual(attachment["params"]["s6"], {"verdict": "block", "source": "synthetic_fixture"})
            unrelated = next(e for e in second["events"] if e.get("speaker") == "assistant")
            self.assertEqual(unrelated["s6"]["verdict"], "pass")
            self.assertNotEqual(unrelated["text"], promise["text"])
            accepted = next(e for e in third["events"] if e.get("speaker") == "assistant")
            self.assertEqual(accepted["text"], promise["text"])
            self.assertNotEqual(accepted["id"], promise["id"])
            self.assertEqual(accepted["s6"]["verdict"], "pass")

    def test_scope_boundaries_change_one_key_at_a_time(self):
        for story in self.family(13):
            self.assertTrue(story["scope"]["principal_id"].startswith("pr-test-"))
            for checkpoint, changed in zip(story["checkpoints"], ("principal_id", "product", "persona_id")):
                probe_scope = checkpoint["probe"]["scope"]
                self.assertEqual([key for key in story["scope"] if story["scope"][key] != probe_scope[key]], [changed])
            owner_events = [e for e in story["checkpoints"][0]["events"] if e["scope"] == story["scope"]]
            self.assertTrue(owner_events)
            self.assertNotEqual(owner_events[0]["conversation_id"], story["checkpoints"][0]["conversation_id"])

    def test_current_conversation_episode_storage_does_not_force_reinjection(self):
        for story in self.family(9):
            for checkpoint in (1, 2):
                row = self.gold_for(story, checkpoint)
                self.assertFalse(row["positive"])
                self.assertTrue(any(c["path"] == "/artifacts/episode_values" and c["operator"] == "contains" for c in row["checks"]))
                self.assertFalse(any(c["path"] == "/artifacts/context/effective_active_values" and c["operator"] == "contains" for c in row["checks"]))
            self.assertTrue(self.gold_for(story, 3)["positive"])

    def test_returning_first_turn_is_the_probe_itself(self):
        for story in self.family(10):
            checkpoint = story["checkpoints"][1]
            self.assertTrue(all(event["kind"] == "control" for event in checkpoint["events"]))
            self.assertTrue(criterion(self.gold_for(story, 2), "relation_prior_count", "eq", 1))

    def test_origin_uses_runtime_actor_kind_with_separate_fixture_marker(self):
        for story in self.stories:
            for checkpoint in story["checkpoints"]:
                for event in checkpoint["events"]:
                    if event["kind"] == "turn":
                        self.assertEqual(event["origin"]["kind"], event["speaker"])
                        self.assertIs(event["origin"]["synthetic_fixture"], True)

    def test_restart_challenge_is_only_recovery_checkpoint(self):
        challenge = [row for row in self.gold if row["interpretation"] == "challenge"]
        self.assertEqual(len(challenge), 2)
        self.assertTrue(all(row["family"] == "restart_c_missing" and row["id"].endswith("-q2") for row in challenge))
        self.assertTrue(all(criterion(row, "c_completed", "eq", True) for row in challenge))
        for story in self.family(12):
            first, second, _ = story["checkpoints"]
            elapsed = (datetime.fromisoformat(second["at"]) - datetime.fromisoformat(first["at"])).total_seconds()
            self.assertLess(elapsed, 20 * 60)
            actions = [event.get("action") for event in second["events"]]
            self.assertLess(actions.index("restart_worker"), actions.index("advance_time"))
            advanced = next(event["params"]["to"] for event in second["events"] if event.get("action") == "advance_time")
            self.assertGreater((datetime.fromisoformat(advanced) - datetime.fromisoformat(first["at"])).total_seconds(), 20 * 60)

    def test_t_only_return_happens_before_c_timer_deadline(self):
        for story in self.family(1):
            elapsed = (datetime.fromisoformat(story["checkpoints"][-1]["at"]) - datetime.fromisoformat(story["checkpoints"][0]["at"])).total_seconds()
            self.assertLess(elapsed, 20 * 60)
            self.assertFalse(any(event.get("action") == "finish_c" for checkpoint in story["checkpoints"] for event in checkpoint["events"]))

    def test_budget_does_not_force_retrieval_or_target_eviction(self):
        for story in self.family(11):
            for checkpoint in story["checkpoints"]:
                row = self.by_id[checkpoint["probe"]["id"]]
                self.assertTrue(criterion(row, "load_projection_matches", "eq", True))
                self.assertTrue(criterion(row, "context/fresh_tokens", "lte", 600))
                self.assertFalse(any(c["path"] == "/artifacts/retrieved_values" for c in row["checks"]))

    def test_exclusive_output_preflight_preserves_existing_files(self):
        with tempfile.TemporaryDirectory(prefix=".test-dataset-", dir=dataset.ROOT) as directory:
            output = Path(directory)
            dataset.write_new(output, self.payloads)
            before = {name: (output / name).read_bytes() for name in self.payloads}
            with self.assertRaises(FileExistsError): dataset.write_new(output, self.payloads)
            self.assertEqual(before, {name: (output / name).read_bytes() for name in self.payloads})
        with tempfile.TemporaryDirectory(prefix=".test-dataset-", dir=dataset.ROOT) as directory:
            output = Path(directory)
            (output / "gold.jsonl").write_text("sentinel", encoding="utf-8")
            with self.assertRaises(FileExistsError): dataset.write_new(output, self.payloads)
            self.assertEqual(sorted(p.name for p in output.iterdir()), ["gold.jsonl"])


if __name__ == "__main__":
    unittest.main()
