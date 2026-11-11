#!/usr/bin/env python3
"""Bounded Korean protected-slot checks; lexical success is never semantic proof."""
import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_FIXTURES = ROOT / "fixtures.json"
# Finite suffix inventory, not a Korean morphological analyzer. Longest first.
POSTPOSITIONS = sorted({
    "으로부터", "에게서도", "에게서는", "에게서", "한테서", "으로서는", "으로는", "으로도",
    "에서는", "에서도", "에서만", "에게는", "에게도", "에게만", "한테는", "한테도",
    "까지는", "부터는", "하고는", "이라도", "이랑", "처럼", "보다", "부터", "까지",
    "으로", "에서", "에게", "한테", "께서", "에는", "에도", "에만", "로는", "로도",
    "과는", "와는", "과도", "와도", "만은", "만이", "만을", "하고", "라도",
    "은", "는", "이", "가", "을", "를", "의", "에", "로", "과", "와", "도", "만", "랑",
}, key=lambda item: (-len(item), item))
SUFFIX = "(?:" + "|".join(map(re.escape, POSTPOSITIONS)) + ")"
ARABIC_NUMBER = re.compile(r"[+−-]?\d+(?:,\d+)*(?:\.\d+)?(?::\d+)?")
NEGATION = re.compile(r"지\s*(?:않|못|말)|(?<!\w)(?:안|못)\s|아니(?:다|었|오|에요)|없(?:다|었|어요|소)")
NATIVE_NUMBER = r"(?:(?:스물|서른|마흔|쉰|예순|일흔|여든|아흔)?(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)|열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|스무|스물|서른|마흔|쉰|예순|일흔|여든|아흔)"
SINO_NUMBER = r"[영공일이삼사오육칠팔구십백천만억]+(?:\s*점\s*[영공일이삼사오육칠팔구]+)?"


def normalize(text):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def surface_pattern(surface, kind):
    surface = normalize(surface)
    # Slots may vary whitespace at explicit word gaps; counts additionally at
    # number/unit boundaries. Never delete all whitespace from an entire text.
    escaped = r"\s*".join(re.escape(part) for part in surface.split(" "))
    if kind in {"count", "time"}:
        escaped = re.sub(r"(?<=\d)(?=[A-Za-z가-힣])", r"\\s*", escaped)
        escaped = re.sub(r"(?<=[가-힣])(?=\d)", r"\\s*", escaped)
    return re.compile(r"(?<!\w)(?P<core>" + escaped + r")(?:\s*" + SUFFIX + r")?(?!\w)")


def identity(slot):
    return slot["type"], json.dumps(slot["value"], ensure_ascii=False), slot.get("unit")


def load_fixtures(path=DEFAULT_FIXTURES):
    with Path(path).open(encoding="utf-8") as handle:
        data = json.load(handle)
    if data.get("schemaVersion") != "1.0":
        raise ValueError("Unsupported fixture schemaVersion")
    if len(data.get("skeletons", [])) != 20 or len(data.get("plan", [])) != 120:
        raise ValueError("The fixed trial requires 20 skeletons and 120 planned outputs")
    skeleton_ids = {row["id"] for row in data["skeletons"]}
    expected = {(s, style, v) for s in skeleton_ids for style in data["styles"] for v in (1, 2)}
    actual = {(p["skeletonId"], p["style"], p["variant"]) for p in data["plan"]}
    if actual != expected or len({p["id"] for p in data["plan"]}) != 120:
        raise ValueError("Plan must contain each skeleton/style/variant exactly once")
    for row in data["plan"]:
        if row["id"] != f"{row['skeletonId']}-{row['style']}-v{row['variant']}":
            raise ValueError("Plan id is not bound to its declared metadata")
    return data


class Checker:
    def __init__(self, fixtures):
        self.fixtures = fixtures
        self.skeletons = {s["id"]: s for s in fixtures["skeletons"]}
        self.plan = {p["id"]: p for p in fixtures["plan"]}
        self.lexicon = {}
        for skeleton in fixtures["skeletons"]:
            for slot in skeleton["protectedSlots"]:
                key = identity(slot)
                entry = self.lexicon.setdefault(key, {"slot": slot, "patterns": {}})
                for surface in slot["surfaces"]:
                    entry["patterns"][surface] = surface_pattern(surface, slot["type"])
        units = {s.get("unit") for c in fixtures["skeletons"] for s in c["protectedSlots"] if s["type"] == "count"}
        units.update({"킬로그램", "밀리리터", "시", "분", "초", "번", "살", "퍼센트", "%"})
        self.spelled_number = re.compile(r"(?<!\w)(?:" + NATIVE_NUMBER + "|" + SINO_NUMBER + r")\s*(?:" + "|".join(re.escape(u) for u in sorted(units, key=len, reverse=True)) + r")(?:\s*" + SUFFIX + r")?(?!\w)")

    def mentions(self, text):
        found = []
        for key, entry in self.lexicon.items():
            for surface, pattern in entry["patterns"].items():
                for match in pattern.finditer(text):
                    found.append({"identity": key, "surface": surface, "span": match.span(), "core": match.span("core")})
        # A one-syllable name such as 은 must not be recognized inside the
        # separated suffix of another known value: '민 은' is still only 민.
        return [m for m in found if not any(
            other["core"][1] <= m["core"][0]
            and other["span"][0] <= m["core"][0] < m["core"][1] <= other["span"][1]
            for other in found if other is not m
        )]

    def check_text(self, skeleton_id, text):
        skeleton = self.skeletons[skeleton_id]
        if not isinstance(text, str) or not text.strip():
            return {"lexicalPass": False, "missingSlots": [s["key"] for s in skeleton["protectedSlots"]],
                    "unexpectedProtected": [], "unexpectedNumeric": [], "polarityHintIssues": [],
                    "textErrors": ["text must be a nonempty string"], "semanticReviewRequired": True,
                    "semanticVerdict": "unreviewed"}
        text = normalize(text)
        mentions = self.mentions(text)
        expected = {identity(s) for s in skeleton["protectedSlots"]}
        # The accepted surfaces are per slot, not a global equivalence expansion.
        accepted = [m for m in mentions if m["identity"] in expected and any(
            identity(s) == m["identity"] and m["surface"] in s["surfaces"] for s in skeleton["protectedSlots"])]
        matched_keys = {m["identity"] for m in accepted}
        missing = [s["key"] for s in skeleton["protectedSlots"] if identity(s) not in matched_keys]
        extra = sorted({(m["identity"][0], m["identity"][1], m["identity"][2] or "") for m in mentions if m["identity"] not in expected})
        number_spans = [m["core"] for m in accepted if m["identity"][0] in {"count", "time"}]
        unexpected_numeric = []
        for pattern in (ARABIC_NUMBER, self.spelled_number):
            for match in pattern.finditer(text):
                # Arabic numbers include signs; a negative quantity cannot hide
                # behind a valid positive quantity beginning after its minus.
                if not any(a <= match.start() and match.end() <= b for a, b in number_spans):
                    # A spelled count regex consumes its suffix, so compare its
                    # number/unit prefix to a full accepted token span as well.
                    if pattern is self.spelled_number and any(a <= match.start() and match.end() <= b for a, b in [m["span"] for m in accepted if m["identity"][0] in {"count", "time"}]):
                        continue
                    # 공원 is a controlled location, not '공(0) 원'. Only an
                    # exact known nonnumeric token suppresses this ambiguity.
                    if pattern is self.spelled_number and any(m["identity"][0] not in {"count", "time"} and m["span"] == match.span() for m in mentions):
                        continue
                    unexpected_numeric.append({"text": match.group(), "span": list(match.span())})
        has_negation = bool(NEGATION.search(text))
        hints = []
        if skeleton["predicate"]["polarity"] == "positive" and has_negation:
            hints.append("possible polarity change: negative cue in positive skeleton")
        if skeleton["predicate"]["polarity"] == "negative" and not has_negation:
            hints.append("negative skeleton lacks a recognized negative cue; manual review needed")
        return {"lexicalPass": not (missing or extra or unexpected_numeric or hints),
                "missingSlots": missing,
                "unexpectedProtected": [{"type": t, "value": json.loads(v), **({"unit": u} if u else {})} for t, v, u in extra],
                "unexpectedNumeric": unexpected_numeric, "polarityHintIssues": hints, "textErrors": [],
                "semanticReviewRequired": True, "semanticVerdict": "unreviewed"}

    def evaluate(self, payload, source="model_raw"):
        errors = []
        records = payload.get("outputs") if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            errors.append("Input must be an array or an object containing an outputs array")
            records = []
        valid_records = [r for r in records if isinstance(r, dict)]
        if len(valid_records) != len(records):
            errors.append("Every output must be an object")
        counts = Counter(r.get("id") for r in valid_records if isinstance(r.get("id"), str))
        indexed = {r["id"]: r for r in valid_records if isinstance(r.get("id"), str)}
        for i, row in enumerate(valid_records):
            if not isinstance(row.get("id"), str) or row["id"] not in self.plan:
                errors.append(f"Output {i} has unknown or missing id")
        for key, count in counts.items():
            if count > 1:
                errors.append(f"Duplicate output id: {key}")
        results = []
        for key, plan in self.plan.items():
            row = indexed.get(key)
            record_errors = []
            if row is None:
                record_errors.append("missing output")
            else:
                if counts[key] != 1:
                    record_errors.append("duplicate id")
                for field in ("skeletonId", "style", "variant"):
                    if type(row.get(field)) is not type(plan[field]) or row.get(field) != plan[field]:
                        record_errors.append(f"id metadata mismatch: {field}")
            provenance = source
            if row is not None and row.get("provenance") in {"deterministic_template", "offline_reference"}:
                provenance = row["provenance"]
            text_check = self.check_text(plan["skeletonId"], row.get("text") if row else None)
            text_check["lexicalPass"] = text_check["lexicalPass"] and not record_errors
            results.append({**plan, "present": row is not None, "provenance": provenance,
                            "recordErrors": record_errors, **text_check})
        raw = [r for r in results if r["provenance"] == "model_raw"]
        summary = {"expected": len(self.plan), "received": len(records), "present": sum(r["present"] for r in results),
                   "lexicalPass": sum(r["lexicalPass"] for r in results),
                   "rawModelLexicalPass": sum(r["lexicalPass"] for r in raw),
                   "rawModelLexicalPassRate": sum(r["lexicalPass"] for r in raw) / len(self.plan),
                   "fallbackCount": sum(r["present"] and r["provenance"] == "deterministic_template" for r in results),
                   "fallbackLexicalPass": sum(r["lexicalPass"] and r["provenance"] == "deterministic_template" for r in results),
                   "offlineReferenceCount": sum(r["present"] and r["provenance"] == "offline_reference" for r in results),
                   "semanticReviewRequired": len(results), "semanticAccepted": 0,
                   "completeLexicalPass": not errors and all(r["lexicalPass"] for r in results)}
        return {"schemaVersion": "1.0", "checkScope": "controlled lexical slots and limited negative cues only",
                "inputErrors": errors, "summary": summary, "results": results}

    def references(self):
        return [{**plan, "text": self.skeletons[plan["skeletonId"]]["templates"][plan["style"]],
                 "provenance": "offline_reference"} for plan in self.plan.values()]

    def fallback(self, payload):
        report = self.evaluate(payload)
        records = payload.get("outputs", []) if isinstance(payload, dict) else payload
        records = records if isinstance(records, list) else []
        indexed = {r["id"]: r for r in records if isinstance(r, dict) and isinstance(r.get("id"), str)}
        outputs = []
        for result in report["results"]:
            plan = self.plan[result["id"]]
            if result["lexicalPass"]:
                original = indexed[result["id"]]
                outputs.append({**plan, "text": original["text"], "provenance": result["provenance"]})
            else:
                outputs.append({**plan, "text": self.skeletons[plan["skeletonId"]]["templates"][plan["style"]],
                                "provenance": "deterministic_template", "fallbackReason": {
                                    field: result[field] for field in ("recordErrors", "missingSlots", "unexpectedProtected", "unexpectedNumeric", "polarityHintIssues", "textErrors")}})
        return {"outputs": outputs, "rawSummary": report["summary"], "rawInputErrors": report["inputErrors"],
                "finalSummary": self.evaluate(outputs)["summary"],
                "limitation": "Fallback repairs lexical rejection only. Every output still requires semantic/style review; raw counts are retained."}


def write_json(path, data):
    body = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    if path:
        Path(path).write_text(body, encoding="utf-8")
    else:
        sys.stdout.write(body)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    subs = parser.add_subparsers(dest="command", required=True)
    check = subs.add_parser("check", help="Check all 120 expected model outputs")
    check.add_argument("input", type=Path)
    check.add_argument("--report", type=Path)
    check.add_argument("--source", choices=("model_raw", "offline_reference", "deterministic_template"), default="model_raw")
    fallback = subs.add_parser("fallback", help="Replace rejected/missing outputs with deterministic templates")
    fallback.add_argument("input", type=Path)
    fallback.add_argument("--output", type=Path)
    refs = subs.add_parser("references", help="Write 120 authored references; never model successes")
    refs.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        checker = Checker(load_fixtures(args.fixtures))
        if args.command == "references":
            write_json(args.output, checker.references())
            return 0
        with args.input.open(encoding="utf-8") as handle:
            payload = json.load(handle)
        if args.command == "fallback":
            result = checker.fallback(payload)
            write_json(args.output, result)
            return 0 if result["finalSummary"]["completeLexicalPass"] else 1
        result = checker.evaluate(payload, args.source)
        write_json(args.report, result)
        return 0 if result["summary"]["completeLexicalPass"] else 1
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"slot-check: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
