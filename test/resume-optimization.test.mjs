import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../scripts/lib/state.mjs';
import { sha256 } from '../scripts/lib/candidate-integrity.mjs';
import { containsKeyword, optimizationPolicy, optimizeFromScore, startResumeOptimization } from '../scripts/lib/resume-optimization.mjs';
import { applyEvent } from './helpers.mjs';

export const NOW = '2026-01-15T12:00:00.000Z';

export function optimizationFixture() {
  let application = createApplication({
    company: 'Example Labs', role: 'Platform Intern', officialUrl: 'https://jobs.example.test/demo/platform',
    employerJobId: 'DEMO-PLATFORM', preflight: { safeToProceed: true, decision: 'proceed', reportSha256: 'e'.repeat(64) }
  });
  application = applyEvent(application, 'SOURCE_VERIFIED', { officialUrl: application.officialUrl });
  application = applyEvent(application, 'ELIGIBILITY_PASSED', { verified: true });
  application = applyEvent(application, 'RESUME_STARTED');
  const baselineText = '# Example Candidate\n\n## Skills\n- Tools: Python\n\n## Projects\n- Built demo scripts.\n';
  const jdText = 'Platform coursework using CI/CD, Bash and Kubernetes. Collaborate through stakeholder interviews.';
  const pipeline = '- Built CI/CD pipelines in a coursework project.';
  const shell = 'Wrote Bash scripts for coursework automation.';
  const evidenceSources = { pipeline, shell };
  const evidence = Object.entries(evidenceSources).map(([id, value]) => ({
    id, sourceType: 'verified-material', sourceSha256: sha256(value), excerpt: value,
    supportedKeywords: [id === 'pipeline' ? 'CI/CD' : 'Bash'], approvedWording: [value],
    reviewedBy: 'user', reviewedAt: NOW
  }));
  const plan = {
    schemaVersion: 1, candidateId: application.candidateId, officialUrlSha256: sha256(application.officialUrl),
    jdSha256: sha256(jdText), baselineId: 'demo-baseline', evidence,
    edits: [
      { id: 'demo-pipeline-edit', keyword: 'CI/CD', classification: 'direct', evidenceId: 'pipeline', kind: 'project',
        action: 'replace-text', sectionHeading: '## Projects', before: '- Built demo scripts.', after: pipeline,
        reviewedBy: 'user', reviewedAt: NOW },
      { id: 'demo-shell-edit', keyword: 'Bash', classification: 'direct', evidenceId: 'shell', kind: 'skills',
        action: 'append-skill', sectionHeading: '## Skills', before: '- Tools: Python', reviewedBy: 'user', reviewedAt: NOW }
    ]
  };
  const baselineCatalog = { baselines: [{ id: 'demo-baseline', immutable: true, artifactSha256: sha256(baselineText), approvedAt: NOW }] };
  const policy = { targetScore: 90, minimumScore: 60, maxEditsPerRound: 1 };
  return { application, baselineText, jdText, baselineCatalog, plan, evidenceSources, policy, now: NOW };
}

export function scoreFor(optimization, score = 50, missingKeywords = ['CI/CD', 'Bash', 'Kubernetes'], extra = {}) {
  return {
    schemaVersion: 1, provider: 'simplify', confirmedBy: 'user', metric: 'keyword-match',
    candidateId: optimization.candidateId, officialUrlSha256: optimization.officialUrlSha256,
    jdSha256: optimization.jdSha256, resumeSha256: optimization.currentResumeSha256,
    observedAt: NOW, saveComplete: true, recalculationComplete: true, score, missingKeywords,
    scoredArtifactSha256: sha256(`DEMO-export:${optimization.currentResumeSha256}`), sourceTextVerified: true, ...extra
  };
}

test('score-driven rounds modify only supported text and finish after a fresh target score', () => {
  const fixture = optimizationFixture();
  let optimization = startResumeOptimization(fixture);
  const original = optimization.currentText;
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization), now: NOW });
  assert.equal(optimization.iterationCount, 1);
  assert.match(optimization.currentText, /CI\/CD pipelines in a coursework project/);
  assert.doesNotMatch(optimization.currentText, /Kubernetes/);
  assert.equal(fixture.baselineText, original);
  assert.equal(optimization.readyForQa, false);
  assert.ok(optimization.rounds[0].gaps.some((item) => item.reason === 'unsupported-or-unverified'));
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 75, ['Bash', 'Kubernetes']), now: NOW });
  assert.match(optimization.currentText, /Tools: Python, Bash/);
  assert.equal(optimization.iterationCount, 2);
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 94, ['Kubernetes']), now: NOW });
  assert.equal(optimization.stopReason, 'target-reached');
  assert.equal(optimization.readyForQa, true);
  assert.equal(optimization.best.score, 94);
  assert.equal(optimization.recommendedResumeSha256, optimization.currentResumeSha256);
});

test('score type, save state, freshness and version must all match', async (t) => {
  const fixture = optimizationFixture();
  const optimization = startResumeOptimization(fixture);
  for (const [name, change] of [
    ['wrong metric', { metric: 'resume-score' }], ['unsaved', { saveComplete: false }],
    ['uncalculated', { recalculationComplete: false }], ['wrong resume', { resumeSha256: 'a'.repeat(64) }],
    ['wrong JD', { jdSha256: 'b'.repeat(64) }], ['wrong candidate', { candidateId: 'c'.repeat(64) }],
    ['stale time', { observedAt: '2026-01-01T00:00:00.000Z' }], ['invalid score', { score: 101 }],
    ['unconfirmed', { confirmedBy: 'codex' }],
    ['unverified source/export mapping', { sourceTextVerified: false }]
  ]) await t.test(name, () => assert.throws(() => optimizeFromScore({
    optimization, application: fixture.application, feedback: scoreFor(optimization, 50, ['CI/CD'], change), now: NOW
  })));
});

test('score regression keeps the highest-scoring verified version', () => {
  const fixture = optimizationFixture();
  let optimization = startResumeOptimization(fixture);
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 70), now: NOW });
  const changedSha = optimization.currentResumeSha256;
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 65), now: NOW });
  assert.equal(optimization.stopReason, 'score-regressed');
  assert.equal(optimization.recommendedResumeSha256, sha256(fixture.baselineText));
  assert.notEqual(optimization.recommendedResumeSha256, changedSha);
  assert.equal(optimization.readyForQa, true);
});

test('max iterations, stagnation and unsupported-only feedback stop deterministically', async (t) => {
  for (const [name, policy, secondScore, reason] of [
    ['max rounds', { maxIterations: 1 }, 75, 'max-iterations'],
    ['stagnation', { maxStagnantRounds: 1 }, 70, 'stagnated']
  ]) await t.test(name, () => {
    const fixture = optimizationFixture();
    let optimization = startResumeOptimization({ ...fixture, policy: { ...fixture.policy, ...policy } });
    optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 70), now: NOW });
    optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, secondScore), now: NOW });
    assert.equal(optimization.stopReason, reason);
  });
  const fixture = optimizationFixture();
  let optimization = startResumeOptimization(fixture);
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 20, ['Kubernetes']), now: NOW });
  assert.equal(optimization.status, 'below-minimum');
  assert.equal(optimization.stopReason, 'no-safe-edits');
  assert.equal(optimization.readyForQa, false);
});

test('unverified evidence, contaminated baselines and unsupported claims fail closed', async (t) => {
  for (const [name, mutate] of [
    ['source hash', (f) => { f.evidenceSources.pipeline = 'different'; }],
    ['invented excerpt', (f) => { f.plan.evidence[0].excerpt = 'Invented'; }],
    ['unreviewed edit', (f) => { f.plan.edits[0].reviewedBy = 'codex'; }],
    ['unsupported wording', (f) => { f.plan.edits[0].after = '- Led production CI/CD.'; }],
    ['candidate package', (f) => { f.baselineCatalog.baselines[0].scope = 'candidate'; }],
    ['mutable baseline', (f) => { f.baselineCatalog.baselines[0].immutable = false; }],
    ['no approval', (f) => { f.baselineCatalog.baselines[0].approvedAt = null; }],
    ['terminal', (f) => { f.application.terminal = true; }]
  ]) await t.test(name, () => {
    const fixture = optimizationFixture(); mutate(fixture);
    assert.throws(() => startResumeOptimization(fixture));
  });
});

test('exact matching does not confuse Java, C, C++ or C#', () => {
  assert.equal(containsKeyword('JavaScript', 'Java'), false);
  assert.equal(containsKeyword('C++ and C#', 'C'), false);
  assert.equal(containsKeyword('C++ and C#', 'C++'), true);
  assert.equal(containsKeyword('CI/CD using Node.js', 'Node.js'), true);
});

test('equivalent wording requires explicit user semantic confirmation', () => {
  const fixture = optimizationFixture();
  fixture.plan.edits[0].classification = 'equivalent';
  assert.throws(() => startResumeOptimization(fixture), /equivalent/);
  fixture.plan.evidence[0].semanticEquivalenceConfirmed = true;
  assert.ok(startResumeOptimization(fixture));
});

test('there is no universal target or minimum score default', () => {
  assert.throws(() => optimizationPolicy({}), /targetScore/);
  assert.throws(() => optimizationPolicy({ targetScore: 70, minimumScore: 80 }), /minimumScore/);
});

test('approved technical evidence can generate keyword edits automatically without a hand-authored edit', () => {
  const fixture = optimizationFixture();
  fixture.plan.edits = [];
  for (const item of fixture.plan.evidence) {
    item.canListAsSkill = true;
    item.keywordCategory = 'technical';
  }
  fixture.policy.autoAppendSkills = { sectionHeading: '## Skills', lineAnchor: '- Tools: Python' };
  let optimization = startResumeOptimization(fixture);
  optimization = optimizeFromScore({ optimization, application: fixture.application,
    feedback: scoreFor(optimization, 50, ['CI/CD', 'Kubernetes']), now: NOW });
  assert.match(optimization.currentText, /Tools: Python, CI\/CD/);
  assert.doesNotMatch(optimization.currentText, /Kubernetes/);
  optimization = optimizeFromScore({ optimization, application: fixture.application,
    feedback: scoreFor(optimization, 75, ['Bash']), now: NOW });
  assert.match(optimization.currentText, /Tools: Python, CI\/CD, Bash/);
});

test('changed source, state version and wrong section anchors cannot be reused', () => {
  const fixture = optimizationFixture();
  const optimization = startResumeOptimization(fixture);
  assert.throws(() => optimizeFromScore({ optimization: { ...optimization, currentText: 'changed' },
    application: fixture.application, feedback: scoreFor(optimization), now: NOW }), /hash/);
  assert.throws(() => optimizeFromScore({ optimization, application: { ...fixture.application, stateVersion: 99 },
    feedback: scoreFor(optimization), now: NOW }), /state\/version/);
  const wrongSection = optimizationFixture();
  wrongSection.plan.edits[0].sectionHeading = '## Project';
  const initial = startResumeOptimization(wrongSection);
  const result = optimizeFromScore({ optimization: initial, application: wrongSection.application,
    feedback: scoreFor(initial, 20, ['CI/CD']), now: NOW });
  assert.equal(result.iterationCount, 0);
  assert.equal(result.rounds[0].gaps[0].reason, 'anchor-conflict');
});

test('append-bullet preserves the old bullet and its numbers', () => {
  const fixture = optimizationFixture();
  fixture.baselineText = fixture.baselineText.replace('Built demo scripts.', 'Built 5 demo scripts.');
  fixture.baselineCatalog.baselines[0].artifactSha256 = sha256(fixture.baselineText);
  fixture.plan.edits[0].action = 'append-bullet';
  fixture.plan.edits[0].before = '- Built 5 demo scripts.';
  const optimization = startResumeOptimization(fixture);
  const result = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 50, ['CI/CD']), now: NOW });
  assert.match(result.currentText, /Built 5 demo scripts\.\n- Built CI\/CD pipelines/);
});

test('equivalent wording is applied only with explicit approval, while invented metrics are refused', () => {
  const fixture = optimizationFixture();
  fixture.evidenceSources.pipeline = 'Built continuous integration and delivery pipelines in coursework.';
  fixture.plan.evidence[0].excerpt = fixture.evidenceSources.pipeline;
  fixture.plan.evidence[0].sourceSha256 = sha256(fixture.evidenceSources.pipeline);
  fixture.plan.evidence[0].semanticEquivalenceConfirmed = true;
  fixture.plan.edits[0].classification = 'equivalent';
  const optimization = startResumeOptimization(fixture);
  const result = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 50, ['CI/CD']), now: NOW });
  assert.match(result.currentText, /CI\/CD pipelines in a coursework project/);
  fixture.plan.edits[0].after = '- Built CI/CD pipelines with 90% improvement.';
  fixture.plan.evidence[0].approvedWording = [fixture.plan.edits[0].after];
  assert.throws(() => startResumeOptimization(fixture), /metrics/);
});

test('stopped best-version recheck refreshes score without resetting edit budget', () => {
  const fixture = optimizationFixture();
  let optimization = startResumeOptimization(fixture);
  optimization = optimizeFromScore({ optimization, application: fixture.application, feedback: scoreFor(optimization, 94), now: NOW });
  const before = optimization.iterationCount;
  optimization = optimizeFromScore({ optimization, application: fixture.application,
    feedback: scoreFor(optimization, 80, ['CI/CD'], { observedAt: '2026-01-15T12:01:00.000Z' }),
    recheckOnly: true, recommendedText: fixture.baselineText, now: '2026-01-15T12:01:00.000Z' });
  assert.equal(optimization.best.score, 80);
  assert.equal(optimization.iterationCount, before);
  assert.equal(optimization.currentText, fixture.baselineText);
  assert.equal(optimization.stopReason, 'best-version-rechecked');
});

test('multiple approved Skills edits share a line without losing prior additions', () => {
  const fixture = optimizationFixture();
  fixture.policy.maxEditsPerRound = 5;
  Object.assign(fixture.plan.edits[0], { kind: 'skills', action: 'append-skill',
    sectionHeading: '## Skills', before: '- Tools: Python' });
  const optimization = startResumeOptimization(fixture);
  const result = optimizeFromScore({ optimization, application: fixture.application,
    feedback: scoreFor(optimization, 50, ['CI/CD', 'Bash']), now: NOW });
  assert.match(result.currentText, /Tools: Python, CI\/CD, Bash/);
  assert.equal(result.appliedEditIds.length, 2);
});
