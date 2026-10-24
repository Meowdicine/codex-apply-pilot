import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as readiness from '../scripts/lib/readiness.mjs';
import { flattenQuestions, loadQuestionnaire, missingRequiredAnswers, parseAnswer, upsertAnswer } from '../scripts/lib/questionnaire.mjs';
import { createApplication } from '../scripts/lib/state.mjs';
import { buildCandidateAnswerSnapshot, sha256Buffer } from '../scripts/lib/candidate-integrity.mjs';
import { initializeState, readJson, saveApplication, writeJsonAtomic } from '../scripts/lib/storage.mjs';
import { appendJsonLine } from '../scripts/lib/storage.mjs';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../scripts/apply-pilot.mjs', import.meta.url));
const catalog = await loadQuestionnaire(new URL('../config/questionnaire.zh-CN.json', import.meta.url));
const policy = await readJson(new URL('../config/default-policy.json', import.meta.url));
const now = () => new Date().toISOString();
const offset = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

function valueFor(question) {
  if (question.id === 'automation.full-auto-opt-in') return 'yes';
  if (question.id === 'contact.phone') return '+15555550123';
  if (question.allowedValues) return question.valueType === 'enum-list' ? [question.allowedValues[0]] : question.allowedValues[0];
  switch (question.valueType) {
    case 'email': return 'candidate@example.test';
    case 'url': return 'https://example.test/profile';
    case 'date': return '2030-01-01';
    case 'date-month': return '2030-01';
    case 'integer': case 'number': return question.validation?.minimum ?? 0;
    case 'number-list': return [4];
    case 'string-list': return ['example'];
    case 'key-value-list': return { CA: 'verified-status' };
    default: return `verified-${question.id}`;
  }
}

function readyInputs() {
  const answers = { schemaVersion: 1, answers: [] };
  for (const question of flattenQuestions(catalog)) {
    if (question.requiredFor?.includes('full-auto')) upsertAnswer(answers, question, valueFor(question), { explicit: true });
  }
  return {
    policy, catalog, answers,
    consent: {
      fullAutoConsent: { active: true, allowedDomains: ['jobs.example.test'], dailySubmitCap: 5,
        validFrom: offset(-1), expiresAt: offset(1), revokedAt: null },
      capabilities: { osCredentialStoreReady: true, browserSmokeTestPassed: true,
        exactlyOnceRecoveryTestPassed: true, dryRunsPassed: 2 }
    },
    resumeCatalog: { baselines: ['a', 'b', 'c'].map((letter, index) => ({
      id: `demo-baseline-${index}`, family: `demo-family-${index}`, immutable: true,
      artifactSha256: letter.repeat(64), approvedAt: offset(-1)
    })) },
    applicationIndex: { applications: [0, 1, 2].map((index) => ({
      applicationId: `DEMO-VERIFIED-${index}`, mode: 'semi-auto', state: 'submitted-verified',
      portalFamily: index === 2 ? 'lever' : 'greenhouse'
    })) }
  };
}

test('malformed or non-boolean consent cannot satisfy readiness or domain authority', () => {
  for (const change of [{ expiresAt: 'invalid' }, { validFrom: 'invalid' }, { active: 'true' },
    { dailySubmitCap: 0 }, { dailySubmitCap: 1.5 }, { allowedDomains: ['https://jobs.example.test'] }]) {
    const inputs = readyInputs();
    Object.assign(inputs.consent.fullAutoConsent, change);
    assert.equal(readiness.evaluateFullAutoReadiness(inputs).ready, false, JSON.stringify(change));
    assert.throws(() => readiness.assertDomainAllowed(inputs.consent, 'https://jobs.example.test/demo'));
  }
});

test('bare allowlist hosts do not silently authorize subdomains or non-HTTPS URLs', () => {
  const { consent } = readyInputs();
  assert.throws(() => readiness.assertDomainAllowed(consent, 'https://ca.jobs.example.test/demo'));
  assert.throws(() => readiness.assertDomainAllowed(consent, 'http://jobs.example.test/demo'));
  consent.fullAutoConsent.allowedDomains = ['example.test'];
  assert.throws(() => readiness.assertDomainAllowed(consent, 'https://user:demo@example.test/demo'));
});

test('duplicate maturity records and account-unknown states do not unlock full-auto', () => {
  const inputs = readyInputs();
  inputs.applicationIndex.applications = Array(3).fill(inputs.applicationIndex.applications[0]);
  assert.equal(readiness.evaluateFullAutoReadiness(inputs).ready, false);
  const accountUnknown = readyInputs();
  accountUnknown.applicationIndex.applications.push({ applicationId: 'DEMO-UNKNOWN', state: 'unknown-account-state-no-repeat' });
  assert.equal(readiness.evaluateFullAutoReadiness(accountUnknown).ready, false);
  const duplicateBaseline = readyInputs();
  duplicateBaseline.resumeCatalog.baselines = duplicateBaseline.resumeCatalog.baselines.map((entry) => ({ ...entry, artifactSha256: 'a'.repeat(64) }));
  assert.equal(readiness.evaluateFullAutoReadiness(duplicateBaseline).ready, false);
});

test('answer readiness rejects invalid dates, types, and missing verification metadata', () => {
  const question = flattenQuestions(catalog).find((entry) => entry.id === 'contact.email');
  const document = { schemaVersion: 1, answers: [] };
  const answer = upsertAnswer(document, question, 'candidate@example.test');
  for (const change of [{ expiresAt: 'invalid' }, { verifiedAt: 'invalid' }, { verifiedAt: offset(3) },
    { value: 42 }, { value: 'not-an-email' }, { value: {} }, { questionRevision: 0 }, { answerScope: 'search' }]) {
    const changed = { ...answer, ...change };
    assert.ok(missingRequiredAnswers(catalog, { answers: [changed] }, 'full-auto').some((entry) => entry.id === question.id), JSON.stringify(change));
  }
  assert.throws(() => upsertAnswer(document, question, 42));
  assert.throws(() => upsertAnswer(document, question, 'not-an-email'));
  assert.throws(() => upsertAnswer(document, question, null));
  assert.throws(() => upsertAnswer(document, question, 'candidate@example.test', { expiresAt: 'invalid' }));
  assert.throws(() => parseAnswer({ id: 'demo.numbers', valueType: 'number-list' }, '4,'));
});

test('daily submit capacity deduplicates durable intents and fails closed on incomplete history', () => {
  assert.equal(typeof readiness.assertDailySubmitCapacity, 'function');
  const { consent } = readyInputs();
  consent.fullAutoConsent.dailySubmitCap = 2;
  const intent = { applicationId: 'DEMO-ATTEMPT-1', eventType: 'SUBMIT_INTENT', createdAt: now() };
  const applicationIndex = { applications: [{ applicationId: intent.applicationId, submitAttemptCount: 1 }] };
  const result = readiness.assertDailySubmitCapacity({ consent, applicationIndex, receipts: [intent, intent] });
  assert.equal(result.used, 1);
  assert.equal(result.remaining, 1);
  const second = { ...intent, applicationId: 'DEMO-ATTEMPT-2' };
  assert.throws(() => readiness.assertDailySubmitCapacity({ consent, applicationIndex, receipts: [intent, second] }), /dailySubmitCap/);
  assert.throws(() => readiness.assertDailySubmitCapacity({ consent, applicationIndex, receipts: [] }), /history|时间|历史/);
  assert.throws(() => readiness.assertDailySubmitCapacity({ consent, applicationIndex: { applications: [] }, receipts: [{ ...intent, createdAt: 'invalid' }] }), /history|时间|历史/);
  const previousDay = '2026-01-14T23:59:59.000Z';
  consent.fullAutoConsent.validFrom = previousDay;
  consent.fullAutoConsent.expiresAt = '2026-01-16T00:00:00.000Z';
  assert.equal(readiness.assertDailySubmitCapacity({ consent, applicationIndex: { applications: [] },
    receipts: [{ ...intent, createdAt: previousDay }], now: '2026-01-15T00:00:00.000Z' }).used, 0);
});

async function invoke(directory, ...args) {
  try {
    const result = await execute(process.execPath, [cli, ...args, '--state-dir', directory], { timeout: 10000 });
    return { ok: true, ...result, value: JSON.parse(result.stdout) };
  } catch (error) { return { ok: false, stderr: error.stderr }; }
}

async function runtime(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-review-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const inputs = readyInputs();
  const paths = await initializeState(directory, policy);
  await writeJsonAtomic(paths.answers, inputs.answers);
  await writeJsonAtomic(paths.consent, inputs.consent);
  await writeJsonAtomic(paths.resumeCatalog, inputs.resumeCatalog);
  for (const entry of inputs.applicationIndex.applications) {
    const record = createApplication({ company: 'Example History', role: entry.applicationId,
      officialUrl: `https://jobs.example.test/demo/${entry.applicationId}`, employerJobId: entry.applicationId,
      portalFamily: entry.portalFamily });
    Object.assign(record, { state: 'submitted-verified', terminal: true, submitAttemptCount: 1,
      submitIntent: { writtenAt: offset(-25) } });
    await saveApplication(paths, record);
  }
  return { directory, paths, inputs };
}

const candidateArgs = ['new-application', '--company', 'Example Review', '--role', 'Platform Intern',
  '--official-url', 'https://jobs.example.test/demo/review', '--job-id', 'DEMO-REVIEW',
  '--portal-family', 'greenhouse', '--mode', 'full-auto'];

test('CLI rechecks revoked consent, live readiness, and capacity without trusting payload booleans', async (t) => {
  const { directory, paths, inputs } = await runtime(t);
  const created = await invoke(directory, ...candidateArgs);
  assert.equal(created.ok, true, created.stderr);
  const id = created.value.applicationId;
  let version = 0;
  async function event(type, payload = {}) {
    const result = await invoke(directory, 'event', '--application', id, '--type', type,
      '--expected-version', String(version), '--payload-json', JSON.stringify(payload));
    if (result.ok) version = result.value.stateVersion;
    return result;
  }
  assert.equal((await event('SOURCE_VERIFIED', { officialUrl: 'https://jobs.example.test/demo/review' })).ok, true);
  inputs.consent.fullAutoConsent.revokedAt = now();
  await writeJsonAtomic(paths.consent, inputs.consent);
  assert.equal((await event('ELIGIBILITY_PASSED', { verified: true, fullAutoReadinessPassed: true })).ok, false);
  assert.equal((await readJson(path.join(paths.applicationsDir, `${id}.json`))).stateVersion, version);
  inputs.consent.fullAutoConsent.revokedAt = null;
  await writeJsonAtomic(paths.consent, inputs.consent);
  assert.equal((await event('ELIGIBILITY_PASSED', { verified: true })).ok, true);
  assert.equal((await event('RESUME_STARTED')).ok, true);
  inputs.consent.capabilities.browserSmokeTestPassed = false;
  await writeJsonAtomic(paths.consent, inputs.consent);
  assert.equal((await event('RESUME_READY', { resumeVersionSha: 'a'.repeat(64), fullAutoReadinessPassed: true })).ok, false);
  inputs.consent.capabilities.browserSmokeTestPassed = true;
  await writeJsonAtomic(paths.consent, inputs.consent);
  assert.equal((await event('RESUME_READY', { resumeVersionSha: 'a'.repeat(64), fullAutoReadinessPassed: false })).ok, true);
  assert.equal((await event('ACCOUNT_READY')).ok, true);
  inputs.consent.fullAutoConsent.dailySubmitCap = 1;
  await writeJsonAtomic(paths.consent, inputs.consent);
  await appendJsonLine(paths.receiptLedger, { applicationId: 'DEMO-ORPHAN-ATTEMPT', eventType: 'SUBMIT_INTENT', createdAt: now() });
  const blocked = await event('FORM_STAGED', { formSnapshotSha: 'b'.repeat(64) });
  assert.equal(blocked.ok, false);
  assert.match(blocked.stderr, /dailySubmitCap/);
  inputs.consent.fullAutoConsent.revokedAt = now();
  await writeJsonAtomic(paths.consent, inputs.consent);
  const snapshot = await invoke(directory, 'snapshot-answers', '--application', id, '--questions-file', 'not-read.json');
  assert.equal(snapshot.ok, false);
  assert.match(snapshot.stderr, /全自动|consent/);
  assert.equal((await event('SECURITY_HARD_STOP')).ok, true);
});

test('new portal families cannot inherit full-auto authority', async (t) => {
  const { directory, paths } = await runtime(t);
  await writeJsonAtomic(paths.applicationsIndex, { schemaVersion: 1, applications: [] });
  const result = await invoke(directory, ...candidateArgs, '--portal-family', 'new-portal');
  assert.equal(result.ok, false);
  assert.match(result.stderr, /portal|半自动/);
});

test('full-auto readiness cannot ignore a Hard Stop missing from the index', async (t) => {
  const { directory, paths } = await runtime(t);
  const originalIndex = await readJson(paths.applicationsIndex);
  const stopped = createApplication({ company: 'Example Stop', role: 'Demo blocked role',
    officialUrl: 'https://jobs.example.test/demo/stopped' });
  stopped.state = 'unknown-account-state-no-repeat';
  stopped.terminal = true;
  await saveApplication(paths, stopped);
  await writeJsonAtomic(paths.applicationsIndex, originalIndex);
  const result = await invoke(directory, ...candidateArgs);
  assert.equal(result.ok, false);
  assert.match(result.stderr, /unresolved-hard-stops/);
});

test('candidate snapshot checks the current catalog rather than a caller-supplied old revision', () => {
  const question = flattenQuestions(catalog).find((entry) => entry.id === 'contact.email');
  const document = { schemaVersion: 1, answers: [] };
  upsertAnswer(document, question, 'candidate@example.test');
  const application = createApplication({ company: 'Example Review', role: 'Demo role',
    officialUrl: 'https://jobs.example.test/demo/snapshot' });
  assert.throws(() => buildCandidateAnswerSnapshot({ application, answerDocument: document,
    catalog: { groups: [{ questions: [{ ...question, revision: (question.revision || 1) + 1 }] }] },
    questionSet: { reviewedBy: 'user', reviewedAt: now(), questions: [{
      prompt: 'Demo email?', semanticKey: 'contact.email', decision: 'use-stored-answer',
      answerQuestionId: question.id, answerQuestionRevision: question.revision || 1
    }] }
  }), /catalog/);
});

test('full-auto CLI locks actual bytes, rechecks final consent and consumes one intent only', async (t) => {
  const { directory, paths, inputs } = await runtime(t);
  inputs.consent.fullAutoConsent.dailySubmitCap = 1;
  await writeJsonAtomic(paths.consent, inputs.consent);
  const created = await invoke(directory, ...candidateArgs);
  assert.equal(created.ok, true, created.stderr);
  const id = created.value.applicationId;
  let version = 0;
  async function event(type, payload = {}) {
    const result = await invoke(directory, 'event', '--application', id, '--type', type,
      '--expected-version', String(version), '--payload-json', JSON.stringify(payload));
    if (result.ok) version = result.value.stateVersion;
    return result;
  }
  async function advance(type, payload) {
    const result = await event(type, payload);
    assert.equal(result.ok, true, result.stderr);
    return result;
  }
  const resumeBytes = Buffer.from('Synthetic full-auto candidate resume');
  const formBytes = Buffer.from('{"demo":true}');
  const resumeSha = sha256Buffer(resumeBytes);
  const formSha = sha256Buffer(formBytes);
  await writeFile(path.join(directory, 'resume.pdf'), resumeBytes);
  await writeFile(path.join(directory, 'form.json'), formBytes);
  await advance('SOURCE_VERIFIED', { officialUrl: 'https://jobs.example.test/demo/review' });
  await advance('ELIGIBILITY_PASSED', { verified: true });
  await advance('RESUME_STARTED');
  await advance('RESUME_READY', { resumeVersionSha: resumeSha });
  await advance('ACCOUNT_READY');
  const questionsFile = path.join(directory, 'questions.json');
  await writeJsonAtomic(questionsFile, { reviewedBy: 'user', reviewedAt: now(), questions: [{
    prompt: 'Which demo area interests you?', semanticKey: 'demo.area', decision: 'candidate-confirmed', value: 'platform'
  }] });
  const snapshot = await invoke(directory, 'snapshot-answers', '--application', id, '--questions-file', questionsFile);
  assert.equal(snapshot.ok, true, snapshot.stderr);
  version = snapshot.value.stateVersion;
  const artifactsFile = path.join(directory, 'artifacts.json');
  await writeJsonAtomic(artifactsFile, { artifacts: [
    { kind: 'resume', logicalName: 'resume.pdf', file: './resume.pdf', sourceType: 'candidate-generated', sourceArtifactSha256: 'a'.repeat(64) },
    { kind: 'form-snapshot', logicalName: 'form.json', file: './form.json', sourceType: 'portal-form' }
  ] });
  const locked = await invoke(directory, 'lock-artifacts', '--application', id, '--artifacts-file', artifactsFile);
  assert.equal(locked.ok, true, locked.stderr);
  version = locked.value.stateVersion;
  await advance('FORM_STAGED', { formSnapshotSha: formSha });
  const payload = { candidateId: created.value.candidateId, resumeVersionSha: resumeSha, formSnapshotSha: formSha };
  const originalExpiry = inputs.consent.fullAutoConsent.expiresAt;
  inputs.consent.fullAutoConsent.expiresAt = offset(-1);
  await writeJsonAtomic(paths.consent, inputs.consent);
  assert.equal((await event('SUBMIT_INTENT', payload)).ok, false);
  assert.equal((await readJson(path.join(paths.applicationsDir, `${id}.json`))).submitAttemptCount, 0);
  inputs.consent.fullAutoConsent.expiresAt = originalExpiry;
  await writeJsonAtomic(paths.consent, inputs.consent);
  await advance('SUBMIT_INTENT', payload);
  assert.equal((await event('SUBMIT_INTENT', payload)).ok, false);
  inputs.consent.fullAutoConsent.revokedAt = now();
  await writeJsonAtomic(paths.consent, inputs.consent);
  await advance('SUBMIT_UNKNOWN');
  const final = await readJson(path.join(paths.applicationsDir, `${id}.json`));
  assert.equal(final.submitAttemptCount, 1);
  assert.equal(final.state, 'unknown-submit-state-no-repeat');
});
