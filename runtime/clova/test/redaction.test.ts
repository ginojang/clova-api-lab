import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clean, redact, secretFile } from '../common.ts';

test('natural basic prose remains exact through redaction and saved-plan cleaning', () => {
  const sentence = 'Help the user practise a basic cord-knot before the workshop.';
  for (const value of [sentence, 'Basic preparation matters.', 'A BASIC understanding helps.', 'basic coordination', 'basic cord-knot']) {
    assert.equal(redact(value), value);
  }
  const plan = { subject: sentence, rubric: { eventMeaning: 'Distinguish a basic cord-knot practice session from the later workshop.' } };
  assert.deepEqual(clean(plan), plan);
});

test('bare Basic credentials are masked with padding, Unicode, empty fields and mixed case', () => {
  for (const userPass of ['user:password', 'user:password:with:colons', ':password', 'user:', ':', '사용자:비밀번호', 'ÿ:ÿ']) {
    const token = Buffer.from(userPass).toString('base64');
    for (const encoded of [token, token.replace(/=+$/, '')]) {
      assert.equal(redact(`Basic ${encoded}`), 'Authorization ***');
      assert.equal(redact(`bAsIc\t${encoded}`), 'Authorization ***');
      assert.equal(redact(`value="Basic ${encoded}"; next`), 'value="Authorization ***"; next');
      assert.equal(redact(`**Basic ${encoded}**`), '**Authorization *****');
      const nested = JSON.stringify(JSON.stringify({ request: `Basic ${encoded}` }));
      assert.equal(redact(nested), JSON.stringify(JSON.stringify({ request: 'Authorization ***' })));
    }
  }
});

test('explicit Authorization headers hide even malformed Basic credentials and preserve surrounding text', () => {
  for (const scheme of ['Basic', 'basic', 'Bearer']) {
    for (const credential of ['dXNlcjpwYXNz', 'not-base64!_opaque', 'name:password']) {
      assert.equal(redact(`Authorization: ${scheme} ${credential}\r\nNext: visible`), 'Authorization: ***\r\nNext: visible');
      assert.equal(redact(`Proxy-Authorization: ${scheme} ${credential}`), 'Proxy-Authorization: ***');
      assert.equal(redact(`{"authorization":"${scheme} ${credential}","note":"basic cord-knot"}`), '{"authorization":"***","note":"basic cord-knot"}');
      assert.equal(redact(`curl -H 'Authorization: ${scheme} ${credential}'`), "curl -H 'Authorization: ***'");
      assert.equal(redact(`AUTHORIZATION = "${scheme} ${credential}"`), 'AUTHORIZATION = "***"');
    }
  }
});

test('Bearer credential masking remains case-insensitive outside headers', () => {
  for (const value of ['Bearer opaque-test-credential', 'bearer abc.def.ghi', 'BEARER fake+/credential==']) {
    assert.equal(redact(value), 'Authorization ***');
  }
});

test('registered secrets and other existing credential patterns still redact', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const dir = mkdtempSync(join(root, '.redaction-test-'));
  try {
    const value = 'unique-redaction-fixture-private-value';
    const path = join(dir, 'key');
    writeFileSync(path, value, { mode: 0o600 });
    secretFile(path);
    assert.equal(redact(`before ${value} after`), 'before *** after');
    assert.equal(redact(`Basic ${value}`), 'Basic ***');
    assert.equal(redact(`Authorization: Basic ${value}`), 'Authorization: ***');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(redact('sk-fixture-key ghp_fixturetoken'), '*** ***');
  assert.equal(redact('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.fake_signature'), '***');
  assert.equal(redact('password=fixture-value; token=other-value'), 'password=***; token=***');
  assert.equal(redact('https://user:fixture-password@example.test/path'), 'https://user:***@example.test/path');
});

test('structured credential fields remain masked without losing counters or pass results', () => {
  assert.deepEqual(clean({ headers: { Authorization: 'Basic malformed-value', 'Proxy-Authorization': 'Bearer value' }, password: 'value', api_key: 'value', pass: true, bypass: false, completionTokens: 20 }), {
    headers: { Authorization: '***', 'Proxy-Authorization': '***' }, password: '***', api_key: '***', pass: true, bypass: false, completionTokens: 20,
  });
});
