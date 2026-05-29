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

다음을 한국어 마크다운으로 매우 상세히, 근거를 인용하며 작성하라. 각 섹션은 반드시 \`##\` 제목으로 구분하고 섹션 사이에 빈 줄을 넣어라. 군더더기·서론 없이 아래 형식 그대로:

## 종합
한 줄 평

## 강점
- (콘텐츠 정확도/자연스러움 등, 구체 근거)

## 약점
- (지시 준수: 길이·포맷·제약, 할루시네이션, 사실/논리 오류 등, 구체 근거)

## 지시 준수
요청한 길이/형식/제약을 지켰는지 명시 판정

## 점수
- 정확도: N/5
- 지시준수: N/5
- 간결성: N/5`;
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
