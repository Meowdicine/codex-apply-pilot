import { candidateIdentityFromRecord, hashCanonical, hashDocument, sha256 } from './candidate-integrity.mjs';
import { rejectSecretValue } from './questionnaire.mjs';

const SUPPORTED = new Set(['direct', 'equivalent', 'soft-skill-supported']);
const KINDS = new Set(['skills', 'experience', 'project', 'headline']);
const ACTIONS = new Set(['append-skill', 'replace-text', 'append-bullet']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function timestamp(value, field) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${field} 必须是有效时间`);
  return Date.parse(value);
}

function digest(value, field) {
  requireValue(/^[a-f0-9]{64}$/.test(value || ''), `${field} 必须是 SHA-256`);
}

function text(value, field) {
  requireValue(typeof value === 'string' && value.trim(), `${field} 不能为空`);
  requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value), `${field} 含不可见控制字符`);
  rejectSecretValue('resume-content', value);
  return value;
}

export function readableResume(bytes) {
  const value = Buffer.from(bytes).toString('utf8');
  requireValue(Buffer.from(value).equals(Buffer.from(bytes)), '简历 source 必须是 UTF-8 Markdown 或 plain text');
  requireValue(!value.startsWith('%PDF-') && !value.startsWith('PK'), '请提供可编辑文本 source；PDF/DOCX 应先由用户通过官方功能导出可编辑内容');
  return text(value, 'resume source');
}

function normalized(value) {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function containsKeyword(content, keyword) {
  const escaped = normalized(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}_+#])${escaped}(?![\\p{L}\\p{N}_+#])`, 'u').test(normalized(content));
}

export function optimizationPolicy(input) {
  const policy = {
    metric: 'keyword-match', maxIterations: 3, maxEditsPerRound: 5,
    maxStagnantRounds: 2, minImprovement: 1, maximumFeedbackAgeHours: 24,
    onBelowMinimum: 'park', ...input
  };
  for (const key of ['targetScore', 'minimumScore']) {
    requireValue(typeof policy[key] === 'number' && Number.isFinite(policy[key]) && policy[key] >= 0 && policy[key] <= 100,
      `${key} 必须由用户配置为 0-100，不能使用通用 ATS 及格线`);
  }
  requireValue(policy.minimumScore <= policy.targetScore, 'minimumScore 不能高于 targetScore');
  for (const key of ['maxIterations', 'maxEditsPerRound', 'maxStagnantRounds']) {
    requireValue(Number.isInteger(policy[key]) && policy[key] > 0 && policy[key] <= 20, `${key} 必须为 1-20`);
  }
  requireValue(['keyword-match', 'resume-score'].includes(policy.metric), 'metric 必须区分 keyword-match 与 resume-score');
  requireValue(['park', 'skip'].includes(policy.onBelowMinimum), 'onBelowMinimum 必须为 park 或 skip');
  requireValue(Number.isFinite(policy.minImprovement) && policy.minImprovement >= 0 && policy.minImprovement <= 100, 'minImprovement 无效');
  requireValue(Number.isFinite(policy.maximumFeedbackAgeHours) && policy.maximumFeedbackAgeHours > 0 && policy.maximumFeedbackAgeHours <= 168,
    'maximumFeedbackAgeHours 必须在 0-168 之间');
  if (policy.autoAppendSkills) {
    text(policy.autoAppendSkills.sectionHeading, 'autoAppendSkills.sectionHeading');
    text(policy.autoAppendSkills.lineAnchor, 'autoAppendSkills.lineAnchor');
    requireValue(!/[\r\n]/.test(policy.autoAppendSkills.lineAnchor), 'autoAppendSkills 只能使用单行 anchor');
  }
  return policy;
}

function seal(optimization) {
  optimization.sessionSha256 = hashDocument(optimization, 'sessionSha256');
  return optimization;
}

function approved(entry, field) {
  requireValue(entry.reviewedBy === 'user', `${field} 必须有 user review`);
  timestamp(entry.reviewedAt, `${field}.reviewedAt`);
}

export function startResumeOptimization({ application, baselineText, jdText, baselineCatalog, plan, evidenceSources, policy, now = new Date().toISOString() }) {
  requireValue(application.schemaVersion === 2 && application.state === 'resume-preparing' && !application.terminal
    && application.submitAttemptCount === 0 && !application.submitIntent, '仅未消费提交权限的 resume-preparing 候选可启动优化');
  const identity = candidateIdentityFromRecord(application);
  const createdAt = new Date(timestamp(now, 'now')).toISOString();
  text(baselineText, 'baselineText');
  text(jdText, 'jdText');
  requireValue(plan.schemaVersion === 1 && plan.candidateId === application.candidateId, 'plan candidate binding 不匹配');
  requireValue(plan.officialUrlSha256 === sha256(application.officialUrl), 'plan official URL binding 不匹配');
  requireValue(plan.jdSha256 === sha256(jdText), 'plan official JD hash 不匹配');
  const baselineSha256 = sha256(baselineText);
  const baseline = baselineCatalog.baselines?.find((item) => item.id === plan.baselineId);
  requireValue(baseline?.immutable === true && baseline.artifactSha256 === baselineSha256
    && baseline.scope !== 'candidate', 'baseline 必须来自已登记且未污染的 immutable reference');
  timestamp(baseline.approvedAt, 'baseline.approvedAt');
  requireValue(Array.isArray(plan.evidence) && Array.isArray(plan.edits), 'plan 必须包含 evidence 与 edits');
  const evidenceIds = new Set();
  const evidence = plan.evidence.map((item) => {
    requireValue(typeof item.id === 'string' && item.id.trim() && !evidenceIds.has(item.id), 'evidence ID 缺失或重复');
    evidenceIds.add(item.id);
    requireValue(['approved-baseline', 'verified-material', 'user-confirmed'].includes(item.sourceType), '禁止使用其他候选 package 作为经历来源');
    approved(item, `evidence ${item.id}`);
    const source = evidenceSources[item.id];
    requireValue(typeof source === 'string' && sha256(source) === item.sourceSha256, `evidence ${item.id} source hash 不匹配`);
    requireValue(source.includes(text(item.excerpt, 'evidence excerpt')), `evidence ${item.id} excerpt 不在核验来源中`);
    if (item.sourceType === 'approved-baseline') requireValue(item.sourceSha256 === baselineSha256, 'approved-baseline evidence 必须绑定当前 baseline');
    requireValue(Array.isArray(item.supportedKeywords) && item.supportedKeywords.every((word) => typeof word === 'string' && word.trim()), 'supportedKeywords 无效');
    requireValue(Array.isArray(item.approvedWording) && item.approvedWording.every((word) => typeof word === 'string' && word.trim()), 'approvedWording 无效');
    if (item.expiresAt) requireValue(timestamp(item.expiresAt, 'evidence.expiresAt') > timestamp(now, 'now'), 'evidence 已过期');
    return {
      id: item.id, sourceType: item.sourceType, sourceSha256: item.sourceSha256, excerpt: item.excerpt,
      supportedKeywords: item.supportedKeywords, approvedWording: item.approvedWording,
      semanticEquivalenceConfirmed: item.semanticEquivalenceConfirmed === true,
      canListAsSkill: item.canListAsSkill === true,
      keywordCategory: item.keywordCategory || null,
      reviewedBy: 'user', reviewedAt: item.reviewedAt, expiresAt: item.expiresAt || null
    };
  });
  const editIds = new Set();
  const edits = plan.edits.map((item) => {
    requireValue(typeof item.id === 'string' && item.id.trim() && !editIds.has(item.id), 'edit ID 缺失或重复');
    editIds.add(item.id);
    text(item.keyword, 'keyword');
    requireValue(!/[\r\n<>]/.test(item.keyword) && item.keyword.length <= 100, 'keyword 必须是单行短语');
    requireValue([...SUPPORTED, 'unsupported', 'unknown'].includes(item.classification), 'classification 无效');
    if (!SUPPORTED.has(item.classification)) return { id: item.id, keyword: item.keyword, classification: item.classification };
    approved(item, `edit ${item.id}`);
    requireValue(KINDS.has(item.kind) && ACTIONS.has(item.action), 'edit kind/action 无效');
    const fact = evidence.find((entry) => entry.id === item.evidenceId);
    requireValue(fact && fact.supportedKeywords.some((word) => normalized(word) === normalized(item.keyword)), 'keyword 缺少已批准经历映射');
    if (item.classification === 'direct') requireValue(containsKeyword(fact.excerpt, item.keyword), 'direct keyword 必须出现在原始 evidence excerpt');
    if (item.classification === 'equivalent') requireValue(fact.semanticEquivalenceConfirmed, 'equivalent 映射必须由用户明确确认');
    if (item.classification === 'soft-skill-supported') requireValue(['experience', 'project'].includes(item.kind), 'soft skill 只能进入有事实支持的经历或项目');
    text(item.sectionHeading, 'sectionHeading');
    text(item.before, 'before');
    let after = item.after;
    if (item.action === 'append-skill') {
      requireValue(item.kind === 'skills' && !/[\r\n]/.test(item.before), 'append-skill 必须绑定单行 Skills anchor');
      after = `${item.before.trimEnd()}, ${item.keyword}`;
    } else {
      text(after, 'after');
      requireValue(!/[<>]/.test(after), 'after 不允许 HTML/隐藏内容');
      requireValue(fact.approvedWording.includes(after) || fact.excerpt.includes(after), 'after 必须来自已核验或用户批准的原文措辞');
      requireValue(containsKeyword(after, item.keyword), 'after 未包含目标 keyword');
      if (item.action === 'append-bullet') requireValue(/^[-*] /.test(after), 'append-bullet 必须是普通 bullet');
      const beforeNumbers = item.before.match(/\d+(?:[.,]\d+)?%?/g) || [];
      const afterNumbers = after.match(/\d+(?:[.,]\d+)?%?/g) || [];
      if (item.action === 'replace-text') requireValue(beforeNumbers.every((value) => afterNumbers.includes(value)), '不能删除原有 dates/metrics');
      requireValue(afterNumbers.every((value) => beforeNumbers.includes(value) || (item.allowNumericChange === true && fact.excerpt.includes(value))), '新增 metrics 必须有来源与显式批准');
    }
    return {
      id: item.id, keyword: item.keyword, classification: item.classification,
      evidenceId: item.evidenceId, kind: item.kind, action: item.action,
      sectionHeading: item.sectionHeading, before: item.before, after,
      reviewedBy: 'user', reviewedAt: item.reviewedAt
    };
  });
  return seal({
    schemaVersion: 1, sessionType: 'resume-score-optimization', applicationId: application.applicationId,
    candidateId: application.candidateId, candidateIdentitySha256: hashCanonical(identity),
    officialUrlSha256: sha256(application.officialUrl), jdSha256: sha256(jdText), jdText,
    baselineId: baseline.id, baselineSha256, boundStateVersion: application.stateVersion,
    policy: optimizationPolicy(policy), evidence, edits,
    planSha256: hashCanonical({ evidence, edits }), status: 'awaiting-score', stopReason: null,
    iterationCount: 0, stagnantRounds: 0, currentText: baselineText, currentResumeSha256: baselineSha256,
    currentDraftCreatedAt: createdAt, appliedEditIds: [], observations: [], rounds: [], best: null,
    recommendedResumeSha256: null, readyForQa: false, createdAt, updatedAt: createdAt,
    previousSessionSha256: null
  });
}

export function assertOptimizationSession(optimization, application, now = new Date().toISOString(), requireState = true) {
  requireValue(optimization?.sessionSha256 === hashDocument(optimization, 'sessionSha256'), 'optimization session content hash 不匹配');
  requireValue(optimization.applicationId === application.applicationId && optimization.candidateId === application.candidateId
    && optimization.candidateIdentitySha256 === hashCanonical(candidateIdentityFromRecord(application))
    && optimization.officialUrlSha256 === sha256(application.officialUrl), 'optimization session candidate binding 已漂移');
  requireValue(sha256(optimization.currentText) === optimization.currentResumeSha256, 'optimization current draft hash 不匹配');
  requireValue(hashCanonical({ evidence: optimization.evidence, edits: optimization.edits }) === optimization.planSha256, 'optimization plan hash 不匹配');
  if (requireState) requireValue(application.state === 'resume-preparing' && !application.terminal
    && application.submitAttemptCount === 0 && !application.submitIntent && application.stateVersion === optimization.boundStateVersion,
  'candidate state/version 已改变，禁止继续旧优化记录');
  for (const entry of optimization.evidence) if (entry.expiresAt) requireValue(timestamp(entry.expiresAt, 'evidence.expiresAt') > timestamp(now, 'now'), 'evidence 已过期');
  return optimization;
}

function sectionContains(content, edit) {
  if (/[\r\n]/.test(edit.sectionHeading)) return false;
  const escaped = edit.sectionHeading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headings = [...content.matchAll(new RegExp(`^${escaped}\\r?$`, 'gm'))];
  if (headings.length !== 1) return false;
  const start = headings[0].index;
  const headingEnd = content.indexOf('\n', start);
  const remaining = content.slice(headingEnd < 0 ? content.length : headingEnd + 1);
  const next = remaining.search(/^#{1,6}\s|^[^\r\n]+\n[-=]{3,}\s*$/m);
  const end = next < 0 ? content.length : headingEnd + 1 + next;
  const anchor = content.indexOf(edit.before);
  const anchorEnd = anchor + edit.before.length;
  return anchor >= start && anchorEnd <= end && content.indexOf(edit.before, anchor + 1) < 0
    && (anchor === 0 || content[anchor - 1] === '\n')
    && (anchorEnd === content.length || /[\r\n]/.test(content[anchorEnd]));
}

function automaticSkillEdit(optimization, keyword) {
  const placement = optimization.policy.autoAppendSkills;
  if (!placement) return null;
  const fact = optimization.evidence.find((item) => item.canListAsSkill && item.keywordCategory === 'technical'
    && item.supportedKeywords.some((word) => normalized(word) === normalized(keyword))
    && containsKeyword(item.excerpt, keyword));
  if (!fact) return null;
  const lines = optimization.currentText.split(/\r?\n/).filter((line) => line === placement.lineAnchor
    || line.startsWith(`${placement.lineAnchor}, `));
  if (lines.length !== 1) return null;
  const edit = {
    id: `${fact.id}:auto-skill:${sha256(keyword)}`, keyword, classification: 'direct', evidenceId: fact.id,
    kind: 'skills', action: 'append-skill', sectionHeading: placement.sectionHeading,
    before: lines[0], after: `${lines[0]}, ${keyword}`
  };
  return sectionContains(optimization.currentText, edit) ? edit : null;
}

function finish(optimization, reason) {
  optimization.status = 'stopped';
  optimization.stopReason = reason;
  optimization.recommendedResumeSha256 = optimization.best.resumeSha256;
  optimization.readyForQa = optimization.best.score >= optimization.policy.minimumScore;
  if (!optimization.readyForQa) optimization.status = 'below-minimum';
  return optimization;
}

export function optimizeFromScore({ optimization, application, feedback, recheckOnly = false, recommendedText = null, now = new Date().toISOString() }) {
  assertOptimizationSession(optimization, application, now);
  const canRecheck = recheckOnly && optimization.status === 'stopped' && optimization.readyForQa;
  requireValue(canRecheck || (!recheckOnly && optimization.status === 'awaiting-score'), 'optimization session 已停止，禁止重置迭代计数或继续旧反馈');
  const expectedResumeSha256 = canRecheck ? optimization.recommendedResumeSha256 : optimization.currentResumeSha256;
  if (canRecheck) requireValue(typeof recommendedText === 'string' && sha256(recommendedText) === expectedResumeSha256, 'recheck 推荐 draft hash 不匹配');
  const observedAt = timestamp(feedback.observedAt, 'feedback.observedAt');
  const nowMs = timestamp(now, 'now');
  requireValue(feedback.schemaVersion === 1 && feedback.provider === 'simplify' && feedback.confirmedBy === 'user', 'feedback 必须来自用户确认的官方 UI 观察');
  requireValue(feedback.metric === optimization.policy.metric, '不能混用 Keyword Match 与 Resume Score');
  requireValue(feedback.candidateId === optimization.candidateId && feedback.officialUrlSha256 === optimization.officialUrlSha256
    && feedback.jdSha256 === optimization.jdSha256 && feedback.resumeSha256 === expectedResumeSha256, 'feedback 必须绑定当前 candidate/JD/resume hash');
  requireValue(feedback.saveComplete === true && feedback.recalculationComplete === true, '必须等待保存及评分重新计算完成');
  digest(feedback.scoredArtifactSha256, 'feedback.scoredArtifactSha256');
  requireValue(feedback.sourceTextVerified === true, '必须核验官方评分版本与当前 editable source 的内容一致');
  requireValue(observedAt >= timestamp(optimization.currentDraftCreatedAt, 'draft.createdAt') && observedAt <= nowMs + 60000
    && nowMs - observedAt <= optimization.policy.maximumFeedbackAgeHours * 3600000, 'feedback 过期、来自旧版本或时间无效');
  requireValue(typeof feedback.score === 'number' && Number.isFinite(feedback.score) && feedback.score >= 0 && feedback.score <= 100, 'score 必须为 0-100');
  requireValue(Array.isArray(feedback.missingKeywords) && feedback.missingKeywords.every((item) => typeof item === 'string'
    && item.trim() && item.length <= 100 && !/[\r\n<>\[\]`]/.test(item)), 'missingKeywords 必须是单行、无 markup 的短词组 array');
  for (const keyword of feedback.missingKeywords) text(keyword, 'feedback keyword');
  const feedbackSha256 = hashCanonical(feedback);
  requireValue(!optimization.observations.some((item) => item.feedbackSha256 === feedbackSha256), '重复 score feedback，禁止再次改写');
  const next = structuredClone(optimization);
  next.previousSessionSha256 = optimization.sessionSha256;
  next.updatedAt = new Date(nowMs).toISOString();
  const observation = {
    resumeSha256: expectedResumeSha256, score: feedback.score, metric: feedback.metric,
    scoredArtifactSha256: feedback.scoredArtifactSha256,
    feedbackSha256, observedAt: feedback.observedAt, appliedEditIds: [...optimization.appliedEditIds]
  };
  next.observations.push(observation);
  if (canRecheck) {
    observation.appliedEditIds = [...optimization.best.appliedEditIds];
    next.currentText = recommendedText;
    next.currentResumeSha256 = expectedResumeSha256;
    next.appliedEditIds = [...observation.appliedEditIds];
    next.best = observation;
    return seal(finish(next, feedback.score >= next.policy.targetScore ? 'target-reached' : 'best-version-rechecked'));
  }
  const previousScore = optimization.observations.at(-1)?.score;
  if (!next.best || feedback.score > next.best.score) next.best = observation;
  if (feedback.score >= next.policy.targetScore) return seal(finish(next, 'target-reached'));
  if (previousScore !== undefined && feedback.score < previousScore) return seal(finish(next, 'score-regressed'));
  if (previousScore !== undefined) next.stagnantRounds = feedback.score - previousScore < next.policy.minImprovement ? next.stagnantRounds + 1 : 0;
  if (next.stagnantRounds >= next.policy.maxStagnantRounds) return seal(finish(next, 'stagnated'));
  if (next.iterationCount >= next.policy.maxIterations) return seal(finish(next, 'max-iterations'));

  const changes = [];
  const gaps = [];
  const missing = [...new Map(feedback.missingKeywords.map((word) => [normalized(word), word])).values()];
  for (const keyword of missing) {
    if (containsKeyword(next.currentText, keyword)) { gaps.push({ keyword, reason: 'already-present-check-provider' }); continue; }
    if (!containsKeyword(next.jdText, keyword)) { gaps.push({ keyword, reason: 'not-in-official-jd' }); continue; }
    const matching = next.edits.filter((item) => normalized(item.keyword) === normalized(keyword) && !next.appliedEditIds.includes(item.id));
    const edit = matching.find((item) => SUPPORTED.has(item.classification) && sectionContains(next.currentText, item))
      || (matching.length === 0 ? automaticSkillEdit(next, keyword) : null);
    if (!edit) { gaps.push({ keyword, reason: matching.some((item) => SUPPORTED.has(item.classification)) ? 'anchor-conflict' : 'unsupported-or-unverified' }); continue; }
    if (changes.length >= next.policy.maxEditsPerRound) { gaps.push({ keyword, reason: 'round-edit-limit' }); continue; }
    const replacement = edit.action === 'append-bullet' ? `${edit.before}\n${edit.after}` : edit.after;
    next.currentText = next.currentText.replace(edit.before, () => replacement);
    next.appliedEditIds.push(edit.id);
    changes.push({ editId: edit.id, keyword, evidenceId: edit.evidenceId, classification: edit.classification,
      beforeSha256: sha256(edit.before), afterSha256: sha256(replacement) });
  }
  next.rounds.push({ iteration: next.iterationCount + 1, feedbackSha256, sourceResumeSha256: optimization.currentResumeSha256,
    changes, gaps, createdAt: next.updatedAt });
  if (!changes.length) return seal(finish(next, 'no-safe-edits'));
  next.iterationCount += 1;
  next.currentResumeSha256 = sha256(next.currentText);
  next.currentDraftCreatedAt = next.updatedAt;
  return seal(next);
}

export function optimizationSummary(optimization) {
  return {
    status: optimization.status, stopReason: optimization.stopReason, iterationCount: optimization.iterationCount,
    metric: optimization.policy.metric, latestObservedScore: optimization.observations.at(-1)?.score ?? null,
    bestObservedScore: optimization.best?.score ?? null, targetScore: optimization.policy.targetScore,
    minimumScore: optimization.policy.minimumScore, currentResumeSha256: optimization.currentResumeSha256,
    recommendedResumeSha256: optimization.recommendedResumeSha256, sessionSha256: optimization.sessionSha256,
    recommendedArtifactSha256: optimization.readyForQa ? optimization.best.scoredArtifactSha256 : null,
    addedKeywordCount: optimization.appliedEditIds.length, gapCount: optimization.rounds.at(-1)?.gaps.length || 0,
    readyForQa: optimization.readyForQa, nextAction: optimization.status === 'awaiting-score' ? 'user-official-ui-rescore' : optimization.readyForQa ? 'content-and-artifact-qa' : optimization.policy.onBelowMinimum
  };
}
