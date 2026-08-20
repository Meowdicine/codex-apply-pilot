import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { assertDomainAllowed } from '../scripts/lib/readiness.mjs';
import {
  initializeState,
  readJson,
  statePaths,
  writeJsonAtomic
} from '../scripts/lib/storage.mjs';

function activeConsent(allowedDomains = ['example.test']) {
  return {
    fullAutoConsent: {
      active: true,
      allowedDomains,
      validFrom: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      revokedAt: null
    }
  };
}

test('domain allowlist accepts exact hosts and subdomains but rejects lookalikes', () => {
  const consent = activeConsent(['jobs.example.test']);
  assert.doesNotThrow(() => assertDomainAllowed(consent, 'https://jobs.example.test/opening/1'));
  assert.doesNotThrow(() => assertDomainAllowed(consent, 'https://ca.jobs.example.test/opening/1'));
  assert.throws(
    () => assertDomainAllowed(consent, 'https://jobs.example.test.evil.invalid/opening/1'),
    /不在 full-auto allowlist/
  );
});

test('wildcard allowlist notation supports the apex and a true subdomain', () => {
  const consent = activeConsent(['*.example.test']);
  assert.doesNotThrow(() => assertDomainAllowed(consent, 'https://example.test/jobs/1'));
  assert.doesNotThrow(() => assertDomainAllowed(consent, 'https://careers.example.test/jobs/1'));
});

test('expired and revoked consent fail closed before domain matching', () => {
  const expired = activeConsent();
  expired.fullAutoConsent.expiresAt = new Date(Date.now() - 1_000).toISOString();
  assert.throws(() => assertDomainAllowed(expired, 'https://example.test/jobs/1'), /未激活或已过期/);

  const revoked = activeConsent();
  revoked.fullAutoConsent.revokedAt = new Date().toISOString();
  assert.throws(() => assertDomainAllowed(revoked, 'https://example.test/jobs/1'), /未激活或已过期/);
});

test('atomic JSON write leaves one complete document under concurrent writers', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-atomic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'state.json');
  const left = { writer: 'left', payload: 'a'.repeat(50_000) };
  const right = { writer: 'right', payload: 'b'.repeat(50_000) };

  await Promise.all([writeJsonAtomic(target, left), writeJsonAtomic(target, right)]);
  const actual = await readJson(target);
  assert.ok(['left', 'right'].includes(actual.writer));
  assert.equal(actual.payload, actual.writer === 'left' ? left.payload : right.payload);
  assert.deepEqual((await readdir(directory)).filter((name) => name.endsWith('.tmp')), []);
});

test('failed serialization preserves the previously committed JSON', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-preserve-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'state.json');
  await writeJsonAtomic(target, { stable: true });

  await assert.rejects(() => writeJsonAtomic(target, { invalid: 1n }), /BigInt/);
  assert.deepEqual(await readJson(target), { stable: true });
});

test('state initialization is idempotent and does not overwrite user data', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const defaultPolicy = {
    fullAuto: { defaultDailySubmitCap: 5 }
  };
  const paths = await initializeState(directory, defaultPolicy);
  const answers = { schemaVersion: 1, answers: [{ questionId: 'example', value: 'kept' }] };
  await writeJsonAtomic(paths.answers, answers);

  await initializeState(directory, defaultPolicy);
  assert.deepEqual(await readJson(paths.answers), answers);
  assert.equal(statePaths(directory).root, path.resolve(directory));
  assert.match(await readFile(paths.policy, 'utf8'), /defaultDailySubmitCap/);
});
