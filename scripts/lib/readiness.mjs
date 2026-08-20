import { missingRequiredAnswers } from './questionnaire.mjs';

function isActiveConsent(consent) {
  const grant = consent?.fullAutoConsent;
  if (!grant?.active || grant.revokedAt) return false;
  const now = Date.now();
  if (!grant.validFrom || Date.parse(grant.validFrom) > now) return false;
  if (!grant.expiresAt || Date.parse(grant.expiresAt) <= now) return false;
  return Array.isArray(grant.allowedDomains) && grant.allowedDomains.length > 0;
}

export function evaluateFullAutoReadiness({ policy, catalog, answers, consent, resumeCatalog, applicationIndex }) {
  const requirements = policy.fullAuto;
  const applications = applicationIndex.applications || [];
  const verifiedSemiAuto = applications.filter((item) => item.mode === 'semi-auto' && item.state === 'submitted-verified');
  const portalFamilies = new Set(verifiedSemiAuto.map((item) => item.portalFamily).filter((value) => value && value !== 'unknown'));
  const approvedBaselines = (resumeCatalog.baselines || []).filter((item) => item.immutable === true && /^[a-f0-9]{64}$/i.test(item.artifactSha256 || ''));
  const baselineFamilies = new Set(approvedBaselines.map((item) => item.family).filter(Boolean));
  const unresolvedHardStops = applications.filter((item) => ['security-hard-stop', 'unsupported-fact-hard-stop', 'unknown-submit-state-no-repeat'].includes(item.state));
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
  const host = new URL(officialUrl).hostname.toLowerCase();
  const allowed = consent.fullAutoConsent.allowedDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/^\*\./, '');
    return host === normalized || host.endsWith(`.${normalized}`);
  });
  if (!allowed) throw new Error(`域名 ${host} 不在 full-auto allowlist`);
}
