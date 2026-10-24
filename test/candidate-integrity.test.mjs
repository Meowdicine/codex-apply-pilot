import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyCollisionReview,
  buildArtifactProvenanceManifest,
  buildCandidateAnswerSnapshot,
  createCandidateIdentity,
  hashCanonical,
  hashDocument,
  runTerminalFirstPreflight,
  sha256Buffer
} from '../scripts/lib/candidate-integrity.mjs';
import { createApplication } from '../scripts/lib/state.mjs';

const NOW = '2026-01-15T00:00:00.000Z';
const PREFLIGHT = {
  decision: 'proceed',
  safeToProceed: true,
  reportSha256: 'e'.repeat(64),
  checkedAt: NOW
};

function identity(overrides = {}) {
  return createCandidateIdentity({
    company: 'Example Systems',
    role: 'Platform Intern',
    location: 'Example City',
    officialUrl: 'https://jobs.example.test/openings/123?utm_source=demo&team=cloud',
    employerJobId: ' req-123 ',
    companyAliases: ['Example Systems Inc.'],
    roleAliases: ['Cloud Platform Internship'],
    ...overrides
  });
}

function application() {
  return createApplication({
    company: 'Example Systems',
    role: 'Platform Intern',
    location: 'Example City',
    officialUrl: 'https://jobs.example.test/openings/123?team=cloud',
    employerJobId: 'REQ-123',
    portalFamily: 'example',
    preflight: PREFLIGHT
  });
}

function candidateSnapshot(candidate) {
  return buildCandidateAnswerSnapshot({
    application: candidate,
    answerDocument: { schemaVersion: 1, answers: [] },
    questionSet: {
      reviewedBy: 'user',
      reviewedAt: NOW,
      questions: [{
        prompt: 'Which technical area interests you?',
        semanticKey: 'preferences.technical-area',
        decision: 'candidate-confirmed',
        value: 'platform'
      }]
    },
    createdAt: NOW
  });
}

test('supplied candidate identities cannot forge hashes or contradict application facts', () => {
  const baseline = application();
  for (const mutate of [
    (value) => { value.candidateId = 'f'.repeat(64); },
    (value) => { value.matchKeys.officialUrl = 'f'.repeat(64); },
    (value) => { value.labels.role.canonical = 'Different role'; }
  ]) {
    const supplied = structuredClone(baseline.candidateIdentity);
    mutate(supplied);
    assert.throws(() => createApplication({
      ...baseline,
      candidateIdentity: supplied
    }), /identity/);
  }
});

test('loaded answer snapshots reject tampering and foreign application bindings', async () => {
  const candidate = application();
  const snapshot = candidateSnapshot(candidate);
  candidate.answerSnapshotSha = snapshot.answerSnapshotSha256;
  const tampered = structuredClone(snapshot);
  tampered.questions[0].prompt = 'Changed question';
  await assert.rejects(() => buildArtifactProvenanceManifest({
    application: candidate, answerSnapshot: tampered, artifactPlan: { artifacts: [] }, createdAt: NOW
  }), /snapshot.*hash/);
  const foreign = structuredClone(snapshot);
  foreign.applicationId = 'DEMO-FOREIGN-APPLICATION';
  foreign.answerSnapshotSha256 = hashDocument(foreign, 'answerSnapshotSha256');
  await assert.rejects(() => buildArtifactProvenanceManifest({
    application: { ...candidate, answerSnapshotSha: foreign.answerSnapshotSha256 },
    answerSnapshot: foreign, artifactPlan: { artifacts: [] }, createdAt: NOW
  }), /snapshot.*applicationId/);
});

test('candidate identity v2 is stable across tracking parameters, aliases, and requisition formatting', () => {
  const left = identity();
  const right = identity({
    officialUrl: 'https://JOBS.EXAMPLE.TEST/openings/123/?team=cloud&utm_campaign=x',
    employerJobId: 'REQ-123',
    companyAliases: [],
    roleAliases: []
  });
  assert.equal(left.candidateId, right.candidateId);
  assert.equal(left.matchKeys.officialRequisition, right.matchKeys.officialRequisition);
  assert.equal(left.matchKeys.officialUrl, right.matchKeys.officialUrl);
  assert.ok(left.labels.company.normalizedAliases.includes('example systems inc'));
});

test('terminal-first preflight blocks receipt evidence and cannot collision-review it away', () => {
  const candidate = identity();
  const report = runTerminalFirstPreflight({
    identity: candidate,
    applicationIndex: { applications: [] },
    receipts: [{
      eventId: 'synthetic-event',
      applicationId: 'synthetic-application',
      candidateId: candidate.candidateId,
      eventType: 'SUBMIT_INTENT',
      resultingState: 'submitting'
    }],
    checkedAt: NOW
  });
  assert.equal(report.decision, 'stop-no-repeat');
  assert.equal(report.safeToProceed, false);
  assert.throws(() => applyCollisionReview(report, {}), /不能覆盖 terminal\/no-repeat/);
});

test('context collision requires a report-bound direct user review', () => {
  const candidate = identity({ employerJobId: 'REQ-NEW', officialUrl: 'https://jobs.example.test/openings/new' });
  const existingIdentity = identity({ employerJobId: 'REQ-OLD', officialUrl: 'https://jobs.example.test/openings/old' });
  const report = runTerminalFirstPreflight({
    identity: candidate,
    applicationIndex: {
      applications: [{
        applicationId: 'existing-application',
        candidateId: existingIdentity.candidateId,
        candidateIdentity: existingIdentity,
        company: 'Example Systems',
        role: 'Platform Intern',
        location: 'Example City',
        officialUrl: existingIdentity.official.normalizedUrl,
        state: 'eligible',
        terminal: false,
        submitAttemptCount: 0
      }]
    },
    checkedAt: NOW
  });
  assert.equal(report.decision, 'review-collision');
  const reviewed = applyCollisionReview(report, {
    preflightReportSha256: report.preflightReportSha256,
    candidateId: report.candidateId,
    reviewedBy: 'user',
    reviewedAt: NOW,
    decision: 'distinct-candidate',
    reason: 'Official requisition IDs are different.'
  });
  assert.equal(reviewed.decision, 'proceed-reviewed-collision');
  assert.equal(reviewed.safeToProceed, true);
  const refreshed = runTerminalFirstPreflight({
    identity: candidate,
    applicationIndex: {
      applications: [{
        applicationId: 'existing-application', candidateId: existingIdentity.candidateId,
        candidateIdentity: existingIdentity, company: 'Example Systems', role: 'Platform Intern',
        location: 'Example City', officialUrl: existingIdentity.official.normalizedUrl,
        state: 'eligible', terminal: false, submitAttemptCount: 0
      }]
    },
    checkedAt: '2026-01-15T00:01:00.000Z'
  });
  assert.equal(applyCollisionReview(refreshed, {
    ...reviewed.collisionReview, candidateId: candidate.candidateId
  }).safeToProceed, true);
});

test('answer snapshot preserves exact prompt and hashes protected values', () => {
  const candidate = application();
  const snapshot = buildCandidateAnswerSnapshot({
    application: candidate,
    answerDocument: {
      schemaVersion: 1,
      answers: [{
        questionId: 'legal.sponsorship-required',
        questionRevision: 2,
        answerScope: 'profile',
        value: 'no',
        source: 'user-explicit',
        sensitivity: 'legal-material',
        automationPolicy: 'ask-until-verified',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-02-01T00:00:00.000Z'
      }]
    },
    questionSet: {
      reviewedBy: 'user',
      reviewedAt: NOW,
      questions: [{
        portalQuestionId: 'demo-q1',
        prompt: 'Will you now or in the future require sponsorship?',
        semanticKey: 'legal.sponsorship.required',
        answerQuestionId: 'legal.sponsorship-required',
        answerQuestionRevision: 2,
        decision: 'use-stored-answer'
      }]
    },
    createdAt: NOW
  });
  assert.equal(snapshot.readyForStaging, true);
  assert.equal(snapshot.questions[0].prompt, 'Will you now or in the future require sponsorship?');
  assert.equal(snapshot.questions[0].answer.storage, 'hash-only');
  assert.equal(Object.hasOwn(snapshot.questions[0].answer, 'value'), false);
  assert.equal(snapshot.questions[0].answer.questionRevision, 2);
});

test('artifact provenance hashes actual files and binds resume, form, answers, and candidate', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'apply-pilot-provenance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const resumePath = path.join(directory, 'resume.pdf');
  const formPath = path.join(directory, 'form.json');
  const resumeBytes = Buffer.from('synthetic resume artifact');
  const formBytes = Buffer.from('{"synthetic":true}');
  await Promise.all([
    writeFile(resumePath, resumeBytes),
    writeFile(formPath, formBytes)
  ]);
  const candidate = application();
  candidate.resumeVersionSha = sha256Buffer(resumeBytes);
  const answerSnapshot = candidateSnapshot(candidate);
  candidate.answerSnapshotSha = answerSnapshot.answerSnapshotSha256;
  const manifest = await buildArtifactProvenanceManifest({
    application: candidate,
    answerSnapshot,
    artifactPlan: {
      artifacts: [
        {
          kind: 'resume',
          logicalName: 'candidate-resume.pdf',
          mediaType: 'application/pdf',
          file: resumePath,
          sourceType: 'candidate-generated',
          sourceArtifactSha256: 'b'.repeat(64),
          sourceId: 'software-baseline-v1'
        },
        {
          kind: 'form-snapshot',
          logicalName: 'form-snapshot.json',
          mediaType: 'application/json',
          file: formPath,
          sourceType: 'portal-form'
        }
      ]
    },
    createdAt: NOW
  });
  assert.equal(manifest.resumeVersionSha256, sha256Buffer(resumeBytes));
  assert.equal(manifest.formSnapshotSha256, sha256Buffer(formBytes));
  assert.equal(manifest.answerSnapshotSha256, candidate.answerSnapshotSha);
  assert.equal(manifest.candidateId, candidate.candidateId);
  assert.equal(manifest.artifacts.find((item) => item.kind === 'resume').byteLength, resumeBytes.byteLength);
});
