import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSubmitReviewManifest, createApplication } from '../scripts/lib/state.mjs';
import {
  SHA_C,
  advanceFullAutoToSubmitAuthorized,
  advanceSemiAutoToSubmitReview,
  applyEvent
} from './helpers.mjs';

function create(mode = 'semi-auto') {
  return createApplication({
    company: 'Example Systems',
    role: 'Data Intern',
    officialUrl: 'https://jobs.example.test/openings/data-intern',
    employerJobId: 'DATA-1',
    portalFamily: 'lever',
    mode
  });
}

function authorizeSemiAutoSubmit() {
  const review = advanceSemiAutoToSubmitReview(create());
  const manifest = buildSubmitReviewManifest(review, { expiresInMinutes: 10 });
  return applyEvent(review, 'SUBMIT_APPROVED', { manifest }, { actor: 'user' });
}

test('submit intent consumes final-click authority before the click', () => {
  const authorized = authorizeSemiAutoSubmit();
  const submitting = applyEvent(authorized, 'SUBMIT_INTENT', {
    candidateId: authorized.candidateId,
    resumeVersionSha: authorized.resumeVersionSha,
    formSnapshotSha: authorized.formSnapshotSha,
    finalButtonLabel: 'Submit application'
  }, { idempotencyKey: `${authorized.candidateId}:final-submit` });

  assert.equal(submitting.state, 'submitting');
  assert.equal(submitting.submitAttemptCount, 1);
  assert.equal(submitting.submitIntent.idempotencyKey, `${authorized.candidateId}:final-submit`);
});

test('a consumed submit intent cannot be executed a second time', () => {
  const authorized = authorizeSemiAutoSubmit();
  const payload = {
    candidateId: authorized.candidateId,
    resumeVersionSha: authorized.resumeVersionSha,
    formSnapshotSha: authorized.formSnapshotSha
  };
  const submitting = applyEvent(authorized, 'SUBMIT_INTENT', payload, { idempotencyKey: 'submit-once' });

  assert.throws(
    () => applyEvent(submitting, 'SUBMIT_INTENT', payload, { idempotencyKey: 'submit-again' }),
    /不允许从 submitting|已经消费过/
  );
});

test('Gate 2 authority cannot survive resume, form, or official URL drift after approval', async (t) => {
  const cases = [
    ['resume', (application, payload) => {
      application.resumeVersionSha = SHA_C;
      payload.resumeVersionSha = SHA_C;
    }, /resumeVersionSha.*漂移|Gate 2.*resume/],
    ['form', (application, payload) => {
      application.formSnapshotSha = SHA_C;
      payload.formSnapshotSha = SHA_C;
    }, /formSnapshotSha.*漂移|Gate 2.*form/],
    ['official URL', (application) => {
      application.officialUrl = 'https://different.example.test/jobs/other';
    }, /officialUrl.*漂移|Gate 2.*URL/],
    ['final button label', (_application, payload) => {
      payload.finalButtonLabel = 'Accept offer';
    }, /finalButtonLabel.*漂移|Gate 2.*button/]
  ];

  for (const [name, mutate, expected] of cases) {
    await t.test(name, () => {
      const authorized = authorizeSemiAutoSubmit();
      const payload = {
        candidateId: authorized.candidateId,
        resumeVersionSha: authorized.resumeVersionSha,
        formSnapshotSha: authorized.formSnapshotSha,
        finalButtonLabel: 'Submit application'
      };
      mutate(authorized, payload);
      assert.throws(
        () => applyEvent(authorized, 'SUBMIT_INTENT', payload),
        expected
      );
    });
  }
});

test('ambiguous post-click state is terminal and can only reconcile official success', () => {
  const authorized = authorizeSemiAutoSubmit();
  let current = applyEvent(authorized, 'SUBMIT_INTENT', {
    candidateId: authorized.candidateId,
    resumeVersionSha: authorized.resumeVersionSha,
    formSnapshotSha: authorized.formSnapshotSha
  });
  current = applyEvent(current, 'SUBMIT_UNKNOWN');

  assert.equal(current.state, 'unknown-submit-state-no-repeat');
  assert.equal(current.terminal, true);
  assert.equal(current.submitAttemptCount, 1);
  assert.throws(() => applyEvent(current, 'SUBMIT_INTENT', {}), /终态/);
  assert.throws(
    () => applyEvent(current, 'OFFICIAL_SUCCESS_RECONCILE', { officialReceiptVerified: false }),
    /官方成功回执/
  );

  const reconciled = applyEvent(current, 'OFFICIAL_SUCCESS_RECONCILE', {
    officialReceiptVerified: true
  });
  assert.equal(reconciled.state, 'submitted-verified');
  assert.equal(reconciled.submitAttemptCount, 1);
});

test('official success is terminal and cannot consume another click', () => {
  const authorized = authorizeSemiAutoSubmit();
  let current = applyEvent(authorized, 'SUBMIT_INTENT', {
    candidateId: authorized.candidateId,
    resumeVersionSha: authorized.resumeVersionSha,
    formSnapshotSha: authorized.formSnapshotSha
  });
  current = applyEvent(current, 'OFFICIAL_SUCCESS', { officialReceiptVerified: true });

  assert.equal(current.state, 'submitted-verified');
  assert.throws(() => applyEvent(current, 'SUBMIT_INTENT', {}), /终态/);
});

test('full-auto still uses the same at-most-once submit-intent protocol', () => {
  const authorized = advanceFullAutoToSubmitAuthorized(create('full-auto'));
  assert.equal(authorized.state, 'submit-authorized-by-policy');

  const submitting = applyEvent(authorized, 'SUBMIT_INTENT', {
    candidateId: authorized.candidateId,
    resumeVersionSha: authorized.resumeVersionSha,
    formSnapshotSha: authorized.formSnapshotSha
  });
  assert.equal(submitting.submitAttemptCount, 1);
  assert.equal(submitting.state, 'submitting');
});
