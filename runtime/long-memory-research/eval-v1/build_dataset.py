#!/usr/bin/env python3
"""Deterministic synthetic inputs, never model outputs or service calls.

The frozen plan and CONTRACT define policy. These fixtures additionally specify:
* Events carry their own scope/cid; an auxiliary cid is a real separate context.
* settle_turn completes T only. finish_c runs C explicitly; no assumed timer.
* queue_c captures owner, original source turns and epoch once, before its named
  barrier. release_c never refreshes that epoch, even after restart/resume.
* late_commit_accepted means a stale WRITE, not completion of a rejected job.
* attach_s6 is synthetic upstream input, not a measured judge result.
* trim_context removes named raw turns, not memory; unsupported controls unknown.
* auto_episode_values describes automatic selection on THIS call, not history.
* relation_prior_count excludes current cid and counts the scoped prior cids.
* session content may survive as raw dialogue; it must not become structured LTM.
* context arrays are exact fixture-value projections of actual captures. They
  must not be fabricated from gold. Prior raw text is not active memory.

Outputs are exclusive. Regeneration into an existing bundle is refused.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FAMILIES = [
    "t_direct", "correction_history", "withdraw_history", "forget_process",
    "c_forget_race", "c_pause_race", "session_context", "promise_source_binding",
    "episode_s6", "returning_episode", "budget_actual_load", "restart_c_missing",
    "scope_isolation", "contest_confirm",
]
DOMAINS = ["signage", "guest_service_persona"]
DATES = ["2026-12-01T10:00:00+00:00", "2026-12-01T10:30:00+00:00",
         "2026-12-01T11:00:00+00:00"]
TABLES = ["stories", "targets", "checkpoints", "events", "jobs", "conversations"]


def opaque(kind: str, value: str) -> str:
    return kind + "-" + hashlib.sha256(("memory-v02/" + value).encode()).hexdigest()[:20]


def dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def contains(path: str, value: object, metric="state_accuracy", gate=False) -> tuple:
    return metric, gate, path, "contains", value


def excludes(path: str, value: object, metric="forbidden_value", gate=True) -> tuple:
    return metric, gate, path, "excludes", value


def eq(path: str, value: object, metric="state_accuracy", gate=True) -> tuple:
    return metric, gate, path, "eq", value


class Story:
    def __init__(self, number: int, domain: str):
        self.id = f"n{number:02d}-{'signage' if domain == 'signage' else 'guest'}"
        self.family, self.domain = FAMILIES[number - 1], domain
        self.scope = {"product": "ganpan" if domain == "signage" else "uljima6",
                      "principal_id": opaque("pr-test", self.id + "/owner"),
                      "persona_id": opaque("persona", self.id + "/persona")}
        self.values = (("남색", "연두색", "주황색") if domain == "signage"
                       else ("보리차", "유자차", "둥굴레차"))
        self.subject = "우리 가게 간판의 기본색" if domain == "signage" else "내 평소 기본 차"
        self.slot = "signage.default_color" if domain == "signage" else "guest.default_tea"
        self.episode = "종이 모형 맞추기 완료" if domain == "signage" else "종이 배 접기 완료"
        self.promise = "다음 방문에 창문 치수 재확인" if domain == "signage" else "다음 방문에 독서 소감 재확인"
        self.checkpoints, self.gold = [], []
        self.history_watch = []
        self.event_count = self.job_count = 0

    def cid(self, suffix: str) -> str:
        return opaque("cid", self.id + "/" + suffix)

    def start(self, lane: str, scope: dict | None = None, *, at: str | None = None) -> None:
        self.active_scope = copy.deepcopy(scope or self.scope)
        self.active = {"id": self.id + f"-k{len(self.checkpoints) + 1}",
                       "at": at or DATES[len(self.checkpoints)], "conversation_id": self.cid(lane),
                       "events": []}
        self.checkpoints.append(self.active)

    def event(self, payload: dict, *, scope=None, cid=None) -> str:
        self.event_count += 1
        identifier = self.id + f"-e{self.event_count:03d}"
        self.active["events"].append({"id": identifier,
            "conversation_id": cid or self.active["conversation_id"],
            "scope": copy.deepcopy(scope or self.active_scope), **payload})
        return identifier

    def turn(self, text: str, speaker="human", *, verdict=None, scope=None, cid=None) -> str:
        event = {"kind": "turn", "speaker": speaker, "text": text,
                 "origin": {"kind": speaker, "synthetic_fixture": True}}
        if verdict is not None:
            event["s6"] = {"verdict": verdict, "source": "synthetic_fixture"}
        return self.event(event, scope=scope, cid=cid)

    def control(self, action: str, description: str, *, scope=None, cid=None, **params) -> str:
        if action in {"finish_c", "queue_c", "forget", "pause", "resume", "restart_worker", "trim_context", "retry_turn"}:
            params.setdefault("conversation_id", cid or self.active["conversation_id"])
        return self.event({"kind": "control", "action": action,
                           "description": description, "params": params}, scope=scope, cid=cid)

    def settle(self, source: str, *, scope=None, cid=None) -> None:
        self.control("settle_turn", "지정 사람 턴의 T가 끝날 때까지 기다린다. C는 실행하지 않는다.",
                     source_event_id=source, scope=scope, cid=cid)

    def fact(self, value: str, *, correction=False, scope=None, cid=None) -> str:
        lead = "앞의 설정을 정정할게. 지금부터 " if correction else "앞으로도 기억해 줘. "
        source = self.turn(lead + f"{self.subject}는 {value}야.", scope=scope, cid=cid)
        self.settle(source, scope=scope, cid=cid)
        return source

    def finish(self, sources: list[str] | None = None) -> None:
        params = {"conversation_id": self.active["conversation_id"]}
        if sources:
            params["source_event_ids"] = sources
        self.control("finish_c", "해당 대화의 C를 실제로 완료 시도하고 실행 여부와 원천 판정 연결을 기록한다.", **params)

    def queue(self, sources: list[str], barrier="before_commit") -> str:
        self.job_count += 1
        identifier = opaque("job", self.id + f"/{self.job_count}")
        self.control("queue_c", "별개 C 작업의 시작 원천·소유자·epoch를 관측 기록하고 실제 실행을 지정 barrier에서 보류한다. 관측자가 런타임 epoch 읽기 순서나 값 자체를 고치지 않는다. 지원하지 못하는 barrier는 unknown이다.",
                     job_id=identifier, conversation_id=self.active["conversation_id"],
                     source_event_ids=sources, barrier=barrier,
                     capture_owner=True, capture_epoch="job_start", epoch_capture_mode="observe_only_no_runtime_rewrite", hold=True)
        return identifier

    def release(self, job: str) -> None:
        self.control("release_c", "보류한 같은 작업을 원래 원천과 시작 epoch 그대로 재개한다. 새 epoch로 바꾸지 않는다.",
                     job_id=job, preserve_captured_epoch=True)

    def attach(self, source: str, verdict: str) -> None:
        self.control("attach_s6", "정확한 원천 턴에 합성 S6 판정을 연결한다. 인접한 다른 턴 판정으로 대신하지 않는다.",
                     source_event_id=source, s6={"verdict": verdict, "source": "synthetic_fixture"})

    def target(self, query: str, rubric: str, *, recall=(), checks=(), interpretation="contract", watch=()) -> None:
        identifier = self.id + f"-q{len(self.checkpoints)}"
        self.active["probe"] = {"id": identifier, "query": query,
                                "scope": copy.deepcopy(self.active_scope)}
        criteria = [eq("context/capture_complete", True, "capture_complete")]
        criteria += [contains("context/effective_active_values", value, "recall") for value in recall]
        criteria += list(checks)
        if len(criteria) < 2:
            raise ValueError("Each target must have a capture and a meaningful state check")
        self.history_watch = list(dict.fromkeys(self.history_watch + list(watch)))
        self.gold.append({"id": identifier, "scenario_id": self.id, "family": self.family,
            "domain": self.domain, "positive": bool(recall), "interpretation": interpretation,
            "history_watch_values": list(self.history_watch),
            "answer_rubric": rubric, "checks": [
                {"id": identifier + f"-c{i:02d}", "metric": metric, "gate": gate,
                 "path": "/artifacts/" + path, "operator": operator, "value": value}
                for i, (metric, gate, path, operator, value) in enumerate(criteria, 1)]})

    def record(self) -> dict:
        return {"id": self.id, "family": self.family, "domain": self.domain,
                "scope": self.scope, "checkpoints": self.checkpoints}


def make_story(number: int, domain: str) -> Story:
    s = Story(number, domain)
    a, b, c = s.values
    ask = f"기억해 둔 {s.subject}를 알려 줘."
    current = lambda value: (contains("principal_values", value), contains("current_values", value))

    if number == 1:  # T persist, return before C, state after failed-delivery retry.
        s.start("first")
        source = s.fact(a)
        s.target(ask, "C 완료 전에도 사람의 지속 기본값을 기억해 답한다.", recall=(a,),
                 checks=current(a) + (eq("c_completed", False, "phase_boundary"),))
        s.start("return", at="2026-12-01T10:01:00+00:00")
        s.turn("다시 왔어. 지난번의 기본 설정을 바꾸지 않았어.")
        s.target(ask, "C 없이 저장한 이전 대화의 기본값을 재방문에서 회상한다.", recall=(a,), checks=current(a))
        s.start("return", at="2026-12-01T10:02:00+00:00")
        s.control("retry_turn", "첫 대화의 T 처리 뒤 전송 확인 응답이 유실된 상황에서 동일 id를 재전송한다. 새 발화로 만들지 않는다.",
                  source_event_id=source, conversation_id=s.cid("first"))
        s.target(ask, "동일 전송 재시도 뒤에도 기본값은 그대로이며 대체 값을 지어내지 않는다.", recall=(a,),
                 checks=current(a) + (excludes("principal_values", b),))

    elif number == 2:
        s.start("ongoing")
        s.fact(a)
        s.target(ask, "초기 기본값을 정확히 회상한다.", recall=(a,), checks=current(a))
        s.start("ongoing")
        s.fact(b, correction=True)
        s.target(ask, "정정은 T 직후 적용한다. 이전 블록의 값은 현재값으로 사용하지 않는다.", recall=(b,), watch=(a,),
                 checks=current(b) + (excludes("principal_values", a), excludes("context/effective_active_values", a),
                                      eq("context/replacement_header", True, "replacement_policy")))
        s.start("ongoing")
        s.turn("아까 고친 기본 설정으로 이어서 안내해 줘.")
        s.target(ask, "changed-only 새 주입이 없어도 앞의 교체 상태를 이어 가며 옛값으로 회귀하지 않는다.", recall=(b,),
                 checks=current(b) + (excludes("context/effective_active_values", a),
                                      eq("context/emitted", False, "changed_only")))

    elif number == 3:
        s.start("ongoing")
        s.fact(a)
        s.fact(b, correction=True)
        s.target(ask, "정정된 값만 현재 설정으로 답한다.", recall=(b,), watch=(a,), checks=current(b) + (excludes("principal_values", a),))
        s.start("ongoing")
        source = s.turn(f"{self_subject(s)}의 현재 설정을 철회할게. 예전 설정으로 되돌리는 것도 아니야. 기본값은 미정으로 해 줘.")
        s.settle(source)
        s.target(ask, "철회 뒤 미정이라고 답한다. 역사적 발화는 남을 수 있지만 현재값으로 재채택하지 않는다.", watch=(b,),
                 checks=(excludes("principal_values", a), excludes("principal_values", b),
                         excludes("context/effective_active_values", a), excludes("context/effective_active_values", b),
                         contains("context/withdrawn_slots", s.slot, "withdrawal", True)))
        s.start("return")
        s.turn("다시 왔어. 기본 설정은 아직 새로 정하지 않았어.")
        s.target(ask, "재방문에서도 철회한 두 값을 기본값으로 복원하지 않는다.",
                 checks=(excludes("principal_values", a), excludes("principal_values", b),
                         excludes("context/all_input_values", a), excludes("context/all_input_values", b)))

    elif number == 4:
        s.start("old")
        s.fact(a)
        s.target(ask, "삭제 전 실제 기억 값이 호출에 들어온 상태를 확인한다.", recall=(a,), checks=current(a))
        old = s.active["conversation_id"]
        s.start("fresh")
        s.control("forget", "소유자의 전체 기억을 잊기 처리하고 연결된 옛 대화 실행기를 닫는다. 새 대화에서만 이어 간다.",
                  conversation_id=old, deletion_scope="all_owner_memory")
        s.control("attempt_resume", "잊기 처리된 옛 대화 id로 재개를 시도하여 실제 거부 및 닫힌 프로세스 증거를 남긴다.",
                  closed_conversation_id=old)
        s.target(ask, "옛 기억을 모른다고 답한다. 저장소뿐 아니라 전체 새 입력에도 옛값이 없어야 한다.", watch=(a,),
                 checks=(eq("old_process_closed", True, "forget_process"), eq("resume_allowed", False, "forget_process"),
                         excludes("principal_values", a), excludes("context/effective_active_values", a),
                         excludes("context/all_input_values", a, "forget_full_input")))
        s.start("fresh")
        s.fact(c)
        s.target(ask, "삭제 뒤 새로 제공한 값은 다시 기억할 수 있으나 옛값을 되살리지 않는다.", recall=(c,),
                 checks=current(c) + (excludes("context/all_input_values", a, "forget_full_input"),))

    elif number == 5:
        s.start("old")
        s.fact(a)
        event = s.turn(s.episode + ". 다음에 이 일을 이야기하자.", "assistant", verdict="pass")
        job = s.queue([event], barrier="after_source_read_before_epoch" if domain == "signage" else "during_model_before_commit")
        s.target(ask, "T fact는 저장됐지만 보류된 C episode를 완료된 저장으로 보고하지 않는다.", recall=(a,),
                 checks=current(a) + (excludes("episode_values", s.episode), eq("c_completed", False, "phase_boundary")))
        old = s.active["conversation_id"]
        s.start("fresh")
        s.control("forget", "원래 소유자의 기억과 대화를 잊기 처리한다. 보류 작업의 원래 epoch는 보존한다.",
                  conversation_id=old, deletion_scope="all_owner_memory")
        s.release(job)
        s.target(ask, "잊기 전 캡처한 C 결과가 늦게 도착해도 옛 fact/episode를 부활시키지 않는다.", watch=(a, s.episode),
                 checks=(eq("late_commit_accepted", False, "stale_write"), excludes("principal_values", a),
                         excludes("episode_values", s.episode), excludes("context/all_input_values", a),
                         excludes("context/all_input_values", s.episode)))
        s.start("fresh")
        s.control("restart_worker", "워커를 재시작하되 보류 작업의 저장된 원천 epoch를 유지한다.", preserve_storage=True)
        s.release(job)
        s.fact(c)
        s.target(ask, "재시작 뒤 같은 낡은 작업 재시도는 쓰지 못하고 새 T fact는 정상 저장한다.", recall=(c,),
                 checks=current(c) + (eq("late_commit_accepted", False, "stale_write"),
                                      excludes("episode_values", s.episode), excludes("context/all_input_values", a),
                                      excludes("context/all_input_values", s.episode)))

    elif number == 6:
        s.start("ongoing")
        s.fact(a)
        event = s.turn(s.episode + ".", "assistant", verdict="pass")
        job = s.queue([event])
        s.target(ask, "pause 전에 저장된 fact는 존재하고 보류 C는 아직 episode를 쓰지 않는다.", recall=(a,),
                 checks=current(a) + (excludes("episode_values", s.episode),))
        s.start("ongoing")
        s.control("pause", "이 소유자의 기억 읽기·쓰기를 중단하고 epoch를 바꾼다. 기존 저장은 보존한다.",
                  conversation_id=s.active["conversation_id"])
        paused_source = s.fact(b, correction=True)
        s.release(job)
        s.target("지금 기억 기능이 어떤 상태인지 알려 줘.", "기억이 중단됐음을 알리고 기억에서 과거값을 새로 읽거나 중단 중 새값을 저장하지 않는다.",
                 checks=(eq("paused", True, "pause"), contains("principal_values", a), excludes("principal_values", b),
                         eq("late_commit_accepted", False, "stale_write"), eq("context/emitted", False, "pause"),
                         excludes("episode_values", s.episode)))
        s.start("return")
        s.control("resume", "기억 기능을 재개한다. pause 중 발화를 소급 추출하지 않는다.", conversation_id=s.active["conversation_id"])
        s.release(job)
        s.control("retry_turn", "pause 중의 원래 전송을 같은 id로 재시도한다. 원천 때의 동의/epoch를 현재로 바꾸지 않는다.",
                  source_event_id=paused_source, conversation_id=s.cid("ongoing"))
        s.target(ask, "재개 뒤 보존된 원래 기본값만 회상한다. 낡은 C와 pause 중 발화 재시도로 새값이 생기면 안 된다.", recall=(a,),
                 checks=current(a) + (eq("paused", False, "pause"), eq("late_commit_accepted", False, "stale_write"),
                                      excludes("principal_values", b), excludes("episode_values", s.episode)))

    elif number == 7:
        s.start("ongoing")
        s.fact(a)
        s.target(ask, "지속 기본값을 기억한다.", recall=(a,), checks=current(a))
        s.start("ongoing")
        event = s.turn(f"이번 대화에서만 {s.subject} 대신 {b}로 이야기하자. 평소 기본값 변경도, 장기 저장 요청도 아니야.")
        s.settle(event)
        s.target("이번 대화에서만 적용할 값과 평소 기본 설정을 구분해서 알려 줘.",
                 "원문 대화의 임시값과 기억의 기본값을 구분한다. 임시값의 구조화 current 저장을 요구하지 않는다.", recall=(a,),
                 checks=(contains("principal_values", a), excludes("principal_values", b),
                         excludes("context/fresh_values", b), contains("context/all_input_values", b, "session_context")))
        s.start("return")
        s.turn("새 대화로 다시 왔어. 이번에는 임시 설정 없이 평소대로 해 줘.")
        s.target(ask, "새 대화에는 임시값을 회상하지 않고 기존 지속 기본값을 사용한다.", recall=(a,),
                 checks=current(a) + (excludes("principal_values", b), excludes("context/all_input_values", b)))

    elif number == 8:
        s.start("ongoing")
        s.fact(a)
        promised = s.turn(s.promise + "할게.", "assistant")
        s.finish([promised])
        s.target("기본 설정과 확정된 다음 약속이 있으면 알려 줘.", "S6 미확정 원천의 약속을 기억에 승격하지 않는다. 기본 fact는 그대로다.", recall=(a,),
                 checks=(contains("principal_values", a), excludes("must_repeat_values", s.promise),
                         excludes("principal_values", s.promise), eq("c_completed", True, "phase_boundary")))
        s.start("ongoing")
        s.attach(promised, "block")
        unrelated = s.turn("네, 오늘 대화에 집중할게.", "assistant", verdict="pass")
        s.finish([promised, unrelated])
        s.target("기본 설정과 확정된 다음 약속이 있으면 알려 줘.", "같은 cid의 다른 응답 pass로 차단된 약속 원천을 통과시키지 않는다.", recall=(a,),
                 checks=(eq("source_bound", True, "source_binding"), excludes("must_repeat_values", s.promise),
                         excludes("principal_values", s.promise)))
        s.start("ongoing")
        accepted = s.turn(s.promise + "할게.", "assistant", verdict="pass")
        s.finish([accepted])
        s.target("기본 설정과 다음에 확인하기로 한 약속을 알려 줘.", "별도의 정확한 pass 원천을 가진 약속은 C를 통해 회상할 수 있다.", recall=(a, s.promise),
                 checks=(eq("source_bound", True, "source_binding"), contains("must_repeat_values", s.promise),
                         eq("c_completed", True, "phase_boundary")))

    elif number == 9:
        bad = "유리 조각 맞추기 완료" if domain == "signage" else "창문 종이꽃 접기 완료"
        done = "종이 목록 정리 완료" if domain == "signage" else "책갈피 접기 완료"
        s.start("first")
        event = s.turn(s.episode + ".", "assistant", verdict="pass")
        s.finish([event])
        s.target("우리가 방금 마친 일을 기억해서 알려 줘.", "실제 pass 원천의 완료 episode를 저장하되 미래 반복 약속으로 만들지 않는다. 같은 대화 원문으로 답해도 되고 재주입은 강제하지 않는다.",
                 checks=(contains("episode_values", s.episode), excludes("must_repeat_values", s.episode),
                         eq("source_bound", True, "source_binding")))
        s.start("first")
        event = s.turn(bad + ".", "assistant", verdict="block" if domain == "signage" else "fix")
        s.finish([event])
        s.target("기억에 남긴 완료된 일을 알려 줘.", "block/fix 원천의 episode 직접 INSERT를 거부하며 이전 pass episode를 유지한다. 현재 대화 episode의 재주입은 요구하지 않는다.",
                 checks=(contains("episode_values", s.episode), excludes("episode_values", bad),
                         excludes("context/effective_active_values", bad), eq("source_bound", True, "source_binding")))
        s.start("return")
        event = s.turn(done + ".", "assistant", verdict="pass")
        s.finish([event])
        s.target("지난 대화에서 마친 일을 기억해서 알려 줘. 이번에 마친 일과 구분하고, 다음에도 반드시 할 약속이 있는지도 알려 줘.",
                 "지난 대화의 pass episode를 회상한다. 새 pass 완료 episode도 저장하되 현재 cid의 episode 재주입은 강제하지 않고 must_repeat 미래 약속으로 바꾸지 않는다.", recall=(s.episode,),
                 checks=(contains("episode_values", done), excludes("episode_values", bad),
                         excludes("must_repeat_values", done), eq("source_bound", True, "source_binding")))

    elif number == 10:
        s.start("first")
        s.fact(a)
        event = s.turn(s.episode + ".", "assistant", verdict="pass")
        s.finish([event])
        s.target(ask, "첫 대화 자체를 과거 방문으로 세지 않는다. 같은 대화의 episode를 재방문 자동회상으로 꾸미지 않는다.", recall=(a,),
                 checks=(eq("relation_prior_count", 0, "relation_scope"), eq("auto_episode_values", [], "returning_episode"),
                         contains("episode_values", s.episode)))
        s.start("return")
        s.control("advance_time", "새 대화의 첫 사람 메시지는 아래 probe다. 그 전에 인사 턴을 보내지 않고 fixture 시각만 맞춘다.", to=DATES[1])
        s.target("오늘도 평소 설정으로 시작할까?", "재방문 첫 턴에서 이전 pass episode 하나를 날짜와 함께 자연스럽게 회상할 수 있다.", recall=(a, s.episode),
                 checks=(eq("relation_prior_count", 1, "relation_scope"), eq("auto_episode_values", [s.episode], "returning_episode"),
                         eq("load_projection_matches", True, "load_trace"),
                         ("context_budget", True, "context/fresh_tokens", "lte", 600)))
        s.start("return")
        s.turn("응, 이어서 진행해 줘.")
        s.target(ask, "같은 재방문 대화의 다음 턴에 자동 episode를 새로 반복 선택하지 않는다. 이전 입력의 잔존과 구분한다.", recall=(a,),
                 checks=(eq("relation_prior_count", 1, "relation_scope"), eq("auto_episode_values", [], "returning_episode")))

    elif number == 11:
        s.start("ongoing")
        source = s.fact(a)
        s.target(ask, "작은 기본 기억을 실제 호출에 싣고 실제 기록과 일치시킨다.", recall=(a,),
                 checks=current(a) + (eq("load_projection_matches", True, "load_trace"),
                                      ("context_budget", True, "context/fresh_tokens", "lte", 600)))
        s.start("ongoing")
        for index in range(1, 25):
            event = s.turn(f"별개 정리함 {index:02d}의 라벨은 합성표식-{index:02d}야. 기억해 줘.")
            s.settle(event)
        s.control("trim_context", "지정한 오래된 사람 원문만 실제 입력 창에서 제거한다. 기억 DB와 기존 기억 블록은 유지한다.",
                  source_event_ids=[source], conversation_id=s.active["conversation_id"],
                  remove="raw_source_turns", preserve_memory_blocks=True)
        s.target(ask, "원문이 잘린 뒤에도 명시적 과거 설정 질문에 기본값을 회상한다. 특정 검색 경로/강제 퇴출을 가정하지 않는다.", recall=(a,),
                 checks=(contains("principal_values", a), eq("load_projection_matches", True, "load_trace"),
                         ("context_budget", True, "context/fresh_tokens", "lte", 600)))
        s.start("ongoing")
        s.turn("정리함 말고 평소의 핵심 설정으로 안내해 줘.")
        s.target(ask, "방해 기억이 있어도 기본값을 회상하며 누적 옛 블록 길이와 이번 600토큰 블록 길이를 혼동하지 않는다.", recall=(a,),
                 checks=(contains("principal_values", a), eq("load_projection_matches", True, "load_trace"),
                         ("context_budget", True, "context/fresh_tokens", "lte", 600)))

    elif number == 12:
        s.start("first")
        s.fact(a)
        event = s.turn(s.episode + ".", "assistant", verdict="pass")
        job = s.queue([event], barrier="timer_pending_before_start")
        s.target(ask, "T 값은 바로 남고 타이머 대기 C는 아직 실행됐다고 보지 않는다.", recall=(a,),
                 checks=current(a) + (eq("c_completed", False, "phase_boundary"), excludes("episode_values", s.episode)))
        s.start("return", at="2026-12-01T10:10:00+00:00")
        s.control("restart_worker", "C 타이머가 발화하기 전에 프로세스를 종료 후 재시작한다. 저장소만 보존하고 인프로세스 타이머는 보존하지 않는다.",
                  preserve_storage=True, restore_inprocess_timers=False)
        s.control("advance_time", "재시작한 뒤 fixture 시계를 10:30으로 전진해 원래 20분 타이머 기한을 지난다. C 완료를 주입하지 않는다.",
                  to=DATES[1])
        s.target("지난번 기본 설정과 완료한 일을 기억해 줘.", "복구 challenge: 재시작 후 누락된 C를 스스로 복구해 episode를 회상하는지 측정한다. 미실행은 성공이 아니다.",
                 recall=(a, s.episode), interpretation="challenge",
                 checks=(contains("principal_values", a), contains("episode_values", s.episode), eq("c_completed", True, "restart_recovery")))
        s.start("return")
        s.release(job)
        s.target("지난번 완료한 일을 이제 기억하고 있니?", "동일 epoch의 보존된 원천 작업을 명시적으로 재개하면 pass episode를 저장할 수 있다.", recall=(s.episode,),
                 checks=(contains("episode_values", s.episode), eq("c_completed", True, "phase_boundary"),
                         eq("source_bound", True, "source_binding")))

    elif number == 13:
        # One exact owner fixture, then three probes differing in one key each.
        owner_cid = s.cid("owner")
        other_principal = {**s.scope, "principal_id": opaque("pr-test", s.id + "/other")}
        s.start("principal-boundary", other_principal)
        s.fact(a, scope=s.scope, cid=owner_cid)
        s.fact(b)
        s.target(ask, "다른 principal의 값은 검색·입력에 들어오지 않고 현재 손님의 값만 답한다.", recall=(b,),
                 checks=current(b) + (excludes("principal_values", a), excludes("context/all_input_values", a, "scope_isolation")))
        other_product = {**s.scope, "product": "uljima6" if s.scope["product"] == "ganpan" else "ganpan"}
        s.start("product-boundary", other_product)
        s.fact(c)
        s.target(ask, "동일 principal/persona라도 다른 제품의 값을 가져오지 않는다.", recall=(c,),
                 checks=current(c) + (excludes("principal_values", a), excludes("context/all_input_values", a, "scope_isolation"),
                                      excludes("context/all_input_values", b, "scope_isolation")))
        other_persona = {**s.scope, "persona_id": opaque("persona", s.id + "/other")}
        s.start("persona-boundary", other_persona)
        s.turn("처음 대화하는 이 페르소나에서 내 기본 설정을 알고 있니?")
        s.target(ask, "다른 persona의 지속값을 넘겨받지 않는다. 모르는 현재 범위의 설정을 추정하지 않는다.",
                 checks=(excludes("principal_values", a), excludes("principal_values", b), excludes("principal_values", c),
                         excludes("context/all_input_values", a, "scope_isolation"),
                         excludes("context/all_input_values", b, "scope_isolation"), excludes("context/all_input_values", c, "scope_isolation")))

    elif number == 14:
        s.start("ongoing")
        s.fact(a)
        s.target(ask, "처음의 지속값을 정상적으로 기억한다.", recall=(a,), checks=current(a))
        s.start("ongoing")
        s.fact(b)  # New value without an explicit correction/confirmation phrase.
        s.target(ask, "상충한 새값을 잠정 현재값으로 적용하되 확인을 요청한다. 옛값 확인 언급과 옛값 현재 채택은 구분한다.", recall=(b,), watch=(a,),
                 checks=current(b) + (eq("needs_confirm", True, "contest"), excludes("context/effective_active_values", a)))
        s.start("ongoing")
        event = s.turn(f"확인할게. 지금부터 {self_subject(s)}는 {b}가 맞아. 그 값으로 확정해 줘.")
        s.settle(event)
        s.target(ask, "확인된 새값을 사용하고 같은 충돌 확인 질문을 반복하지 않는다.", recall=(b,),
                 checks=current(b) + (eq("needs_confirm", False, "confirm"), excludes("context/effective_active_values", a)))
    return s


def self_subject(story: Story) -> str:
    return story.subject


def replace_strings(value: object, lookup: dict) -> object:
    if isinstance(value, str):
        return lookup.get(value, value)
    if isinstance(value, list):
        return [replace_strings(item, lookup) for item in value]
    if isinstance(value, dict):
        return {key: replace_strings(item, lookup) for key, item in value.items()}
    return value


def build() -> dict[str, str]:
    plan = json.loads((ROOT / "plan.json").read_text(encoding="utf-8"))
    if plan["families"] != FAMILIES or plan["domains"] != DOMAINS:
        raise ValueError("Frozen plan and generator do not agree")
    stories = [make_story(index, domain) for index in range(1, 15) for domain in DOMAINS]
    raw = [story.record() for story in stories]
    gold = [target for story in stories for target in story.gold]
    mapping = {table: {} for table in TABLES}
    def register(table, identifier):
        mapping[table][identifier] = opaque("blind-" + table.rstrip("s"), identifier)
    for story in raw:
        register("stories", story["id"])
        for checkpoint in story["checkpoints"]:
            register("checkpoints", checkpoint["id"])
            register("targets", checkpoint["probe"]["id"])
            register("conversations", checkpoint["conversation_id"])
            for event in checkpoint["events"]:
                register("events", event["id"])
                register("conversations", event["conversation_id"])
                if event.get("action") == "queue_c":
                    register("jobs", event["params"]["job_id"])
    lookup = {original: blind for table in mapping.values() for original, blind in table.items()}
    blind = [replace_strings({key: value for key, value in story.items() if key not in {"family", "domain"}}, lookup) for story in raw]
    annotations = [{"id": mapping["targets"][row["id"]], "verdict": "", "rationale": "",
                    "judge_id": "", "judge_version": ""} for row in gold]
    if len(raw) != plan["counts"]["stories"] or len(gold) != plan["counts"]["targets"]:
        raise ValueError("Frozen counts not met")
    payloads = {"scenarios.jsonl": raw, "gold.jsonl": gold, "blind/scenarios.jsonl": blind,
                "blind/annotation_template.jsonl": annotations}
    return {**{name: "".join(dumps(row) + "\n" for row in rows) for name, rows in payloads.items()},
            "private/blind_map.json": dumps(mapping) + "\n"}


def write_new(output_dir: Path, payloads: dict[str, str]) -> None:
    paths = [output_dir / name for name in payloads]
    if any(path.exists() for path in paths):
        raise FileExistsError("Existing dataset output; generate into a new directory")
    for path in paths:
        path.parent.mkdir(parents=True, exist_ok=True)
    for name, payload in payloads.items():
        with (output_dir / name).open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(payload)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT)
    args = parser.parse_args()
    payloads = build()
    write_new(args.output_dir, payloads)
    gold = [json.loads(line) for line in payloads["gold.jsonl"].splitlines()]
    print(dumps({"stories": 28, "targets": len(gold), "positive_targets": sum(row["positive"] for row in gold),
                 "challenge_targets": sum(row["interpretation"] == "challenge" for row in gold),
                 "checks": sum(len(row["checks"]) for row in gold), "model_calls": 0,
                 "sha256": {name: hashlib.sha256(payload.encode()).hexdigest() for name, payload in payloads.items()}}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
