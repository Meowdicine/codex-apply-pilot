import { transition } from '../scripts/lib/state.mjs';

export const SHA_A = 'a'.repeat(64);
export const SHA_B = 'b'.repeat(64);
export const SHA_C = 'c'.repeat(64);

export function applyEvent(application, type, payload = {}, extra = {}) {
  return transition(
    application,
    {
      type,
      payload,
      actor: extra.actor || 'codex',
      idempotencyKey: extra.idempotencyKey
    },
    { expectedStateVersion: application.stateVersion }
  ).application;
}

export function advanceToResumeReview(application) {
  let current = application;
  current = applyEvent(current, 'SOURCE_VERIFIED', { officialUrl: current.officialUrl });
  current = applyEvent(current, 'ELIGIBILITY_PASSED', { verified: true });
  current = applyEvent(current, 'RESUME_STARTED');
  return applyEvent(current, 'RESUME_READY', { resumeVersionSha: SHA_A });
}

export function advanceSemiAutoToSubmitReview(application) {
  let current = advanceToResumeReview(application);
  current = applyEvent(current, 'RESUME_APPROVED', {
    candidateId: current.candidateId,
    resumeVersionSha: current.resumeVersionSha
  }, { actor: 'user' });
  current = applyEvent(current, 'ACCOUNT_READY', { userConfirmed: true }, { actor: 'user' });
  return applyEvent(current, 'FORM_STAGED', { formSnapshotSha: SHA_B });
}

export function advanceFullAutoToSubmitAuthorized(application) {
  let current = application;
  current = applyEvent(current, 'SOURCE_VERIFIED', { officialUrl: current.officialUrl });
  current = applyEvent(current, 'ELIGIBILITY_PASSED', { verified: true });
  current = applyEvent(current, 'RESUME_STARTED');
  current = applyEvent(current, 'RESUME_READY', {
    resumeVersionSha: SHA_A,
    fullAutoReadinessPassed: true
  });
  current = applyEvent(current, 'ACCOUNT_READY');
  return applyEvent(current, 'FORM_STAGED', { formSnapshotSha: SHA_B });
}
