import { createHash, randomUUID } from 'node:crypto';

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

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function normalizeOfficialUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('officialUrl 必须使用 https://');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}

export function createCandidateId({ officialUrl, employerJobId }) {
  const normalized = normalizeOfficialUrl(officialUrl);
  const url = new URL(normalized);
  return sha256(`${url.hostname}|${employerJobId || 'no-job-id'}|${normalized}`);
}

export function createApplication({ company, role, officialUrl, employerJobId = null, portalFamily = 'unknown', mode = 'semi-auto' }) {
  if (!company?.trim() || !role?.trim()) throw new Error('company 和 role 不能为空');
  if (!['semi-auto', 'full-auto'].includes(mode)) throw new Error('mode 必须是 semi-auto 或 full-auto');
  const normalizedUrl = normalizeOfficialUrl(officialUrl);
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    applicationId: randomUUID(),
    candidateId: createCandidateId({ officialUrl: normalizedUrl, employerJobId }),
    company: company.trim(),
    role: role.trim(),
    employerJobId,
    officialUrl: normalizedUrl,
    portalFamily,
    mode,
    state: 'discovered',
    stateVersion: 0,
    submitAttemptCount: 0,
    resumeVersionSha: null,
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
    case 'FORM_STAGED':
      requireState(next, ['form-staging'], event.type);
      requireHash(eventPayload.formSnapshotSha, 'formSnapshotSha');
      next.formSnapshotSha = eventPayload.formSnapshotSha.toLowerCase();
      if (next.mode === 'semi-auto') {
        next.state = 'submit-review-required';
      } else {
        next.policySubmitBinding = {
          candidateId: next.candidateId,
          officialUrlHash: sha256(next.officialUrl),
          resumeVersionSha: next.resumeVersionSha,
          formSnapshotSha: next.formSnapshotSha,
          finalButtonLabel: eventPayload.finalButtonLabel || 'Submit application',
          boundAt: new Date().toISOString()
        };
        next.state = 'submit-authorized-by-policy';
      }
      break;
    case 'SUBMIT_APPROVED': {
      requireState(next, ['submit-review-required'], event.type);
      const manifest = eventPayload.manifest;
      if (!manifest || manifest.candidateId !== next.candidateId) throw new Error('Gate 2 candidateId 不匹配');
      if (manifest.officialUrlHash !== sha256(next.officialUrl)) throw new Error('Gate 2 officialUrlHash 不匹配');
      if (manifest.resumeVersionSha !== next.resumeVersionSha) throw new Error('Gate 2 resumeVersionSha 不匹配');
      if (manifest.formSnapshotSha !== next.formSnapshotSha) throw new Error('Gate 2 formSnapshotSha 不匹配');
      if (manifest.stateVersion !== next.stateVersion) throw new Error('Gate 2 stateVersion 已漂移');
      if (!manifest.expiresAt || Date.parse(manifest.expiresAt) <= Date.now()) throw new Error('Gate 2 manifest 已过期');
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
        if (binding.formSnapshotSha !== next.formSnapshotSha) throw new Error('提交授权的 formSnapshotSha 已漂移');
        if ((eventPayload.finalButtonLabel || binding.finalButtonLabel) !== binding.finalButtonLabel) {
          throw new Error('提交授权的 finalButtonLabel 已漂移');
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
  return {
    candidateId: application.candidateId,
    officialUrlHash: sha256(application.officialUrl),
    resumeVersionSha: application.resumeVersionSha,
    formSnapshotSha: application.formSnapshotSha,
    finalButtonLabel: finalButtonLabel || 'Submit application',
    stateVersion: application.stateVersion,
    expiresAt: new Date(Date.now() + expiresInMinutes * 60_000).toISOString()
  };
}
