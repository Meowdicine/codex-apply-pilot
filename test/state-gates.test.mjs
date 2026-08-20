import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSubmitReviewManifest,
  createApplication,
  sha256,
  transition
} from '../scripts/lib/state.mjs';
import {
  SHA_A,
  SHA_B,
  SHA_C,
  advanceSemiAutoToSubmitReview,
  advanceToResumeReview,
  applyEvent
} from './helpers.mjs';

function newSemiAuto() {
  return createApplication({
    company: 'Example Labs',
    role: 'Software Intern',
    officialUrl: 'https://careers.example.test/jobs/123?utm_source=test',
    employerJobId: '123',
    portalFamily: 'greenhouse',
    mode: 'semi-auto'
  });
}

test('Gate 1 accepts the exact candidate and resume hash', () => {
  const review = advanceToResumeReview(newSemiAuto());
  const approved = applyEvent(review, 'RESUME_APPROVED', {
    candidateId: review.candidateId,
    resumeVersionSha: review.resumeVersionSha
  }, { actor: 'user' });

  assert.equal(approved.state, 'account-registration-required');
  assert.equal(approved.gate1.approvedResumeSha, SHA_A);
  assert.equal(approved.gate1.actor, 'user');
});

test('Gate 1 rejects resume hash drift', () => {
  const review = advanceToResumeReview(newSemiAuto());
  assert.throws(
    () => applyEvent(review, 'RESUME_APPROVED', {
      candidateId: review.candidateId,
      resumeVersionSha: SHA_C
    }, { actor: 'user' }),
    /resumeVersionSha.*漂移/
  );
});

test('Gate 1 rejects candidate drift instead of approving a hash out of context', () => {
  const review = advanceToResumeReview(newSemiAuto());
  assert.throws(
    () => applyEvent(review, 'RESUME_APPROVED', {
      candidateId: SHA_C,
      resumeVersionSha: review.resumeVersionSha
    }, { actor: 'user' }),
    /candidateId.*不匹配/
  );
});

test('semi-auto account transition requires direct user confirmation', () => {
  let current = advanceToResumeReview(newSemiAuto());
  current = applyEvent(current, 'RESUME_APPROVED', {
    candidateId: current.candidateId,
    resumeVersionSha: current.resumeVersionSha
  }, { actor: 'user' });

  assert.throws(() => applyEvent(current, 'ACCOUNT_READY'), /用户确认账号/);
});

test('Gate 2 exact manifest advances once when every binding is unchanged', () => {
  const review = advanceSemiAutoToSubmitReview(newSemiAuto());
  const manifest = buildSubmitReviewManifest(review, {
    finalButtonLabel: 'Submit application',
    expiresInMinutes: 10
  });
  const approved = applyEvent(review, 'SUBMIT_APPROVED', { manifest }, { actor: 'user' });

  assert.equal(approved.state, 'submit-authorized');
  assert.equal(approved.gate2.candidateId, review.candidateId);
  assert.equal(approved.gate2.officialUrlHash, sha256(review.officialUrl));
  assert.equal(approved.gate2.resumeVersionSha, SHA_A);
  assert.equal(approved.gate2.formSnapshotSha, SHA_B);
});

test('Gate 2 rejects candidate, resume, form, state-version, and expiry drift', async (t) => {
  const review = advanceSemiAutoToSubmitReview(newSemiAuto());
  const baseline = buildSubmitReviewManifest(review, { expiresInMinutes: 10 });
  const cases = [
    ['candidate', { ...baseline, candidateId: SHA_C }, /candidateId.*不匹配/],
    ['resume', { ...baseline, resumeVersionSha: SHA_C }, /resumeVersionSha.*不匹配/],
    ['form', { ...baseline, formSnapshotSha: SHA_C }, /formSnapshotSha.*不匹配/],
    ['state version', { ...baseline, stateVersion: baseline.stateVersion + 1 }, /stateVersion.*漂移/],
    ['expiry', { ...baseline, expiresAt: new Date(Date.now() - 60_000).toISOString() }, /已过期/]
  ];

  for (const [name, manifest, expected] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => applyEvent(review, 'SUBMIT_APPROVED', { manifest }, { actor: 'user' }),
        expected
      );
    });
  }
});

test('Gate 2 rejects official URL hash drift', () => {
  const review = advanceSemiAutoToSubmitReview(newSemiAuto());
  const manifest = {
    ...buildSubmitReviewManifest(review, { expiresInMinutes: 10 }),
    officialUrlHash: SHA_C
  };

  assert.throws(
    () => applyEvent(review, 'SUBMIT_APPROVED', { manifest }, { actor: 'user' }),
    /officialUrlHash.*不匹配/
  );
});

test('CAS rejects an event created from a stale state version', () => {
  const application = newSemiAuto();
  const progressed = applyEvent(application, 'SOURCE_VERIFIED', { officialUrl: application.officialUrl });

  assert.throws(
    () => transition(
      progressed,
      { type: 'ELIGIBILITY_PASSED', payload: { verified: true } },
      { expectedStateVersion: application.stateVersion }
    ),
    /stale stateVersion/
  );
});
