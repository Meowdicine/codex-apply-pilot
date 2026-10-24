import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createApplication } from '../scripts/lib/state.mjs';
import { sha256 } from '../scripts/lib/candidate-integrity.mjs';
import { initializeState, readJson, saveApplication, writeJsonAtomic } from '../scripts/lib/storage.mjs';
import { applyEvent } from './helpers.mjs';

const cli = fileURLToPath(new URL('../scripts/apply-pilot.mjs', import.meta.url));
const execute = promisify(execFile);

async function run(directory, ...args) {
  try {
    const result = await execute(process.execPath, [cli, ...args, '--state-dir', directory], { timeout: 10000 });
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) { return { ok: false, error: error.stderr }; }
}

async function fixture(t, policyOverrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-optimize-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = await initializeState(directory, { mode: 'semi-auto', fullAuto: { defaultDailySubmitCap: 5 } });
  let application = createApplication({
    company: 'Example Labs', role: 'Platform Intern', officialUrl: 'https://jobs.example.test/demo/platform',
    preflight: { safeToProceed: true, reportSha256: 'e'.repeat(64) }
  });
  application = applyEvent(application, 'SOURCE_VERIFIED', { officialUrl: application.officialUrl });
  application = applyEvent(application, 'ELIGIBILITY_PASSED', { verified: true });
  application = applyEvent(application, 'RESUME_STARTED');
  await saveApplication(paths, application);
  const baseline = '# Example Candidate\n\n## Skills\n- Tools: Python\n\n## Projects\n- Built demo scripts.\n';
  const jd = 'Use CI/CD and Kubernetes in coursework projects.';
  const source = '- Built CI/CD pipelines in a coursework project.';
  const now = new Date().toISOString();
  await writeJsonAtomic(paths.resumeCatalog, { baselines: [
    { id: 'demo-source', immutable: true, artifactSha256: sha256(baseline), approvedAt: now }
  ] });
  await writeFile(path.join(directory, 'baseline.md'), baseline);
  await writeFile(path.join(directory, 'jd.txt'), jd);
  await writeFile(path.join(directory, 'evidence.md'), source);
  const plan = {
    schemaVersion: 1, baselineId: 'demo-source', candidateId: application.candidateId,
    officialUrlSha256: sha256(application.officialUrl), jdSha256: sha256(jd),
    policy: { targetScore: 90, minimumScore: 60, ...policyOverrides },
    evidence: [{ id: 'demo-fact', sourceType: 'verified-material', sourceFile: './evidence.md',
      sourceSha256: sha256(source), excerpt: source, supportedKeywords: ['CI/CD'], approvedWording: [source],
      reviewedBy: 'user', reviewedAt: now }],
    edits: [{ id: 'demo-edit', keyword: 'CI/CD', classification: 'direct', evidenceId: 'demo-fact',
      kind: 'project', action: 'replace-text', sectionHeading: '## Projects', before: '- Built demo scripts.',
      after: source, reviewedBy: 'user', reviewedAt: now }]
  };
  await writeJsonAtomic(path.join(directory, 'plan.json'), plan);
  const start = await run(directory, 'resume-optimize-start', '--application', application.applicationId,
    '--baseline-file', path.join(directory, 'baseline.md'), '--jd-file', path.join(directory, 'jd.txt'),
    '--plan-file', path.join(directory, 'plan.json'));
  assert.equal(start.ok, true, start.error);
  return { directory, paths, application, plan, start: start.value, baseline };
}

async function importScore(f, resumeSha256, score, missingKeywords) {
  const scoredText = `%PDF-DEMO\nEditable content digest: ${resumeSha256}`;
  await writeFile(path.join(f.directory, 'scored.pdf'), scoredText);
  const feedback = {
    schemaVersion: 1, provider: 'simplify', metric: 'keyword-match', confirmedBy: 'user',
    candidateId: f.application.candidateId, officialUrlSha256: f.plan.officialUrlSha256,
    jdSha256: f.plan.jdSha256, resumeSha256, observedAt: new Date().toISOString(),
    saveComplete: true, recalculationComplete: true, score, missingKeywords,
    scoredArtifactSha256: sha256(scoredText), sourceTextVerified: true
  };
  await writeJsonAtomic(path.join(f.directory, 'feedback.json'), feedback);
  return run(f.directory, 'resume-optimize-step', '--application', f.application.applicationId,
    '--feedback-file', path.join(f.directory, 'feedback.json'), '--scored-artifact-file', path.join(f.directory, 'scored.pdf'));
}

test('CLI optimizes a frozen candidate copy and binds fresh scoring plus QA to Gate 1', async (t) => {
  const f = await fixture(t);
  const changed = await importScore(f, f.start.currentResumeSha256, 45, ['CI/CD', 'Kubernetes']);
  assert.equal(changed.ok, true, changed.error);
  assert.match(await readFile(changed.value.draftPath, 'utf8'), /CI\/CD pipelines/);
  assert.equal(await readFile(path.join(f.directory, 'baseline.md'), 'utf8'), f.baseline);
  const eventArgs = ['event', '--application', f.application.applicationId, '--type', 'RESUME_READY',
    '--expected-version', String(f.application.stateVersion)];
  const rejected = await run(f.directory, ...eventArgs, '--payload-json', JSON.stringify({ resumeVersionSha: 'f'.repeat(64) }));
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /优化尚未完成/);
  const completed = await importScore(f, changed.value.currentResumeSha256, 94, ['Kubernetes']);
  assert.equal(completed.ok, true, completed.error);
  assert.equal(completed.value.readyForQa, true);
  const noQa = await run(f.directory, ...eventArgs, '--payload-json', JSON.stringify({ resumeVersionSha: 'f'.repeat(64) }));
  assert.equal(noQa.ok, false);
  assert.match(noQa.error, /qaPassed/);
  const wrongExport = await run(f.directory, ...eventArgs, '--payload-json', JSON.stringify({
    resumeVersionSha: 'f'.repeat(64), optimizationSessionSha256: completed.value.sessionSha256,
    optimizedDraftSha256: completed.value.recommendedResumeSha256, qaPassed: true
  }));
  assert.equal(wrongExport.ok, false);
  const ready = await run(f.directory, ...eventArgs, '--payload-json', JSON.stringify({
    resumeVersionSha: completed.value.recommendedArtifactSha256, optimizationSessionSha256: completed.value.sessionSha256,
    optimizedDraftSha256: completed.value.recommendedResumeSha256, qaPassed: true
  }));
  assert.equal(ready.ok, true, ready.error);
  assert.equal(ready.value.state, 'resume-review-required');
  const persisted = await readJson(path.join(f.paths.applicationsDir, `${f.application.applicationId}.json`));
  assert.equal(persisted.resumeOptimization.observedScore, 94);
  assert.equal(persisted.resumeOptimization.baselineSha256, sha256(f.baseline));
  const approved = await run(f.directory, 'event', '--application', f.application.applicationId,
    '--type', 'RESUME_APPROVED', '--expected-version', String(ready.value.stateVersion),
    '--payload-json', JSON.stringify({ candidateId: f.application.candidateId, resumeVersionSha: persisted.resumeVersionSha }));
  assert.equal(approved.ok, true, approved.error);
  const account = await run(f.directory, 'event', '--application', f.application.applicationId,
    '--type', 'ACCOUNT_READY', '--expected-version', String(approved.value.stateVersion), '--payload-json', '{"userConfirmed":true}');
  assert.equal(account.ok, true, account.error);
  await writeJsonAtomic(path.join(f.directory, 'questions.json'), {
    reviewedBy: 'user', reviewedAt: new Date().toISOString(),
    questions: [{ prompt: 'Which technical area interests you?', semanticKey: 'preferences.area',
      decision: 'candidate-confirmed', value: 'platform' }]
  });
  const snapshot = await run(f.directory, 'snapshot-answers', '--application', f.application.applicationId,
    '--questions-file', path.join(f.directory, 'questions.json'));
  assert.equal(snapshot.ok, true, snapshot.error);
  await writeJsonAtomic(path.join(f.directory, 'form.json'), { example: true });
  const artifacts = { artifacts: [
    { kind: 'resume', logicalName: 'resume.pdf', file: './scored.pdf', sourceType: 'candidate-generated', sourceArtifactSha256: 'a'.repeat(64) },
    { kind: 'form-snapshot', logicalName: 'form.json', file: './form.json', sourceType: 'portal-form' }
  ] };
  await writeJsonAtomic(path.join(f.directory, 'artifacts.json'), artifacts);
  const wrongParent = await run(f.directory, 'lock-artifacts', '--application', f.application.applicationId,
    '--artifacts-file', path.join(f.directory, 'artifacts.json'));
  assert.equal(wrongParent.ok, false);
  assert.match(wrongParent.error, /optimized draft/);
  artifacts.artifacts[0].sourceArtifactSha256 = completed.value.recommendedResumeSha256;
  await writeJsonAtomic(path.join(f.directory, 'artifacts.json'), artifacts);
  const locked = await run(f.directory, 'lock-artifacts', '--application', f.application.applicationId,
    '--artifacts-file', path.join(f.directory, 'artifacts.json'));
  assert.equal(locked.ok, true, locked.error);
  const manifest = await readJson(locked.value.manifestPath);
  assert.equal(manifest.optimizationSessionSha256, completed.value.sessionSha256);
  const status = await run(f.directory, 'resume-optimize-status', '--application', f.application.applicationId);
  assert.equal(status.ok, true, status.error);
  assert.equal(status.value.bestObservedScore, 94);
  const restart = await run(f.directory, 'resume-optimize-start', '--application', f.application.applicationId);
  assert.equal(restart.ok, false);
});

test('unreachable minimum parks the candidate instead of inventing skills', async (t) => {
  const f = await fixture(t);
  const result = await importScore(f, f.start.currentResumeSha256, 20, ['Kubernetes']);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.status, 'below-minimum');
  assert.equal(result.value.candidateState, 'parked');
  assert.equal(result.value.addedKeywordCount, 0);
});

test('explicit below-minimum skip policy terminates the candidate', async (t) => {
  const f = await fixture(t, { onBelowMinimum: 'skip' });
  const result = await importScore(f, f.start.currentResumeSha256, 20, ['Kubernetes']);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.candidateState, 'skipped');
  assert.equal((await readJson(path.join(f.paths.applicationsDir, `${f.application.applicationId}.json`))).terminal, true);
});
