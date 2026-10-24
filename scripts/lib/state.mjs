import { randomUUID } from 'node:crypto';
import {
  createCandidateIdV2,
  createCandidateIdentity,
  assertCandidateIdentity,
  hashCanonical,
  normalizeOfficialUrl,
  sha256
} from './candidate-integrity.mjs';

export { hashCanonical, normalizeOfficialUrl, sha256 };

export const TERMINAL_STATES = new Set([
  'submitted-verified',
  'skipped',
  'closed',
  'withdrawn',
  'security-hard-stop',
  'unsupported-fact-hard-stop',
  'unknown-account-state-no-repeat',
  'unknown-submit-state-no-repeat'
]);

const AUTHORIZED_SUBMIT_STATES = new Set(['submit-authorized', 'submit-authorized-by-policy']);

export function createCandidateId({ officialUrl, employerJobId }) {
  return createCandidateIdV2({ officialUrl, employerJobId });
}

export function createApplication({
  company,
  role,
  location = null,
  officialUrl,
  employerJobId = null,
  portalFamily = 'unknown',
  mode = 'semi-auto',
  companyAliases = [],
  roleAliases = [],
  locationAliases = [],
  candidateIdentity = null,
  preflight = null
}) {
  if (!company?.trim() || !role?.trim()) throw new Error('company 和 role 不能为空');
  if (!['semi-auto', 'full-auto'].includes(mode)) throw new Error('mode 必须是 semi-auto 或 full-auto');
  const normalizedUrl = normalizeOfficialUrl(officialUrl);
  const identity = candidateIdentity || createCandidateIdentity({
    company,
    role,
    location,
    officialUrl: normalizedUrl,
    employerJobId,
    companyAliases,
    roleAliases,
    locationAliases
  });
  assertCandidateIdentity(identity, { company, role, location, officialUrl: normalizedUrl, employerJobId });
  if (identity.identityVersion !== 2) throw new Error('新 application 必须使用 candidate identity v2');
  if (identity.official.normalizedUrl !== normalizedUrl) throw new Error('candidate identity officialUrl 已漂移');
  if (preflight && (!preflight.safeToProceed || !/^[a-f0-9]{64}$/i.test(preflight.reportSha256 || ''))) {
    throw new Error('application preflight 必须 safeToProceed 并绑定 report SHA-256');
  }
  const now = new Date().toISOString();

  return {
    schemaVersion: 2,
    applicationId: randomUUID(),
    candidateId: identity.candidateId,
    candidateIdentity: identity,
    company: company.trim(),
    role: role.trim(),
    location: location?.trim() || null,
    employerJobId,
    officialUrl: normalizedUrl,
    portalFamily,
    mode,
    state: 'discovered',
    stateVersion: 0,
    submitAttemptCount: 0,
    preflight,
    resumeVersionSha: null,
    answerSnapshotSha: null,
    artifactManifestSha: null,
    artifactLock: null,
    formSnapshotSha: null,
    gate1: null,
    gate2: null,
    policySubmitBinding: null,
    submitIntent: null,
    terminal: false,
    createdAt: now,
    updatedAt: now,
    events: []
  };
}

function requireState(application, allowed, eventType) {
  if (!allowed.includes(application.state)) {
    throw new Error(`${eventType} 不允许从 ${application.state} 转移；允许状态：${allowed.join(', ')}`);
  }
}

function requireHash(value, field) {
  if (!/^[a-f0-9]{64}$/i.test(value || '')) throw new Error(`${field} 必须是 64 位 SHA-256`);
}

function clone(value) {
  return structuredClone(value);
}

function assertArtifactLock(application) {
  if (application.schemaVersion < 2) return;
  const lock = application.artifactLock;
  if (!lock || lock.candidateId !== application.candidateId
    || lock.candidateIdentitySha256 !== hashCanonical(application.candidateIdentity)
    || lock.officialUrlSha256 !== sha256(application.officialUrl)
    || lock.resumeVersionSha !== application.resumeVersionSha
    || lock.answerSnapshotSha !== application.answerSnapshotSha
    || lock.artifactManifestSha !== application.artifactManifestSha
    || (application.formSnapshotSha && lock.formSnapshotSha !== application.formSnapshotSha)) {
    throw new Error('artifact provenance lock 已漂移');
  }
}

export function transition(application, event, options = {}) {
  const next = clone(application);
  const expected = options.expectedStateVersion;
  if (!Number.isInteger(expected) || expected !== next.stateVersion) {
    throw new Error(`stale stateVersion：expected=${expected} current=${next.stateVersion}`);
  }
  if (next.terminal && event.type !== 'OFFICIAL_SUCCESS_RECONCILE') {
    throw new Error(`终态 ${next.state} 不允许继续操作`);
  }

  const eventPayload = event.payload || {};
  const eventIdempotencyKey = event.idempotencyKey || `${next.applicationId}:${event.type}:${next.stateVersion}`;
  if (next.events.some((item) => item.idempotencyKey === eventIdempotencyKey)) {
    throw new Error(`重复 idempotencyKey：${eventIdempotencyKey}`);
  }

  switch (event.type) {
    case 'SOURCE_VERIFIED':
      requireState(next, ['discovered'], event.type);
      if (eventPayload.officialUrl !== next.officialUrl) throw new Error('officialUrl 与候选绑定不一致');
      next.state = 'source-verified';
      break;
    case 'ELIGIBILITY_PASSED':
      requireState(next, ['source-verified'], event.type);
      if (eventPayload.verified !== true) throw new Error('必须提供 verified=true');
      next.state = 'eligible';
      break;
    case 'RESUME_STARTED':
      requireState(next, ['eligible'], event.type);
      if (next.schemaVersion >= 2 && (!next.preflight?.safeToProceed || !next.preflight?.reportSha256)) {
        throw new Error('RESUME_STARTED 前必须通过 terminal-first preflight');
      }
      next.state = 'resume-preparing';
      break;
    case 'RESUME_READY':
      requireState(next, ['resume-preparing'], event.type);
      requireHash(eventPayload.resumeVersionSha, 'resumeVersionSha');
      next.resumeVersionSha = eventPayload.resumeVersionSha.toLowerCase();
      if (next.mode === 'semi-auto') {
        next.state = 'resume-review-required';
      } else {
        if (eventPayload.fullAutoReadinessPassed !== true) throw new Error('全自动模式必须先通过 readiness');
        next.state = 'resume-approved-by-policy';
      }
      break;
    case 'RESUME_APPROVED':
      requireState(next, ['resume-review-required'], event.type);
      if (eventPayload.candidateId !== next.candidateId) throw new Error('Gate 1 candidateId 不匹配');
      requireHash(eventPayload.resumeVersionSha, 'resumeVersionSha');
      if (eventPayload.resumeVersionSha.toLowerCase() !== next.resumeVersionSha) throw new Error('Gate 1 的 resumeVersionSha 已漂移');
      next.gate1 = {
        approvedResumeSha: next.resumeVersionSha,
        approvedAt: eventPayload.approvedAt || new Date().toISOString(),
        actor: 'user'
      };
      next.state = 'account-registration-required';
      break;
    case 'ACCOUNT_READY':
      requireState(next, ['account-registration-required', 'resume-approved-by-policy'], event.type);
      if (next.mode === 'semi-auto' && eventPayload.userConfirmed !== true) {
        throw new Error('半自动模式要求用户确认账号已注册并可登录');
      }
      next.state = 'form-staging';
      break;
    case 'ANSWER_SNAPSHOT_LOCKED':
      requireState(next, ['form-staging'], event.type);
      if (next.artifactLock) throw new Error('artifact provenance 已锁定，不能替换 answer snapshot');
      if (eventPayload.candidateId !== next.candidateId) throw new Error('answer snapshot candidateId 不匹配');
      requireHash(eventPayload.answerSnapshotSha, 'answerSnapshotSha');
      if (eventPayload.candidateIdentitySha256 !== hashCanonical(next.candidateIdentity)) {
        throw new Error('answer snapshot candidate identity 已漂移');
      }
      if (eventPayload.readyForStaging !== true) throw new Error('answer snapshot 尚未 readyForStaging');
      next.answerSnapshotSha = eventPayload.answerSnapshotSha.toLowerCase();
      break;
    case 'ARTIFACT_PROVENANCE_LOCKED':
      requireState(next, ['form-staging'], event.type);
      if (!next.answerSnapshotSha) throw new Error('必须先锁定 candidate answer snapshot');
      if (eventPayload.candidateId !== next.candidateId) throw new Error('artifact provenance candidateId 不匹配');
      if (eventPayload.candidateIdentitySha256 !== hashCanonical(next.candidateIdentity)) {
        throw new Error('artifact provenance candidate identity 已漂移');
      }
      if (eventPayload.officialUrlSha256 !== sha256(next.officialUrl)) throw new Error('artifact provenance officialUrl 已漂移');
      if (eventPayload.resumeVersionSha !== next.resumeVersionSha) throw new Error('artifact provenance resumeVersionSha 已漂移');
      if (eventPayload.answerSnapshotSha !== next.answerSnapshotSha) throw new Error('artifact provenance answerSnapshotSha 已漂移');
      requireHash(eventPayload.formSnapshotSha, 'formSnapshotSha');
      requireHash(eventPayload.artifactManifestSha, 'artifactManifestSha');
      next.artifactManifestSha = eventPayload.artifactManifestSha.toLowerCase();
      next.artifactLock = {
        candidateId: next.candidateId,
        candidateIdentitySha256: eventPayload.candidateIdentitySha256,
        officialUrlSha256: eventPayload.officialUrlSha256,
        resumeVersionSha: next.resumeVersionSha,
        answerSnapshotSha: next.answerSnapshotSha,
        formSnapshotSha: eventPayload.formSnapshotSha.toLowerCase(),
        artifactManifestSha: next.artifactManifestSha,
        lockedAt: new Date().toISOString()
      };
      break;
    case 'FORM_STAGED':
      requireState(next, ['form-staging'], event.type);
      requireHash(eventPayload.formSnapshotSha, 'formSnapshotSha');
      if (next.schemaVersion >= 2) {
        if (!next.answerSnapshotSha || !next.artifactManifestSha || !next.artifactLock) {
          throw new Error('FORM_STAGED 前必须锁定 answer snapshot 与 artifact provenance');
        }
        assertArtifactLock(next);
        if (eventPayload.formSnapshotSha.toLowerCase() !== next.artifactLock.formSnapshotSha) {
          throw new Error('formSnapshotSha 与 artifact provenance lock 不匹配');
        }
      }
      next.formSnapshotSha = eventPayload.formSnapshotSha.toLowerCase();
      if (next.mode === 'semi-auto') {
        next.state = 'submit-review-required';
      } else {
        next.policySubmitBinding = {
          candidateId: next.candidateId,
          officialUrlHash: sha256(next.officialUrl),
          resumeVersionSha: next.resumeVersionSha,
          answerSnapshotSha: next.answerSnapshotSha,
          artifactManifestSha: next.artifactManifestSha,
          formSnapshotSha: next.formSnapshotSha,
          finalButtonLabel: eventPayload.finalButtonLabel || 'Submit application',
          stateVersion: next.stateVersion,
          boundAt: new Date().toISOString()
        };
        next.state = 'submit-authorized-by-policy';
      }
      break;
    case 'SUBMIT_APPROVED': {
      requireState(next, ['submit-review-required'], event.type);
      const manifest = eventPayload.manifest;
      assertArtifactLock(next);
      if (!manifest || manifest.candidateId !== next.candidateId) throw new Error('Gate 2 candidateId 不匹配');
      if (manifest.officialUrlHash !== sha256(next.officialUrl)) throw new Error('Gate 2 officialUrlHash 不匹配');
      if (manifest.resumeVersionSha !== next.resumeVersionSha) throw new Error('Gate 2 resumeVersionSha 不匹配');
      if (manifest.answerSnapshotSha !== next.answerSnapshotSha) throw new Error('Gate 2 answerSnapshotSha 不匹配');
      if (manifest.artifactManifestSha !== next.artifactManifestSha) throw new Error('Gate 2 artifactManifestSha 不匹配');
      if (manifest.formSnapshotSha !== next.formSnapshotSha) throw new Error('Gate 2 formSnapshotSha 不匹配');
      if (manifest.stateVersion !== next.stateVersion) throw new Error('Gate 2 stateVersion 已漂移');
      if (!Number.isFinite(Date.parse(manifest.expiresAt)) || Date.parse(manifest.expiresAt) <= Date.now()) throw new Error('Gate 2 manifest 已过期');
      next.gate2 = { ...manifest, approvedAt: new Date().toISOString(), actor: 'user' };
      next.state = 'submit-authorized';
      break;
    }
    case 'SUBMIT_INTENT':
      if (!AUTHORIZED_SUBMIT_STATES.has(next.state)) throw new Error(`SUBMIT_INTENT 不允许从 ${next.state} 执行`);
      if (next.submitAttemptCount !== 0 || next.submitIntent) throw new Error('该候选已经消费过 final-click authority');
      {
        const binding = next.mode === 'semi-auto' ? next.gate2 : next.policySubmitBinding;
        if (!binding || binding.candidateId !== next.candidateId) throw new Error('提交授权的 candidateId 已漂移');
        if (binding.officialUrlHash !== sha256(next.officialUrl)) throw new Error('提交授权的 officialUrlHash 已漂移');
        if (binding.resumeVersionSha !== next.resumeVersionSha) throw new Error('提交授权的 resumeVersionSha 已漂移');
        if (binding.answerSnapshotSha !== next.answerSnapshotSha) throw new Error('提交授权的 answerSnapshotSha 已漂移');
        if (binding.artifactManifestSha !== next.artifactManifestSha) throw new Error('提交授权的 artifactManifestSha 已漂移');
        if (binding.formSnapshotSha !== next.formSnapshotSha) throw new Error('提交授权的 formSnapshotSha 已漂移');
        if ((eventPayload.finalButtonLabel || binding.finalButtonLabel) !== binding.finalButtonLabel) {
          throw new Error('提交授权的 finalButtonLabel 已漂移');
        }
        assertArtifactLock(next);
        if (binding.stateVersion + 1 !== next.stateVersion) throw new Error('提交授权的 stateVersion 已漂移');
        if (next.mode === 'semi-auto' && (!Number.isFinite(Date.parse(binding.expiresAt)) || Date.parse(binding.expiresAt) <= Date.now())) {
          throw new Error('Gate 2 manifest 已过期');
        }
      }
      if (eventPayload.candidateId !== next.candidateId) throw new Error('submit candidateId 不匹配');
      if (eventPayload.resumeVersionSha !== next.resumeVersionSha) throw new Error('submit resumeVersionSha 不匹配');
      if (eventPayload.formSnapshotSha !== next.formSnapshotSha) throw new Error('submit formSnapshotSha 不匹配');
      next.submitIntent = {
        idempotencyKey: eventIdempotencyKey,
        writtenAt: new Date().toISOString(),
        finalButtonLabel: eventPayload.finalButtonLabel || (next.mode === 'semi-auto' ? next.gate2.finalButtonLabel : next.policySubmitBinding.finalButtonLabel)
      };
      next.submitAttemptCount = 1;
      next.state = 'submitting';
      break;
    case 'OFFICIAL_SUCCESS':
      requireState(next, ['submitting'], event.type);
      if (eventPayload.officialReceiptVerified !== true) throw new Error('必须验证官方成功回执');
      next.state = 'submitted-verified';
      next.terminal = true;
      break;
    case 'OFFICIAL_SUCCESS_RECONCILE':
      requireState(next, ['unknown-submit-state-no-repeat'], event.type);
      if (eventPayload.officialReceiptVerified !== true) throw new Error('reconcile 必须有官方成功回执');
      next.state = 'submitted-verified';
      next.terminal = true;
      break;
    case 'SUBMIT_UNKNOWN':
      requireState(next, ['submitting'], event.type);
      next.state = 'unknown-submit-state-no-repeat';
      next.terminal = true;
      break;
    case 'SECURITY_HARD_STOP':
      next.state = 'security-hard-stop';
      next.terminal = true;
      break;
    case 'UNSUPPORTED_FACT_HARD_STOP':
      next.state = 'unsupported-fact-hard-stop';
      next.terminal = true;
      break;
    case 'ACCOUNT_UNKNOWN':
      next.state = 'unknown-account-state-no-repeat';
      next.terminal = true;
      break;
    case 'SKIP':
      next.state = 'skipped';
      next.terminal = true;
      break;
    case 'PARK':
      next.state = 'parked';
      break;
    default:
      throw new Error(`未知事件：${event.type}`);
  }

  const now = new Date().toISOString();
  const receipt = {
    eventId: randomUUID(),
    applicationId: next.applicationId,
    candidateId: next.candidateId,
    eventType: event.type,
    idempotencyKey: eventIdempotencyKey,
    expectedStateVersion: expected,
    resultingState: next.state,
    payloadHash: sha256(JSON.stringify(eventPayload)),
    actor: event.actor || 'codex',
    createdAt: now
  };
  next.events.push(receipt);
  next.stateVersion += 1;
  next.updatedAt = now;
  return { application: next, receipt };
}

export function buildSubmitReviewManifest(application, { finalButtonLabel, expiresInMinutes = 30 } = {}) {
  if (application.state !== 'submit-review-required') throw new Error('只有 submit-review-required 可生成 Gate 2 manifest');
  requireHash(application.resumeVersionSha, 'resumeVersionSha');
  requireHash(application.formSnapshotSha, 'formSnapshotSha');
  assertArtifactLock(application);
  if (!Number.isFinite(expiresInMinutes) || expiresInMinutes <= 0) throw new Error('expiresInMinutes 必须为正数');
  return {
    candidateId: application.candidateId,
    officialUrlHash: sha256(application.officialUrl),
    resumeVersionSha: application.resumeVersionSha,
    answerSnapshotSha: application.answerSnapshotSha,
    artifactManifestSha: application.artifactManifestSha,
    formSnapshotSha: application.formSnapshotSha,
    finalButtonLabel: finalButtonLabel || 'Submit application',
    stateVersion: application.stateVersion,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
  };
}
