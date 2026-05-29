import type { Pool } from 'mysql2/promise';

// mysql2는 런타임 동적 import(아래 initDb)로 로드한다. 정적 import면 모듈 미설치
// 호스트에서 서버 자체가 안 뜨므로, "DB는 선택사항" 보장을 위해 동적 로드한다.
let pool: Pool | null = null;

const baseCfg = () => ({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
});

const DB_NAME = () => process.env.DB_NAME ?? 'clova_lab';

export function getPool(): Pool | null {
  return pool;
}

// DB는 선택사항이다. 미설정/접속실패여도 프록시(채팅/스트리밍)는 계속 동작한다.
export async function initDb(): Promise<boolean> {
  if (!process.env.DB_HOST) {
    console.log('[db] DB_HOST 미설정 — 벤치 영속화 비활성');
    return false;
  }
  try {
    const mysql = await import('mysql2/promise');

    // 1) DB 생성 시도(idempotent). 전역 CREATE 권한이 없으면(=관리자가 clova_lab을
    //    미리 만들고 해당 DB만 GRANT한 경우) 실패해도 무시하고 2)에서 직접 접속한다.
    try {
      const admin = await mysql.createConnection(baseCfg());
      await admin.query(
        `CREATE DATABASE IF NOT EXISTS \`${DB_NAME()}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      await admin.end();
    } catch (e) {
      console.warn('[db] CREATE DATABASE 생략(권한 없음 추정):', e instanceof Error ? e.message : e);
    }

    // 2) 풀 생성 + 테이블 마이그레이션
    pool = mysql.createPool({
      ...baseCfg(),
      database: DB_NAME(),
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
    });
    await migrate(pool);
    console.log(`[db] connected ${baseCfg().host}:${baseCfg().port}/${DB_NAME()}`);
    return true;
  } catch (err) {
    console.error('[db] init 실패 — 벤치 영속화 비활성:', err instanceof Error ? err.message : err);
    pool = null;
    return false;
  }
}

async function addColumnIfMissing(p: Pool, table: string, colDef: string): Promise<void> {
  try {
    await p.query(`ALTER TABLE \`${table}\` ADD COLUMN ${colDef}`);
  } catch (e) {
    if ((e as { code?: string })?.code !== 'ER_DUP_FIELDNAME') throw e;
  }
}

async function migrate(p: Pool): Promise<void> {
  await p.query(`CREATE TABLE IF NOT EXISTS bench_run (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL,
    provider VARCHAR(32),
    model VARCHAR(64),
    temperature DECIMAL(3,2),
    top_p DECIMAL(3,2),
    repeats INT,
    prompt_count INT,
    total_calls INT,
    errors INT,
    truncated INT,
    latency_p50 INT,
    latency_p95 INT,
    avg_tok_s DECIMAL(7,1),
    total_completion_tokens INT,
    pass_count INT,
    checked_count INT,
    pass_rate DECIMAL(5,4),
    status VARCHAR(16) NOT NULL DEFAULT 'running',
    note TEXT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  await p.query(`CREATE TABLE IF NOT EXISTS bench_result (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT NOT NULL,
    prompt_id VARCHAR(64),
    label VARCHAR(128),
    category VARCHAR(64),
    round INT,
    system_prompt TEXT NULL,
    user_prompt MEDIUMTEXT NULL,
    ok TINYINT(1),
    latency_ms INT,
    prompt_tokens INT,
    completion_tokens INT,
    tokens_per_sec DECIMAL(7,1),
    finish_reason VARCHAR(32),
    truncated TINYINT(1),
    check_kind VARCHAR(32),
    check_pass TINYINT(1) NULL,
    content MEDIUMTEXT,
    error VARCHAR(255),
    INDEX idx_result_run (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // 기존 테이블 보강(이미 있으면 ER_DUP_FIELDNAME 무시)
  await addColumnIfMissing(p, 'bench_result', 'system_prompt TEXT NULL');
  await addColumnIfMissing(p, 'bench_result', 'user_prompt MEDIUMTEXT NULL');

  await p.query(`CREATE TABLE IF NOT EXISTS bench_evaluation (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    run_id BIGINT NOT NULL,
    result_id BIGINT,
    prompt_id VARCHAR(64),
    category VARCHAR(64),
    judge VARCHAR(32),
    judge_model VARCHAR(64),
    evaluation MEDIUMTEXT,
    created_at DATETIME NOT NULL,
    INDEX idx_eval_run (run_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}
