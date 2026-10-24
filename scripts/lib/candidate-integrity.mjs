import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { flattenQuestions, isAnswerCurrent, rejectSecretValue } from './questionnaire.mjs';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const TERMINAL_STATES = new Set([
  'submitted-verified',
  'skipped',
  'closed',
  'withdrawn',
  'security-hard-stop',
  'unsupported-fact-hard-stop',
  'unknown-account-state-no-repeat',
  'unknown-submit-state-no-repeat'
]);
const NO_REPEAT_STATES = new Set([
  'submitted-verified',
  'unknown-account-state-no-repeat',
  'unknown-submit-state-no-repeat'
]);
const TRACKING_QUERY_KEYS = new Set([
  'fbclid',
  'gclid',
  'gh_src',
  'mc_cid',
  'mc_eid',
  'ref',
  'referrer',
  'source'
]);
const SNAPSHOT_DECISIONS = new Set([
  'use-stored-answer',
  'candidate-confirmed',
  'prefer-not-to-answer',
  'not-applicable',
  'ask-user',
  'blocked-unsupported-fact'
]);
const REVIEW_ACTORS = new Set(['user', 'policy', 'codex']);
const ARTIFACT_KINDS = new Set(['resume', 'cover-letter', 'transcript', 'form-snapshot', 'other']);
const ARTIFACT_SOURCE_TYPES = new Set([
  'immutable-baseline',
  'candidate-generated',
  'user-provided',
  'portal-form'
]);
const SECRET_PROMPT_PATTERN = /\b(password|passcode|one[- ]time (?:password|code)|otp|api key|access token|refresh token|cookie|session secret)\b/i;

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON 不支持非有限数字');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  throw new Error(`canonical JSON 不支持 ${typeof value}`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonical(value) {
  return sha256(canonicalJson(value));
}

export function hashDocument(value, digestField) {
  const copy = structuredClone(value);
  delete copy[digestField];
  return hashCanonical(copy);
}

function requireSha256(value, field) {
  if (!SHA256_PATTERN.test(value || '')) throw new Error(`${field} 必须是 64 位 SHA-256`);
  return value.toLowerCase();
}

function normalizeDisplayValue(value, field, required = true) {
  const normalized = value === null || value === undefined
    ? ''
    : String(value).normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (required && !normalized) throw new Error(`${field} 不能为空`);
  return normalized || null;
}

export function normalizeLabel(value) {
  const display = normalizeDisplayValue(value, 'label');
  return display
    .toLocaleLowerCase('en-US')
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildLabel(canonical, aliases = [], { field, required = true } = {}) {
  const display = normalizeDisplayValue(canonical, field, required);
  const displays = [display, ...(Array.isArray(aliases) ? aliases : [aliases])]
    .filter((item) => item !== null && item !== undefined && String(item).trim())
    .map((item) => normalizeDisplayValue(item, `${field} alias`));
  const uniqueDisplays = [...new Map(displays.map((item) => [normalizeLabel(item), item])).values()];
  return {
    canonical: display,
    aliases: uniqueDisplays.filter((item) => item !== display),
    normalizedAliases: [...new Set(uniqueDisplays.map((item) => normalizeLabel(item)))].sort()
  };
}

function normalizeRequisitionId(value) {
  const display = normalizeDisplayValue(value, 'employerJobId', false);
  return display ? display.toLocaleUpperCase('en-US') : null;
}

export function normalizeOfficialUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:') throw new Error('officialUrl 必须使用 https://');
  if (url.username || url.password) throw new Error('officialUrl 不得包含用户名或密码');
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');

  const entries = [...url.searchParams.entries()]
    .filter(([key]) => {
      const normalizedKey = key.toLowerCase();
      return !normalizedKey.startsWith('utm_') && !TRACKING_QUERY_KEYS.has(normalizedKey);
    })
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  url.search = '';
  for (const [key, value] of entries) url.searchParams.append(key, value);
  return url.toString();
}

export function createCandidateIdV2({ officialUrl, employerJobId = null }) {
  const normalizedUrl = normalizeOfficialUrl(officialUrl);
  const host = new URL(normalizedUrl).hostname;
  const requisitionId = normalizeRequisitionId(employerJobId);
  const authority = requisitionId
    ? `official-requisition|${host}|${requisitionId}`
    : `official-url|${normalizedUrl}`;
  return sha256(`candidate-identity-v2|${authority}`);
}

export function createCandidateIdentity({
  company,
  role,
  location = null,
  officialUrl,
  employerJobId = null,
  companyAliases = [],
  roleAliases = [],
  locationAliases = []
}) {
  const normalizedUrl = normalizeOfficialUrl(officialUrl);
  const host = new URL(normalizedUrl).hostname;
  const normalizedRequisitionId = normalizeRequisitionId(employerJobId);
  const labels = {
    company: buildLabel(company, companyAliases, { field: 'company' }),
    role: buildLabel(role, roleAliases, { field: 'role' }),
    location: buildLabel(location, locationAliases, { field: 'location', required: false })
  };
  const officialRequisition = normalizedRequisitionId
    ? sha256(`official-requisition|${host}|${normalizedRequisitionId}`)
    : null;
  const officialUrlKey = sha256(`official-url|${normalizedUrl}`);
  const context = hashCanonical({
    company: labels.company.normalizedAliases,
    role: labels.role.normalizedAliases,
    location: labels.location.normalizedAliases
  });
  const canonicalId = createCandidateIdV2({ officialUrl: normalizedUrl, employerJobId });

  return {
    schemaVersion: 2,
    identityVersion: 2,
    candidateId: canonicalId,
    official: {
      host,
      normalizedUrl,
      requisitionId: normalizeDisplayValue(employerJobId, 'employerJobId', false),
      normalizedRequisitionId
    },
    labels,
    matchKeys: {
      officialRequisition,
      officialUrl: officialUrlKey,
      context
    }
  };
}

export function candidateIdentityFromRecord(record) {
  if (record?.candidateIdentity) return assertCandidateIdentity(record.candidateIdentity, record);
  if (record?.schemaVersion >= 2) throw new Error('candidate identity v2 缺失');
  const identity = createCandidateIdentity({
    company: record.company,
    role: record.role,
    location: record.location || null,
    officialUrl: record.officialUrl,
    employerJobId: record.employerJobId || null
  });
  return identity;
}

export function assertCandidateIdentity(identity, record = null) {
  if (identity?.identityVersion !== 2) throw new Error('candidate identity 必须是 v2');
  const expected = createCandidateIdentity({
    company: record ? record.company : identity.labels?.company?.canonical,
    role: record ? record.role : identity.labels?.role?.canonical,
    location: record ? record.location : identity.labels?.location?.canonical,
    officialUrl: record ? record.officialUrl : identity.official?.normalizedUrl,
    employerJobId: record && Object.hasOwn(record, 'employerJobId') ? record.employerJobId : identity.official?.requisitionId,
    companyAliases: identity.labels?.company?.aliases || [],
    roleAliases: identity.labels?.role?.aliases || [],
    locationAliases: identity.labels?.location?.aliases || []
  });
  if (canonicalJson(identity) !== canonicalJson(expected)) throw new Error('candidate identity 与重新推导的事实或 hash 不匹配');
  if (record?.candidateId && record.candidateId !== expected.candidateId) throw new Error('candidate identity candidateId 已漂移');
  return expected;
}

function labelsOverlap(left, right) {
  return left.some((value) => right.includes(value));
}

function contextMatches(left, right) {
  return labelsOverlap(left.labels.company.normalizedAliases, right.labels.company.normalizedAliases)
    && labelsOverlap(left.labels.role.normalizedAliases, right.labels.role.normalizedAliases)
    && (!left.labels.location.normalizedAliases.length || !right.labels.location.normalizedAliases.length
      || labelsOverlap(left.labels.location.normalizedAliases, right.labels.location.normalizedAliases));
}

function isNoRepeatEvidence(item) {
  return item.submitAttemptCount > 0 || item.submitIntent || NO_REPEAT_STATES.has(item.state);
}

function terminalFinding(item, evidence) {
  if (isNoRepeatEvidence(item)) {
    return {
      code: 'prior-submit-or-unknown-no-repeat',
      severity: 'stop-no-repeat',
      applicationId: item.applicationId || null,
      candidateId: item.candidateId || null,
      state: item.state || null,
      evidence
    };
  }
  return {
    code: 'prior-terminal-candidate',
    severity: 'stop-terminal',
    applicationId: item.applicationId || null,
    candidateId: item.candidateId || null,
    state: item.state || null,
    evidence
  };
}

export function runTerminalFirstPreflight({
  identity,
  applicationIndex,
  receipts = [],
  currentApplication = null,
  checkedAt = new Date().toISOString()
}) {
  assertCandidateIdentity(identity);
  const parsedCheckedAt = new Date(checkedAt);
  if (Number.isNaN(parsedCheckedAt.valueOf())) throw new Error('checkedAt 必须是有效时间');

  const findings = [];
  const strongApplicationIds = new Set();
  const applications = Array.isArray(applicationIndex) ? applicationIndex : applicationIndex?.applications || [];
  const currentApplicationId = currentApplication?.applicationId || null;

  if (currentApplication) {
    strongApplicationIds.add(currentApplication.applicationId);
    if (currentApplication.submitAttemptCount > 0 || currentApplication.submitIntent) {
      findings.push(terminalFinding(currentApplication, 'current-application-submit-authority-consumed'));
    } else if (currentApplication.terminal || TERMINAL_STATES.has(currentApplication.state)) {
      findings.push(terminalFinding(currentApplication, 'current-application-terminal-state'));
    }
  }

  for (const item of applications) {
    if (item.applicationId === currentApplicationId) continue;
    let observed;
    try {
      observed = candidateIdentityFromRecord(item);
    } catch {
      findings.push({
        code: 'unreadable-candidate-identity',
        severity: 'stop-terminal',
        applicationId: item.applicationId || null,
        candidateId: item.candidateId || null,
        state: item.state || null,
        evidence: 'candidate-index-record-could-not-be-normalized'
      });
      continue;
    }

    const exactCandidate = item.candidateId === identity.candidateId || observed.candidateId === identity.candidateId;
    const requisitionCollision = Boolean(
      identity.matchKeys.officialRequisition
      && observed.matchKeys.officialRequisition === identity.matchKeys.officialRequisition
    );
    const urlCollision = observed.matchKeys.officialUrl === identity.matchKeys.officialUrl;
    const strongCollision = exactCandidate || requisitionCollision || urlCollision;

    if (strongCollision) {
      strongApplicationIds.add(item.applicationId);
      if (item.terminal || TERMINAL_STATES.has(item.state) || isNoRepeatEvidence(item)) {
        findings.push(terminalFinding(item, exactCandidate ? 'candidate-id-match' : 'official-source-match'));
      } else if (exactCandidate) {
        findings.push({
          code: 'active-candidate-already-exists',
          severity: 'stop-duplicate',
          applicationId: item.applicationId,
          candidateId: item.candidateId,
          state: item.state,
          evidence: 'candidate-id-match'
        });
      } else {
        findings.push({
          code: 'strong-identity-collision',
          severity: 'review-collision',
          applicationId: item.applicationId,
          candidateId: item.candidateId,
          state: item.state,
          evidence: requisitionCollision ? 'official-requisition-match' : 'official-url-match'
        });
      }
      continue;
    }

    if (contextMatches(observed, identity)) {
      findings.push({
        code: 'context-identity-collision',
        severity: 'review-collision',
        applicationId: item.applicationId,
        candidateId: item.candidateId,
        state: item.state,
        evidence: 'company-role-location-alias-match'
      });
    }
  }

  for (const receipt of receipts) {
    const relevant = receipt.candidateId === identity.candidateId
      || strongApplicationIds.has(receipt.applicationId);
    if (!relevant) continue;
    if (receipt.eventType === 'SUBMIT_INTENT') {
      findings.push({
        code: 'submit-intent-receipt-exists',
        severity: 'stop-no-repeat',
        applicationId: receipt.applicationId || null,
        candidateId: receipt.candidateId || null,
        state: receipt.resultingState || null,
        evidence: receipt.eventId || 'receipt-ledger'
      });
    } else if (NO_REPEAT_STATES.has(receipt.resultingState)) {
      findings.push({
        code: 'terminal-no-repeat-receipt-exists',
        severity: 'stop-no-repeat',
        applicationId: receipt.applicationId || null,
        candidateId: receipt.candidateId || null,
        state: receipt.resultingState,
        evidence: receipt.eventId || 'receipt-ledger'
      });
    } else if (TERMINAL_STATES.has(receipt.resultingState)) {
      findings.push({
        code: 'terminal-receipt-exists',
        severity: 'stop-terminal',
        applicationId: receipt.applicationId || null,
        candidateId: receipt.candidateId || null,
        state: receipt.resultingState,
        evidence: receipt.eventId || 'receipt-ledger'
      });
    }
  }

  const uniqueFindings = [...new Map(findings.map((item) => [canonicalJson(item), item])).values()]
    .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
  const severities = new Set(uniqueFindings.map((item) => item.severity));
  let decision = 'proceed';
  if (severities.has('stop-no-repeat')) decision = 'stop-no-repeat';
  else if (severities.has('stop-terminal')) decision = 'stop-terminal';
  else if (severities.has('stop-duplicate')) decision = 'stop-duplicate';
  else if (severities.has('review-collision')) decision = 'review-collision';

  const report = {
    schemaVersion: 1,
    reportType: 'terminal-first-preflight',
    candidateId: identity.candidateId,
    candidateIdentitySha256: hashCanonical(identity),
    checkedAt: parsedCheckedAt.toISOString(),
    decision,
    safeToProceed: decision === 'proceed',
    findings: uniqueFindings,
    collisionReview: null
  };
  report.collisionFingerprintSha256 = hashCanonical({
    candidateIdentitySha256: report.candidateIdentitySha256,
    findings: report.findings
  });
  report.preflightReportSha256 = hashDocument(report, 'preflightReportSha256');
  return report;
}

export function applyCollisionReview(report, review) {
  if (report.preflightReportSha256 !== hashDocument(report, 'preflightReportSha256')) {
    throw new Error('preflight report hash 不匹配');
  }
  if (report.decision !== 'review-collision') {
    throw new Error('collision review 只能处理 review-collision，不能覆盖 terminal/no-repeat/duplicate');
  }
  if (review?.preflightReportSha256 !== report.preflightReportSha256
    && (!review?.collisionFingerprintSha256 || review.collisionFingerprintSha256 !== report.collisionFingerprintSha256)) {
    throw new Error('collision review 未绑定当前 preflight report');
  }
  if (review?.candidateId !== report.candidateId) throw new Error('collision review candidateId 不匹配');
  if (review?.reviewedBy !== 'user' || review?.decision !== 'distinct-candidate') {
    throw new Error('collision review 必须由用户明确确认 distinct-candidate');
  }
  const reviewedAt = new Date(review.reviewedAt);
  if (Number.isNaN(reviewedAt.valueOf())) throw new Error('collision review reviewedAt 无效');
  const reason = normalizeDisplayValue(review.reason, 'collision review reason');
  const reviewed = {
    ...report,
    decision: 'proceed-reviewed-collision',
    safeToProceed: true,
    collisionReview: {
      sourcePreflightReportSha256: report.preflightReportSha256,
      collisionFingerprintSha256: report.collisionFingerprintSha256,
      candidateId: report.candidateId,
      reviewedBy: 'user',
      reviewedAt: reviewedAt.toISOString(),
      decision: 'distinct-candidate',
      reason
    }
  };
  reviewed.preflightReportSha256 = hashDocument(reviewed, 'preflightReportSha256');
  return reviewed;
}

export function normalizeSemanticKey(value) {
  const normalized = normalizeDisplayValue(value, 'semanticKey')
    .toLocaleLowerCase('en-US')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!normalized) throw new Error('semanticKey 归一化后为空');
  if (/(?:^|[.-])(password|otp|token|cookie|secret)(?:$|[.-])/.test(normalized)) {
    throw new Error('秘密字段不得进入 candidate answer snapshot');
  }
  return normalized;
}

function normalizeReview(entry, defaults) {
  const reviewedBy = entry.reviewedBy || defaults.reviewedBy;
  const reviewedAtValue = entry.reviewedAt || defaults.reviewedAt;
  if (!REVIEW_ACTORS.has(reviewedBy)) throw new Error(`无效 reviewedBy：${reviewedBy || 'missing'}`);
  const reviewedAt = new Date(reviewedAtValue);
  if (Number.isNaN(reviewedAt.valueOf())) throw new Error('reviewedAt 必须是有效时间');
  return { reviewedBy, reviewedAt: reviewedAt.toISOString() };
}

function buildAnswerBinding(value, metadata, storeValue) {
  rejectSecretValue(metadata.questionId || 'candidate-answer', value);
  const binding = {
    storage: storeValue ? 'inline' : 'hash-only',
    valueSha256: hashCanonical(value),
    source: metadata.source,
    questionId: metadata.questionId || null,
    questionRevision: metadata.questionRevision || null,
    answerScope: metadata.answerScope || null,
    sensitivity: metadata.sensitivity || 'ordinary',
    automationPolicy: metadata.automationPolicy || 'ask-each-time',
    verifiedAt: metadata.verifiedAt || null,
    expiresAt: metadata.expiresAt || null
  };
  if (storeValue) binding.value = structuredClone(value);
  return binding;
}

export function buildCandidateAnswerSnapshot({
  application,
  answerDocument,
  questionSet,
  catalog = null,
  createdAt = new Date().toISOString()
}) {
  if (!application?.candidateId) throw new Error('candidate answer snapshot 缺少 application');
  const questions = Array.isArray(questionSet) ? questionSet : questionSet?.questions;
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('questions-file 必须包含非空 questions');
  const created = new Date(createdAt);
  if (Number.isNaN(created.valueOf())) throw new Error('createdAt 必须是有效时间');
  const createdIso = created.toISOString();
  const answers = new Map((answerDocument?.answers || []).map((item) => [item.questionId, item]));
  const defaults = {
    reviewedBy: questionSet?.reviewedBy,
    reviewedAt: questionSet?.reviewedAt
  };

  const entries = questions.map((item, index) => {
    const prompt = typeof item.prompt === 'string' ? item.prompt : '';
    if (!prompt.trim()) throw new Error(`questions[${index}].prompt 不能为空`);
    if (SECRET_PROMPT_PATTERN.test(prompt)) throw new Error(`questions[${index}] 涉及秘密，拒绝快照`);
    const semanticKey = normalizeSemanticKey(item.semanticKey);
    if (!SNAPSHOT_DECISIONS.has(item.decision)) throw new Error(`${semanticKey} 的 decision 无效`);
    const review = normalizeReview(item, defaults);
    let answer = null;

    if (item.decision === 'use-stored-answer') {
      const stored = answers.get(item.answerQuestionId);
      if (!stored) throw new Error(`${semanticKey} 缺少已验证答案 ${item.answerQuestionId || ''}`.trim());
      if (stored.value === null || stored.value === undefined || stored.value === ''
        || (typeof stored.value === 'object' && !Object.keys(stored.value).length)
        || stored.automationPolicy === 'never-store') throw new Error(`${semanticKey} 的已存答案不可复用`);
      if (['protected', 'legal-material'].includes(stored.sensitivity)
        && !['user-explicit', 'prefer-not-to-answer'].includes(stored.source)) throw new Error(`${semanticKey} 缺少用户明确回答`);
      if (catalog) {
        const definition = flattenQuestions(catalog).find((entry) => entry.id === stored.questionId);
        if (!definition || !isAnswerCurrent(definition, stored, created.valueOf())) throw new Error(`${semanticKey} 的答案不符合当前 catalog 或已过期`);
      }
      if (!Number.isInteger(item.answerQuestionRevision) || item.answerQuestionRevision < 1
        || stored.questionRevision !== item.answerQuestionRevision) {
        throw new Error(`${semanticKey} 的 answer question revision 已漂移`);
      }
      if (!Number.isFinite(Date.parse(stored.verifiedAt))) throw new Error(`${semanticKey} 缺少有效 verifiedAt`);
      if (stored.expiresAt && (!Number.isFinite(Date.parse(stored.expiresAt)) || Date.parse(stored.expiresAt) <= created.valueOf())) {
        throw new Error(`${semanticKey} 的已存答案已过期`);
      }
      const requiresUserReview = ['protected', 'legal-material'].includes(stored.sensitivity)
        || stored.automationPolicy !== 'auto-fill';
      if (requiresUserReview && review.reviewedBy !== 'user') {
        throw new Error(`${semanticKey} 必须由用户逐候选审核`);
      }
      const storeValue = item.storeValue !== false
        && !['protected', 'legal-material'].includes(stored.sensitivity)
        && stored.automationPolicy !== 'never-store';
      answer = buildAnswerBinding(stored.value, stored, storeValue);
    } else if (item.decision === 'candidate-confirmed') {
      if (!Object.hasOwn(item, 'value') || item.value === null) throw new Error(`${semanticKey} 缺少 candidate-confirmed value`);
      if (review.reviewedBy !== 'user') throw new Error(`${semanticKey} candidate-confirmed 必须由用户审核`);
      const metadata = {
        source: 'candidate-user-explicit',
        questionId: item.answerQuestionId || null,
        questionRevision: item.answerQuestionRevision || null,
        answerScope: 'candidate',
        sensitivity: item.sensitivity || 'ordinary',
        automationPolicy: 'ask-each-time',
        verifiedAt: review.reviewedAt,
        expiresAt: null
      };
      const storeValue = item.storeValue !== false
        && !['protected', 'legal-material'].includes(metadata.sensitivity);
      answer = buildAnswerBinding(item.value, metadata, storeValue);
    } else if (item.decision === 'prefer-not-to-answer') {
      if (review.reviewedBy !== 'user') throw new Error(`${semanticKey} prefer-not-to-answer 必须由用户审核`);
      answer = buildAnswerBinding('prefer-not-to-answer', {
        source: 'prefer-not-to-answer',
        questionId: item.answerQuestionId || null,
        questionRevision: item.answerQuestionRevision || null,
        answerScope: 'candidate',
        sensitivity: item.sensitivity || 'protected',
        automationPolicy: 'ask-each-time',
        verifiedAt: review.reviewedAt,
        expiresAt: null
      }, false);
    }

    return {
      portalQuestionId: item.portalQuestionId || null,
      prompt,
      promptSha256: sha256(prompt),
      semanticKey,
      decision: item.decision,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      answer
    };
  });

  const unresolved = entries
    .filter((item) => ['ask-user', 'blocked-unsupported-fact'].includes(item.decision))
    .map((item) => ({ semanticKey: item.semanticKey, decision: item.decision }));
  const identity = candidateIdentityFromRecord(application);
  const snapshot = {
    schemaVersion: 1,
    snapshotType: 'candidate-answer-snapshot',
    applicationId: application.applicationId,
    candidateId: application.candidateId,
    candidateIdentitySha256: hashCanonical(identity),
    officialUrlSha256: sha256(normalizeOfficialUrl(application.officialUrl)),
    sourceAnswersSchemaVersion: answerDocument?.schemaVersion || null,
    createdAt: createdIso,
    readyForStaging: unresolved.length === 0,
    unresolved,
    questions: entries
  };
  snapshot.answerSnapshotSha256 = hashDocument(snapshot, 'answerSnapshotSha256');
  return snapshot;
}

export function assertCandidateAnswerSnapshot(snapshot, application, { now = new Date().toISOString() } = {}) {
  const identity = candidateIdentityFromRecord(application);
  if (snapshot?.answerSnapshotSha256 !== hashDocument(snapshot, 'answerSnapshotSha256')) {
    throw new Error('answer snapshot content hash 不匹配');
  }
  if (snapshot.applicationId !== application.applicationId) throw new Error('answer snapshot applicationId 不匹配');
  if (snapshot.candidateId !== application.candidateId) throw new Error('answer snapshot candidateId 不匹配');
  if (snapshot.candidateIdentitySha256 !== hashCanonical(identity)) throw new Error('answer snapshot identity binding 不匹配');
  if (snapshot.officialUrlSha256 !== sha256(normalizeOfficialUrl(application.officialUrl))) throw new Error('answer snapshot officialUrl binding 不匹配');
  if (application.answerSnapshotSha && snapshot.answerSnapshotSha256 !== application.answerSnapshotSha) {
    throw new Error('answer snapshot hash 与 application lock 不匹配');
  }
  if (snapshot.schemaVersion !== 1 || snapshot.snapshotType !== 'candidate-answer-snapshot'
    || snapshot.readyForStaging !== true || !Array.isArray(snapshot.unresolved) || snapshot.unresolved.length
    || !Array.isArray(snapshot.questions) || !snapshot.questions.length) {
    throw new Error('answer snapshot 尚未 readyForStaging');
  }
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('snapshot validation now 无效');
  for (const question of snapshot.questions) {
    if (!SNAPSHOT_DECISIONS.has(question.decision) || ['ask-user', 'blocked-unsupported-fact'].includes(question.decision)) {
      throw new Error('answer snapshot 包含未解决的 decision');
    }
    if (sha256(question.prompt) !== question.promptSha256) throw new Error('answer snapshot prompt hash 不匹配');
    if (normalizeSemanticKey(question.semanticKey) !== question.semanticKey) throw new Error('answer snapshot semanticKey 无效');
    const answer = question.answer;
    if (answer?.storage === 'inline' && hashCanonical(answer.value) !== answer.valueSha256) {
      throw new Error('answer snapshot value hash 不匹配');
    }
    if (answer?.expiresAt && (!Number.isFinite(Date.parse(answer.expiresAt)) || Date.parse(answer.expiresAt) <= nowMs)) {
      throw new Error('answer snapshot 已过期');
    }
  }
  return snapshot;
}

export function assertArtifactProvenanceManifest(manifest, application) {
  if (manifest?.artifactManifestSha256 !== hashDocument(manifest, 'artifactManifestSha256')) {
    throw new Error('artifact manifest content hash 不匹配');
  }
  const identity = candidateIdentityFromRecord(application);
  if (application.resumeOptimization && manifest.optimizationSessionSha256 !== application.resumeOptimization.sessionSha256) {
    throw new Error('artifact manifest optimization session binding 已漂移');
  }
  if (manifest.applicationId !== application.applicationId || manifest.candidateId !== application.candidateId
    || manifest.candidateIdentitySha256 !== hashCanonical(identity)
    || manifest.officialUrlSha256 !== sha256(normalizeOfficialUrl(application.officialUrl))
    || manifest.answerSnapshotSha256 !== application.answerSnapshotSha
    || manifest.resumeVersionSha256 !== application.resumeVersionSha
    || manifest.artifactManifestSha256 !== application.artifactManifestSha
    || manifest.formSnapshotSha256 !== application.artifactLock?.formSnapshotSha
    || (application.formSnapshotSha && manifest.formSnapshotSha256 !== application.formSnapshotSha)) {
    throw new Error('artifact manifest application binding 已漂移');
  }
  return manifest;
}

export async function buildArtifactProvenanceManifest({
  application,
  answerSnapshot,
  artifactPlan,
  artifactSink = null,
  createdAt = new Date().toISOString()
}) {
  if (!application?.candidateId) throw new Error('artifact provenance 缺少 application');
  assertCandidateAnswerSnapshot(answerSnapshot, application, { now: createdAt });
  const artifacts = artifactPlan?.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length === 0) throw new Error('artifacts-file 必须包含非空 artifacts');
  const created = new Date(createdAt);
  if (Number.isNaN(created.valueOf())) throw new Error('createdAt 必须是有效时间');

  const entries = [];
  for (const [index, item] of artifacts.entries()) {
    if (!ARTIFACT_KINDS.has(item.kind)) throw new Error(`artifacts[${index}].kind 无效`);
    if (!ARTIFACT_SOURCE_TYPES.has(item.sourceType)) throw new Error(`artifacts[${index}].sourceType 无效`);
    const logicalName = normalizeDisplayValue(item.logicalName, `artifacts[${index}].logicalName`);
    if (!item.file) throw new Error(`artifacts[${index}].file 不能为空`);
    const bytes = await readFile(item.file);
    const contentSha256 = sha256Buffer(bytes);
    if (artifactSink) await artifactSink(contentSha256, bytes);
    const sourceArtifactSha256 = item.sourceArtifactSha256
      ? requireSha256(item.sourceArtifactSha256, `artifacts[${index}].sourceArtifactSha256`)
      : null;
    entries.push({
      kind: item.kind,
      logicalName,
      mediaType: item.mediaType || 'application/octet-stream',
      contentSha256,
      byteLength: bytes.byteLength,
      source: {
        type: item.sourceType,
        sourceId: item.sourceId || null,
        sourceArtifactSha256,
        approvedAt: item.approvedAt || null
      }
    });
  }

  const duplicateKinds = entries
    .map((item) => item.kind)
    .filter((kind, index, all) => kind !== 'other' && all.indexOf(kind) !== index);
  if (duplicateKinds.length) throw new Error(`artifact kind 不得重复：${[...new Set(duplicateKinds)].join(', ')}`);
  const resume = entries.find((item) => item.kind === 'resume');
  const formSnapshot = entries.find((item) => item.kind === 'form-snapshot');
  if (!resume) throw new Error('artifact provenance 必须包含 resume');
  if (!formSnapshot) throw new Error('artifact provenance 必须包含 form-snapshot');
  if (resume.contentSha256 !== application.resumeVersionSha) throw new Error('resume 文件 hash 与 application.resumeVersionSha 不匹配');
  if (!resume.source.sourceArtifactSha256) throw new Error('resume provenance 必须绑定 sourceArtifactSha256');
  if (application.resumeOptimization && resume.source.sourceArtifactSha256 !== application.resumeOptimization.optimizedDraftSha256) {
    throw new Error('resume provenance 必须来自已完成 QA 的 optimized draft');
  }
  if (formSnapshot.source.type !== 'portal-form') throw new Error('form-snapshot sourceType 必须是 portal-form');

  entries.sort((left, right) => `${left.kind}|${left.logicalName}`.localeCompare(`${right.kind}|${right.logicalName}`));
  const identity = candidateIdentityFromRecord(application);
  const manifest = {
    schemaVersion: 1,
    manifestType: 'artifact-provenance-lock',
    applicationId: application.applicationId,
    candidateId: application.candidateId,
    candidateIdentitySha256: hashCanonical(identity),
    officialUrlSha256: sha256(normalizeOfficialUrl(application.officialUrl)),
    answerSnapshotSha256: answerSnapshot.answerSnapshotSha256,
    resumeVersionSha256: resume.contentSha256,
    formSnapshotSha256: formSnapshot.contentSha256,
    optimizationSessionSha256: application.resumeOptimization?.sessionSha256 || null,
    createdAt: created.toISOString(),
    artifacts: entries
  };
  manifest.artifactManifestSha256 = hashDocument(manifest, 'artifactManifestSha256');
  return manifest;
}
