import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashCanonical, sha256Buffer } from './candidate-integrity.mjs';
import { appendJsonLine, contentAddressedJsonPath, loadApplication, readJson, saveApplication, saveArtifactBytes, saveContentAddressedJson, writeJsonAtomic } from './storage.mjs';
import { transition } from './state.mjs';
import { assertOptimizationSession, optimizationSummary, optimizeFromScore, readableResume, startResumeOptimization } from './resume-optimization.mjs';

function option(options, key) {
  if (typeof options[key] !== 'string' || !options[key].trim()) throw new Error(`缺少 --${key}`);
  return options[key];
}

function headPath(paths, application) {
  return path.join(paths.optimizationDir, application.applicationId, 'head.json');
}

export async function loadOptimizationSession(paths, application, required = false) {
  let head;
  try {
    head = await readJson(headPath(paths, application));
  } catch (error) {
    if (!required && error?.code === 'ENOENT') return null;
    throw error;
  }
  const optimization = await readJson(contentAddressedJsonPath(paths.optimizationDir, application.applicationId, head.sessionSha256));
  if (optimization.sessionSha256 !== head.sessionSha256) throw new Error('optimization head hash 不匹配');
  return optimization;
}

async function persistSession(paths, application, optimization, eventType) {
  const sessionPath = await saveContentAddressedJson(paths.optimizationDir, application.applicationId, optimization.sessionSha256, optimization);
  const draftPath = await saveArtifactBytes(paths.artifactBlobsDir, optimization.currentResumeSha256, Buffer.from(optimization.currentText));
  await writeJsonAtomic(headPath(paths, application), { schemaVersion: 1, sessionSha256: optimization.sessionSha256 });
  const summary = optimizationSummary(optimization);
  await appendJsonLine(paths.receiptLedger, {
    eventId: randomUUID(), applicationId: application.applicationId, candidateId: application.candidateId,
    eventType, idempotencyKey: `${application.applicationId}:${optimization.sessionSha256}`,
    resultingState: application.state, payloadHash: hashCanonical(summary), actor: 'codex', createdAt: optimization.updatedAt
  });
  return {
    ...summary, applicationId: application.applicationId, sessionPath, draftPath,
    recommendedDraftPath: optimization.recommendedResumeSha256
      ? path.join(paths.artifactBlobsDir, optimization.recommendedResumeSha256) : null,
    recommendedArtifactPath: optimization.readyForQa
      ? path.join(paths.artifactBlobsDir, optimization.best.scoredArtifactSha256) : null
  };
}

export async function runResumeCommand({ command, paths, options, preflight }) {
  const application = await loadApplication(paths, option(options, 'application'));
  if (command === 'resume-optimize-status') {
    const optimization = await loadOptimizationSession(paths, application, true);
    assertOptimizationSession(optimization, application, new Date().toISOString(), false);
    return optimizationSummary(optimization);
  }
  await preflight(application);
  let optimization;
  if (command === 'resume-optimize-start') {
    if (await loadOptimizationSession(paths, application)) throw new Error('optimization session 已存在；不能通过重新 start 重置预算或历史');
    const planFile = path.resolve(option(options, 'plan-file'));
    const plan = await readJson(planFile);
    const baselineFile = path.resolve(option(options, 'baseline-file'));
    const [baselineBytes, jdBytes, baselineCatalog, policyDocument] = await Promise.all([
      readFile(baselineFile), readFile(path.resolve(option(options, 'jd-file'))),
      readJson(paths.resumeCatalog), readJson(paths.policy)
    ]);
    const evidenceSources = Object.create(null);
    for (const item of plan.evidence || []) {
      const sourceFile = item.sourceFile ? path.resolve(path.dirname(planFile), item.sourceFile)
        : item.sourceType === 'approved-baseline' ? baselineFile : null;
      if (!sourceFile) throw new Error('evidence 缺少 sourceFile');
      evidenceSources[item.id] = readableResume(await readFile(sourceFile));
    }
    optimization = startResumeOptimization({
      application, baselineText: readableResume(baselineBytes), jdText: readableResume(jdBytes),
      baselineCatalog, plan, evidenceSources,
      policy: { ...policyDocument.resumeOptimization, ...plan.policy }
    });
  } else {
    const current = await loadOptimizationSession(paths, application, true);
    const feedback = await readJson(path.resolve(option(options, 'feedback-file')));
    const scoredBytes = await readFile(path.resolve(option(options, 'scored-artifact-file')));
    if (sha256Buffer(scoredBytes) !== feedback.scoredArtifactSha256) throw new Error('评分 artifact 文件 hash 与 feedback 不匹配');
    const recheckOnly = options.recheck === true;
    const recommendedText = recheckOnly && current.recommendedResumeSha256
      ? readableResume(await readFile(path.join(paths.artifactBlobsDir, current.recommendedResumeSha256))) : null;
    optimization = optimizeFromScore({ optimization: current, application, feedback, recheckOnly, recommendedText });
    await saveArtifactBytes(paths.artifactBlobsDir, feedback.scoredArtifactSha256, scoredBytes);
  }
  const result = await persistSession(paths, application, optimization,
    command === 'resume-optimize-start' ? 'RESUME_OPTIMIZATION_STARTED' : 'RESUME_OPTIMIZATION_UPDATED');
  if (optimization.status === 'below-minimum') {
    const next = transition(application, {
      type: optimization.policy.onBelowMinimum === 'skip' ? 'SKIP' : 'PARK',
      payload: { reason: 'resume-optimization-below-minimum', optimizationSessionSha256: optimization.sessionSha256 },
      actor: 'codex'
    }, { expectedStateVersion: application.stateVersion });
    await saveApplication(paths, next.application);
    await appendJsonLine(paths.receiptLedger, next.receipt);
    result.candidateState = next.application.state;
  }
  return result;
}

export async function optimizationReleaseBinding(paths, application, payload) {
  const optimization = await loadOptimizationSession(paths, application);
  if (!optimization) {
    if (payload.resumeOptimization) throw new Error('禁止直接注入 resumeOptimization');
    return null;
  }
  assertOptimizationSession(optimization, application);
  if (!optimization.readyForQa || optimization.status === 'awaiting-score') throw new Error('优化尚未完成或低于最低分，不能进入 RESUME_READY');
  if (payload.optimizationSessionSha256 !== optimization.sessionSha256
    || payload.optimizedDraftSha256 !== optimization.recommendedResumeSha256 || payload.qaPassed !== true
    || payload.resumeVersionSha !== optimization.best.scoredArtifactSha256) {
    throw new Error('RESUME_READY 必须绑定当前 optimization session、推荐 draft 并确认 qaPassed');
  }
  const observedAt = Date.parse(optimization.best.observedAt);
  if (Date.now() - observedAt > optimization.policy.maximumFeedbackAgeHours * 3600000) throw new Error('最终 score observation 已过期，必须重新核验');
  const bytes = await readFile(path.join(paths.artifactBlobsDir, optimization.recommendedResumeSha256));
  if (sha256Buffer(bytes) !== optimization.recommendedResumeSha256) throw new Error('推荐 draft frozen bytes 已漂移');
  if (sha256Buffer(await readFile(path.join(paths.artifactBlobsDir, optimization.best.scoredArtifactSha256))) !== optimization.best.scoredArtifactSha256) {
    throw new Error('最终评分 artifact frozen bytes 已漂移');
  }
  return {
    sessionSha256: optimization.sessionSha256, optimizedDraftSha256: optimization.recommendedResumeSha256,
    baselineId: optimization.baselineId, baselineSha256: optimization.baselineSha256,
    jdSha256: optimization.jdSha256, feedbackSha256: optimization.best.feedbackSha256,
    provider: 'simplify', metric: optimization.policy.metric, observedScore: optimization.best.score,
    observedAt: optimization.best.observedAt, targetReached: optimization.best.score >= optimization.policy.targetScore,
    minimumSatisfied: true, qaPassed: true
  };
}
