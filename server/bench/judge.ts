import { spawn } from 'node:child_process';

const CLAUDE_BIN = () => process.env.CLAUDE_BIN ?? 'claude';

export type JudgeInput = {
  label: string;
  system?: string;
  user: string;
  output: string;
  finishReason?: string;
};

function buildPrompt(j: JudgeInput): string {
  return `당신은 한국어 LLM 출력 품질 평가자다. 아래 "프롬프트 1건과 그에 대한 모델 출력"을 평가하라.

[항목] ${j.label}
[system 지시] ${j.system ?? '(없음)'}
[user 프롬프트] ${j.user}
[finishReason] ${j.finishReason ?? '?'}
[모델 출력]
"""
${j.output || '(빈 응답)'}
"""

한국어 마크다운으로 근거를 인용하며 상세히 평가하라. 먼저 아래 섹션들을 작성하며 충분히 추론한 뒤, **맨 마지막 줄에서** 최종 판정을 내려라(중간에 "판정"을 먼저 쓰지 말 것). 각 섹션은 \`##\` 제목으로 구분하고 사이에 빈 줄을 넣어라:

## 종합
한 줄 평

## 강점
- (콘텐츠 정확도/자연스러움 등, 구체 근거)

## 약점
- (지시 준수: 길이·포맷·제약, 할루시네이션, 사실/논리 오류 등, 구체 근거)

## 지시 준수
요청한 길이/형식/제약을 지켰는지 명시 판정. 길이("두 문장"/"한 문장"/"한 단어")·형식("코드블록 없이"/"순수 JSON"/"결과만")을 어겼으면 구체적으로 지적.

## 점수
- 정확도: N/5
- 지시준수: N/5
- 간결성: N/5

판정 기준(엄격):
- PASS: 내용이 정확하고(사실 오류·할루시네이션 없음) **요청한 길이·형식·제약 지시를 모두** 지킨 경우에만.
- FAIL: 사실/논리 오류·할루시네이션이 있거나, 길이·형식·제약 지시를 **하나라도** 어긴 경우(예: "두 문장" 요청에 3문장 이상, "한 문장"에 여러 문단, "코드블록 없이"인데 \`\`\` 사용).

마지막으로, 다른 텍스트 없이 맨 끝 줄에 정확히 한 줄만 출력하라:
최종판정: PASS  또는  최종판정: FAIL`;
}

// hellcat의 인증된 claude CLI(-p print 모드)에 stdin으로 프롬프트를 넣어 평가 텍스트를 받는다.
function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN(), ['-p'], {
      env: { ...process.env, HOME: process.env.HOME ?? '/home/gino' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve('(평가 타임아웃)');
    }, 90_000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve(`(claude 실행 오류: ${e.message})`);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.trim() ? out.trim() : `(평가 실패: ${err.trim() || `exit ${code}`})`);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function judgeOutput(input: JudgeInput): Promise<string> {
  return runClaude(buildPrompt(input));
}
