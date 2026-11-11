# 읽음 표시를 요약 성공 뒤로 미루는 회귀 검증

최종 소스 Elda-Ops `79865df20dab879d3ead046c03b6e6dcfb473209`: [11/11 통과](79865df.json). 모델/CLI/MCP 응답과 읽음 상태를 모사한 검사이며 운영 Task를 실행한 결과가 아니다. 배포는 인프라가 보고했고, 클로버는 Git 소스 사본을 독립 검증했다.

`regression.py`는 실제 digest의 `main()`과 `summarize()`를 사용한다. subprocess를 가짜 MCP/CLI 응답으로 대체하고 외부 프로세스·네트워크를 차단한다. 실패·timeout·빈 답·비정상 종료·둘째 멤버 실패·구형 MCP·읽음 표시 전후 오류를 다룬다. exit 0은 모든 기능 조건 통과, exit 1은 적어도 하나의 기능 조건 실패다. 시험 실행 자체의 완료 여부는 별도 필드다.

```bash
# 먼저 해당 커밋의 digest.py를 자기 작업 폴더 안에 사본으로 준비한다.
# --output은 이 checkout 안의 새 파일이어야 한다.
python3 -B runtime/clova/ops-task/inbox-digest/read-ack/regression.py \
  --source .local/inbox-digest-source-79865df.py \
  --commit 79865df20dab879d3ead046c03b6e6dcfb473209 \
  --output .local/inbox-read-ack-rerun.json
```

`--commit`은 결과 라벨이며 source 파일의 Git 출처를 자동 인증하지 않는다. 이 저장소에 커밋한 결과는 부모 검토가 source SHA를 실제 Git blob과 대조했다. 검증기도 파일 SHA를 기록한다.

| 보존 결과 | 그 당시 검사 범위 |
| --- | --- |
| [bcefdaa](bcefdaa.json) | 최초 8건, 5건 통과. keepUnread 방식의 중간 버전. 당시 runner는 결과의 해시로 식별하며 현행 runner와 다름. |
| [9ff40f3](9ff40f3.json) | 최초 9건, 7건 통과. 별도 peek·전체 요약 후 표시 도입. |
| [9ff40f3-expanded](9ff40f3-expanded.json) | 확장 11건, 7건 통과. CLI 비정상 종료와 표시 후 응답 실패 추가. |
| [79865df](79865df.json) | 같은 확장 11건, 모두 통과. 빈 답·종료 코드·완료/미확정 상태 구분. |

[peek-handler-test.mjs](peek-handler-test.mjs)는 고정 MCP 소스 `f296148`의 도구 선언만 Node VM에서 평가한다. hub와 renderer는 합성 대역이며 원본 MCP dispatcher·config·네트워크를 실행하지 않는다. [결과](peek-handler-result.json)는 9개 경계 확인이다. 오류를 `isError`로 감싸는 부분은 원본 catch를 정적으로 대조한 시험용 구현으로, 실제 dispatcher를 시험했다는 뜻은 아니다.

```bash
# .local/comms-mcp-source-f296148.mjs 사본 SHA가 고정값과 같아야 실행된다.
node runtime/clova/ops-task/inbox-digest/read-ack/peek-handler-test.mjs
```

이 검사들은 읽음 상태의 분산 저장·원자성·최종 보고 전달까지 보장하지 않는다. 의미가 틀렸지만 비어 있지 않은 모델 요약은 별도 품질 판정 대상이다.
