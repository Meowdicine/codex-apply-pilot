import { missingRequiredAnswers } from './questionnaire.mjs';
import { normalizeOfficialUrl } from './candidate-integrity.mjs';

function allowlistEntry(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  const domain = normalized.replace(/^\*\./, '');
  if (domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) return null;
  return { domain, subdomains: normalized.startsWith('*.') };
}

function isActiveConsent(consent, now = Date.now()) {
  const grant = consent?.fullAutoConsent;
  if (grant?.active !== true || grant.revokedAt) return false;
  if (typeof grant.validFrom !== 'string' || typeof grant.expiresAt !== 'string') return false;
  const start = Date.parse(grant.validFrom);
  const end = Date.parse(grant.expiresAt);
  if (!Number.isFinite(now) || !Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start) return false;
  if (!Number.isInteger(grant.dailySubmitCap) || grant.dailySubmitCap <= 0) return false;
  return Array.isArray(grant.allowedDomains) && grant.allowedDomains.length > 0
    && grant.allowedDomains.every((entry) => allowlistEntry(entry));
}

export function evaluateFullAutoReadiness({ policy, catalog, answers, consent, resumeCatalog, applicationIndex }) {
  const requirements = policy.fullAuto;
  const applications = applicationIndex.applications || [];
  const verifiedSemiAuto = [...new Map(applications
    .filter((item) => item.mode === 'semi-auto' && item.state === 'submitted-verified')
    .map((item) => [item.applicationId || item.candidateId || JSON.stringify(item), item])).values()];
  const portalFamilies = new Set(verifiedSemiAuto.map((item) => item.portalFamily).filter((value) => value && value !== 'unknown'));
  const approvedBaselines = [...new Map((resumeCatalog.baselines || []).filter((item) => item.immutable === true
    && item.scope !== 'candidate' && /^[a-f0-9]{64}$/i.test(item.artifactSha256 || '')
    && Number.isFinite(Date.parse(item.approvedAt)) && Date.parse(item.approvedAt) <= Date.now())
    .map((item) => [item.artifactSha256.toLowerCase(), item])).values()];
  const baselineFamilies = new Set(approvedBaselines.map((item) => item.family).filter(Boolean));
  const unresolvedHardStops = applications.filter((item) => ['security-hard-stop', 'unsupported-fact-hard-stop', 'unknown-account-state-no-repeat', 'unknown-submit-state-no-repeat'].includes(item.state));
  const missingAnswers = missingRequiredAnswers(catalog, answers, 'full-auto');
  const answerMap = new Map((answers.answers || []).map((item) => [item.questionId, item]));
  const fullAutoOptIn = answerMap.get('automation.full-auto-opt-in');
  const capabilities = consent.capabilities || {};

  const checks = [
    ['verified-semi-auto-submissions', verifiedSemiAuto.length >= requirements.minimumVerifiedSemiAutoSubmissions, `${verifiedSemiAuto.length}/${requirements.minimumVerifiedSemiAutoSubmissions}`],
    ['approved-resume-baselines', approvedBaselines.length >= requirements.minimumApprovedResumeBaselines, `${approvedBaselines.length}/${requirements.minimumApprovedResumeBaselines}`],
    ['distinct-resume-families', baselineFamilies.size >= requirements.minimumDistinctResumeFamilies, `${baselineFamilies.size}/${requirements.minimumDistinctResumeFamilies}`],
    ['distinct-portal-families', portalFamilies.size >= requirements.minimumDistinctPortalFamilies, `${portalFamilies.size}/${requirements.minimumDistinctPortalFamilies}`],
    ['questionnaire-complete', missingAnswers.length === 0, missingAnswers.map((item) => item.id).join(', ') || 'complete'],
    ['full-auto-opt-in', fullAutoOptIn?.value === 'yes' && fullAutoOptIn?.source === 'user-explicit', fullAutoOptIn?.value || 'missing'],
    ['os-credential-store-ready', capabilities.osCredentialStoreReady === true, String(Boolean(capabilities.osCredentialStoreReady))],
    ['browser-smoke-test-passed', capabilities.browserSmokeTestPassed === true, String(Boolean(capabilities.browserSmokeTestPassed))],
    ['exactly-once-recovery-tested', capabilities.exactlyOnceRecoveryTestPassed === true, String(Boolean(capabilities.exactlyOnceRecoveryTestPassed))],
    ['dry-runs-passed', Number(capabilities.dryRunsPassed || 0) >= requirements.minimumDryRuns, `${capabilities.dryRunsPassed || 0}/${requirements.minimumDryRuns}`],
    ['unresolved-hard-stops', unresolvedHardStops.length === 0, String(unresolvedHardStops.length)],
    ['time-bounded-consent-active', isActiveConsent(consent), String(isActiveConsent(consent))]
  ].map(([id, passed, evidence]) => ({ id, passed, evidence }));

  return {
    ready: checks.every((item) => item.passed),
    evaluatedAt: new Date().toISOString(),
    checks,
    missingAnswerIds: missingAnswers.map((item) => item.id)
  };
}

export function assertDomainAllowed(consent, officialUrl) {
  if (!isActiveConsent(consent)) throw new Error('full-auto consent 未激活或已过期');
  const host = new URL(normalizeOfficialUrl(officialUrl)).hostname;
  const allowed = consent.fullAutoConsent.allowedDomains.some((domain) => {
    const entry = allowlistEntry(domain);
    return host === entry.domain || (entry.subdomains && host.endsWith(`.${entry.domain}`));
  });
  if (!allowed) throw new Error(`域名 ${host} 不在 full-auto allowlist`);
}

export function assertKnownPortal({ policy, applicationIndex }, application) {
  if (policy.fullAuto.newPortalFallsBackToSemiAuto !== false) {
    const known = application.portalFamily && application.portalFamily !== 'unknown'
      && applicationIndex.applications.some((entry) => entry.mode === 'semi-auto'
        && entry.state === 'submitted-verified' && entry.portalFamily === application.portalFamily);
    if (!known) throw new Error('新 portal family 必须使用半自动，不能继承 full-auto authority');
  }
}

export function assertDailySubmitCapacity({ consent, applicationIndex, receipts = [], now = new Date().toISOString() }) {
  const nowMs = Date.parse(now);
  if (!isActiveConsent(consent, nowMs)) throw new Error('full-auto consent 未激活或已过期');
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const attempts = new Map();
  function register(id, time = null) {
    if (typeof id !== 'string' || !id) throw new Error('submit history 缺少 applicationId');
    if (!attempts.has(id)) attempts.set(id, new Set());
    if (time !== null) {
      const parsed = Date.parse(time);
      if (!Number.isFinite(parsed) || parsed > nowMs + 60000) throw new Error('submit history 时间无效，不能确认每日上限');
      attempts.get(id).add(new Date(parsed).toISOString().slice(0, 10));
    }
  }
  for (const entry of applicationIndex.applications || []) {
    const intents = (entry.events || []).filter((event) => event.eventType === 'SUBMIT_INTENT');
    if (entry.submitAttemptCount > 0 || entry.submitIntent || intents.length
      || ['submitted-verified', 'unknown-submit-state-no-repeat'].includes(entry.state)) {
      register(entry.applicationId, entry.submitIntent?.writtenAt ?? null);
      for (const intent of intents) register(entry.applicationId, intent.createdAt);
    }
  }
  for (const receipt of receipts) if (receipt.eventType === 'SUBMIT_INTENT') register(receipt.applicationId, receipt.createdAt);
  if ([...attempts.values()].some((days) => days.size === 0)) throw new Error('submit history 不完整，不能确认每日上限');
  const used = [...attempts.values()].filter((days) => days.has(day)).length;
  const cap = consent.fullAutoConsent.dailySubmitCap;
  if (used >= cap) throw new Error(`dailySubmitCap 已耗尽：${used}/${cap} (${day} UTC)`);
  return { day, timeZone: 'UTC', used, cap, remaining: cap - used };
}
