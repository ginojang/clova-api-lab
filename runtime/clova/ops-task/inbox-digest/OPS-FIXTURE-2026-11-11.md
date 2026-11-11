# ops 경로의 격리 MCP

`ops-fixture-mcp.py`는 실제 ops MCP의 도구 5개와 resource templates를 그대로 노출한다. 모든 `tools/call`은 `isError: true`, `isolated fixture: tool call not executed`를 반환하고 도구 이름·인자를 stderr JSONL에 남긴다. `resources/read`도 실행하지 않고 JSON-RPC 오류와 stderr 기록을 남긴다. 모델이나 운영 장비·피드·받은편지함에 접속하는 코드는 없다. 입력 인자를 기록하므로 합성 사례 전용으로 사용한다.

스키마는 로컬 Elda-Ops `cf7138e369bf48c81aebbc044b05e07914576b6c`의 `mcp/ops_mcp.py`에서 AST 데이터만 추출했다. `TASK_HOST`와 리터럴, 정확한 `sorted(TASK_HOST)` 표현식만 해석하고 원본 모듈·핸들러를 import/exec하지 않는다. 소스 경로·로컬 HEAD·파일 SHA256·정규화 메타데이터 SHA256는 `ops-fixture-tools-schema.json`에 있다. 추출 후 이 저장소의 bare mirror에서 `354c4b0:mcp/ops_mcp.py`를 대조했고, 파일 SHA256 `32715589f199f77a3d2d1930b09896a89a38f1fcda57816702b952560427e7f3`이 같음을 확인했다([후속 검증](offline-fixed-boundary-result.json)). 실제 배포 프로세스의 상태를 확인한 것은 아니다.

인프라가 격리 모델 시험을 실행할 때 `ELDA_OPS_MCP`를 이 파일의 절대 경로로 지정하면 현재 `ops` 프로필의 도구를 유지하면서 실제 조회를 막을 수 있다. digest가 이미 제외하는 Comms/Notion 경로는 그대로 유지한다. 고정 합성 본문을 `summarize()`에 전달하는 별도 시험에서 사용한다. **이 설정만으로 운영 `digest.py main()`의 Comms 수집·읽음 표시가 막히지는 않는다. 운영 main/Task를 실행하면 안 된다.**

```bash
# 아래 변수 지정은 이 셸의 격리 시험용이다. 여기서는 실제 모델을 실행하지 않았다.
export ELDA_OPS_MCP=/home/gino/WorkArea/clova-api-lab/runtime/clova/ops-task/inbox-digest/ops-fixture-mcp.py

# 로컬 fixture 프로세스만 띄우는 무료 stdio 확인
python3 -B runtime/clova/ops-task/inbox-digest/ops-fixture-stdio-test.py
```

stdio 확인은 initialize·notification·tools/list·resources/templates/list·resources/list·ping, 다섯 도구의 거부, resource 읽기 거부와 stderr 인자 기록을 검증한다. 결과는 `ops-fixture-stdio-result.json`이다. 모델의 도구 호출 시도는 관측할 수 있지만 성공한 실제 도구 결과 후의 행동을 재현하는 fixture는 아니다. 모델 호출은 이번 작업에서 0회이며 기존 오프라인 오류 재현 결과는 수정하지 않았다.
