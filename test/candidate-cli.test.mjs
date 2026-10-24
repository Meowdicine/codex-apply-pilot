import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { sha256Buffer } from '../scripts/lib/candidate-integrity.mjs';
import { contentAddressedJsonPath, readJson, statePaths, withStateLock } from '../scripts/lib/storage.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/apply-pilot.mjs', import.meta.url));

async function invoke(directory, ...args) {
  try {
    const result = await execute(process.execPath, [cli, ...args, '--state-dir', directory], { timeout: 10000 });
    return { ok: true, ...result, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.equal((await invoke(directory, 'init')).ok, true);
  return directory;
}

const newCandidate = [
  'new-application', '--company', 'Example Labs', '--role', 'Platform Intern',
  '--official-url', 'https://jobs.example.test/demo/REQ-001', '--job-id', 'DEMO-REQ-001'
];

test('two CLI writers cannot create the same candidate twice', async (t) => {
  const directory = await fixture(t);
  const results = await Promise.all([
    invoke(directory, ...newCandidate),
    invoke(directory, ...newCandidate)
  ]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal((await readJson(statePaths(directory).applicationsIndex)).applications.length, 1);
});

test('CLI refuses an existing writer lock without stealing it', async (t) => {
  const directory = await fixture(t);
  await withStateLock(directory, async () => {
    const result = await invoke(directory, ...newCandidate);
    assert.equal(result.ok, false);
    assert.match(result.stderr, /writer lock/);
    assert.ok(await readFile(path.join(directory, '.writer.lock'), 'utf8'));
  });
});

test('CLI locks real artifacts, rejects tampering, and preserves no-repeat after submit intent', async (t) => {
  const directory = await fixture(t);
  const created = await invoke(directory, ...newCandidate);
  assert.equal(created.ok, true, created.stderr);
  const applicationId = created.value.applicationId;
  let version = 0;
  async function event(type, payload = {}) {
    const result = await invoke(directory, 'event', '--application', applicationId,
      '--type', type, '--expected-version', String(version), '--payload-json', JSON.stringify(payload));
    assert.equal(result.ok, true, result.stderr);
    version = result.value.stateVersion;
    return result.value;
  }
  const resumeBytes = Buffer.from('Synthetic approved candidate resume');
  const formBytes = Buffer.from('{"example":true}');
  const resumeSha = sha256Buffer(resumeBytes);
  const formSha = sha256Buffer(formBytes);
  await writeFile(path.join(directory, 'resume.pdf'), resumeBytes);
  await writeFile(path.join(directory, 'form.json'), formBytes);
  await event('SOURCE_VERIFIED', { officialUrl: 'https://jobs.example.test/demo/REQ-001' });
  await event('ELIGIBILITY_PASSED', { verified: true });
  await event('RESUME_STARTED');
  await event('RESUME_READY', { resumeVersionSha: resumeSha });
  await event('RESUME_APPROVED', { candidateId: created.value.candidateId, resumeVersionSha: resumeSha });
  await event('ACCOUNT_READY', { userConfirmed: true });

  const rawLock = await invoke(directory, 'event', '--application', applicationId,
    '--type', 'ANSWER_SNAPSHOT_LOCKED', '--expected-version', String(version));
  assert.equal(rawLock.ok, false);
  assert.match(rawLock.stderr, /snapshot-answers/);

  const questionsFile = path.join(directory, 'questions.json');
  await writeFile(questionsFile, JSON.stringify({
    reviewedBy: 'user', reviewedAt: new Date().toISOString(),
    questions: [{ prompt: 'Which technical area interests you?', semanticKey: 'preferences.area',
      decision: 'candidate-confirmed', value: 'platform' }]
  }));
  const snapshot = await invoke(directory, 'snapshot-answers', '--application', applicationId,
    '--questions-file', questionsFile);
  assert.equal(snapshot.ok, true, snapshot.stderr);
  version = snapshot.value.stateVersion;

  const artifactsFile = path.join(directory, 'artifacts.json');
  await writeFile(artifactsFile, JSON.stringify({ artifacts: [
    { kind: 'resume', logicalName: 'resume.pdf', file: './resume.pdf', sourceType: 'candidate-generated',
      sourceId: 'demo-baseline', sourceArtifactSha256: 'a'.repeat(64) },
    { kind: 'form-snapshot', logicalName: 'form.json', file: './form.json', sourceType: 'portal-form' }
  ] }));
  const lock = await invoke(directory, 'lock-artifacts', '--application', applicationId,
    '--artifacts-file', artifactsFile);
  assert.equal(lock.ok, true, lock.stderr);
  version = lock.value.stateVersion;
  await writeFile(path.join(directory, 'resume.pdf'), 'Changed original after lock');
  assert.deepEqual(await readFile(path.join(directory, 'artifacts', resumeSha)), resumeBytes);
  await event('FORM_STAGED', { formSnapshotSha: formSha });
  const manifest = await invoke(directory, 'manifest', '--application', applicationId);
  assert.equal(manifest.ok, true, manifest.stderr);
  await event('SUBMIT_APPROVED', { manifest: manifest.value });

  const paths = statePaths(directory);
  const snapshotPath = contentAddressedJsonPath(paths.answerSnapshotsDir, applicationId,
    snapshot.value.answerSnapshotSha256);
  const originalSnapshot = await readFile(snapshotPath, 'utf8');
  const tamperedSnapshot = JSON.parse(originalSnapshot);
  tamperedSnapshot.questions[0].prompt = 'Changed question';
  await writeFile(snapshotPath, JSON.stringify(tamperedSnapshot));
  const rejected = await invoke(directory, 'event', '--application', applicationId, '--type', 'SUBMIT_INTENT',
    '--expected-version', String(version), '--payload-json', JSON.stringify({
      candidateId: created.value.candidateId, resumeVersionSha: resumeSha, formSnapshotSha: formSha
    }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.stderr, /snapshot.*hash/);
  await writeFile(snapshotPath, originalSnapshot);

  await event('SUBMIT_INTENT', {
    candidateId: created.value.candidateId, resumeVersionSha: resumeSha, formSnapshotSha: formSha
  });
  const preflight = await invoke(directory, 'preflight', '--application', applicationId);
  assert.equal(preflight.ok, false);
  assert.equal(JSON.parse(preflight.stdout).decision, 'stop-no-repeat');
  await event('SUBMIT_UNKNOWN');
  const repeat = await invoke(directory, ...newCandidate);
  assert.equal(repeat.ok, false);
  assert.match(repeat.stderr, /stop-no-repeat/);
});
