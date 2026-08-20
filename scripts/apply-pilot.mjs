#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  appendJsonLine,
  initializeState,
  loadApplication,
  readJson,
  saveApplication,
  statePaths,
  writeJsonAtomic
} from './lib/storage.mjs';
import {
  buildSubmitReviewManifest,
  createApplication,
  transition
} from './lib/state.mjs';
import {
  flattenQuestions,
  loadQuestionnaire,
  parseAnswer,
  runInteractiveQuestionnaire,
  upsertAnswer
} from './lib/questionnaire.mjs';
import { assertDomainAllowed, evaluateFullAutoReadiness } from './lib/readiness.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const defaultStateDir = path.resolve(process.cwd(), '.apply-pilot');

function parseArguments(argv) {
  const positionals = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/s, 2);
    if (!rawKey) throw new Error('空的命令行选项');
    if (inlineValue !== undefined) {
      options[rawKey] = inlineValue;
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      options[rawKey] = argv[index + 1];
      index += 1;
    } else {
      options[rawKey] = true;
    }
  }
  return { positionals, options };
}

function requireOption(options, name) {
  const value = options[name];
  if (value === undefined || value === true || String(value).trim() === '') {
    throw new Error(`缺少必需选项 --${name}`);
  }
  return String(value);
}

function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} 必须是整数`);
  return parsed;
}

function print(value, json = false) {
  if (json || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${value}\n`);
  }
}

async function ensureInitialized(stateDir) {
  const paths = statePaths(stateDir);
  try {
    await access(paths.policy);
  } catch {
    throw new Error(`尚未初始化：请先运行 apply-pilot init --state-dir "${stateDir}"`);
  }
  return paths;
}

async function loadReadinessInputs(paths) {
  const [policy, catalog, answers, consent, resumeCatalog, applicationIndex] = await Promise.all([
    readJson(paths.policy),
    loadQuestionnaire(path.join(projectRoot, 'config', 'questionnaire.zh-CN.json')),
    readJson(paths.answers),
    readJson(paths.consent),
    readJson(paths.resumeCatalog),
    readJson(paths.applicationsIndex)
  ]);
  return { policy, catalog, answers, consent, resumeCatalog, applicationIndex };
}

async function readEventPayload(options) {
  if (options['payload-json'] && options['payload-file']) {
    throw new Error('--payload-json 与 --payload-file 只能使用一个');
  }
  if (options['payload-file']) {
    return JSON.parse(await readFile(path.resolve(String(options['payload-file'])), 'utf8'));
  }
  if (options['payload-json']) return JSON.parse(String(options['payload-json']));
  return {};
}

function helpText() {
  return `codex-apply-pilot 0.1.0

中文优先、本地优先的求职申请状态机。它不控制 Simplify DOM，也不会绕过任何安全验证。

用法：
  apply-pilot init [--state-dir PATH]
  apply-pilot questionnaire [--mode semi-auto|full-auto] [--required-only]
  apply-pilot set-answer --id QUESTION_ID --value VALUE [--explicit]
  apply-pilot status [--application APPLICATION_ID] [--json]
  apply-pilot readiness [--json]
  apply-pilot mode --set semi-auto|full-auto
  apply-pilot new-application --company NAME --role ROLE --official-url HTTPS_URL
      [--job-id ID] [--portal-family NAME] [--mode semi-auto|full-auto]
  apply-pilot event --application APPLICATION_ID --type EVENT_TYPE
      --expected-version N [--payload-json JSON|--payload-file PATH] [--idempotency-key KEY]
  apply-pilot manifest --application APPLICATION_ID [--button-label LABEL] [--expires-minutes N]
  apply-pilot doctor [--json]

默认状态目录：当前目录的 .apply-pilot（已被 .gitignore 忽略）。`;
}

async function commandInit(stateDir, options) {
  const defaultPolicy = await readJson(path.join(projectRoot, 'config', 'default-policy.json'));
  const paths = await initializeState(stateDir, defaultPolicy);
  print({ status: 'initialized', stateDirectory: paths.root, mode: defaultPolicy.mode }, Boolean(options.json));
}

async function commandQuestionnaire(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const catalog = await loadQuestionnaire(path.join(projectRoot, 'config', 'questionnaire.zh-CN.json'));
  const answerDocument = await readJson(paths.answers);
  const mode = options.mode ? String(options.mode) : (await readJson(paths.policy)).mode;
  if (!['semi-auto', 'full-auto'].includes(mode)) throw new Error('--mode 必须是 semi-auto 或 full-auto');
  await runInteractiveQuestionnaire({
    catalog,
    answerDocument,
    mode,
    requiredOnly: Boolean(options['required-only'])
  });
  await writeJsonAtomic(paths.answers, answerDocument);
  print({ status: 'saved', answerCount: answerDocument.answers.length, stateDirectory: paths.root }, Boolean(options.json));
}

async function commandSetAnswer(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const catalog = await loadQuestionnaire(path.join(projectRoot, 'config', 'questionnaire.zh-CN.json'));
  const questionId = requireOption(options, 'id');
  const question = flattenQuestions(catalog).find((item) => item.id === questionId);
  if (!question) throw new Error(`未知问题：${questionId}`);
  const answerDocument = await readJson(paths.answers);
  const value = parseAnswer(question, requireOption(options, 'value'));
  const answer = upsertAnswer(answerDocument, question, value, {
    explicit: Boolean(options.explicit),
    source: 'user-explicit'
  });
  await writeJsonAtomic(paths.answers, answerDocument);
  print({ status: 'saved', answer }, Boolean(options.json));
}

async function commandStatus(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  if (options.application) {
    print(await loadApplication(paths, String(options.application)), true);
    return;
  }
  const [policy, index] = await Promise.all([readJson(paths.policy), readJson(paths.applicationsIndex)]);
  const summary = {
    stateDirectory: paths.root,
    mode: policy.mode,
    applicationCount: index.applications.length,
    applications: index.applications
  };
  print(summary, Boolean(options.json));
}

async function commandReadiness(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const inputs = await loadReadinessInputs(paths);
  const result = evaluateFullAutoReadiness(inputs);
  print(result, Boolean(options.json));
  if (!result.ready) process.exitCode = 2;
}

async function commandMode(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const nextMode = requireOption(options, 'set');
  if (!['semi-auto', 'full-auto'].includes(nextMode)) throw new Error('--set 必须是 semi-auto 或 full-auto');
  const policy = await readJson(paths.policy);
  if (nextMode === 'full-auto') {
    const readiness = evaluateFullAutoReadiness(await loadReadinessInputs(paths));
    if (!readiness.ready) {
      const failed = readiness.checks.filter((item) => !item.passed).map((item) => item.id);
      throw new Error(`全自动准入未通过：${failed.join(', ')}`);
    }
  }
  policy.mode = nextMode;
  policy.updatedAt = new Date().toISOString();
  await writeJsonAtomic(paths.policy, policy);
  print({ status: 'mode-updated', mode: nextMode }, Boolean(options.json));
}

async function commandNewApplication(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const policy = await readJson(paths.policy);
  const mode = options.mode ? String(options.mode) : policy.mode;
  const application = createApplication({
    company: requireOption(options, 'company'),
    role: requireOption(options, 'role'),
    officialUrl: requireOption(options, 'official-url'),
    employerJobId: options['job-id'] ? String(options['job-id']) : null,
    portalFamily: options['portal-family'] ? String(options['portal-family']) : 'unknown',
    mode
  });
  const index = await readJson(paths.applicationsIndex);
  if (index.applications.some((item) => item.candidateId === application.candidateId)) {
    throw new Error(`候选已存在，拒绝重复创建：${application.candidateId}`);
  }
  if (mode === 'full-auto') {
    const readinessInputs = await loadReadinessInputs(paths);
    const readiness = evaluateFullAutoReadiness(readinessInputs);
    if (!readiness.ready) throw new Error('全自动准入未通过，不能创建 full-auto application');
    assertDomainAllowed(readinessInputs.consent, application.officialUrl);
  }
  await saveApplication(paths, application);
  print({
    status: 'created',
    applicationId: application.applicationId,
    candidateId: application.candidateId,
    state: application.state,
    mode: application.mode
  }, Boolean(options.json));
}

async function commandEvent(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const applicationId = requireOption(options, 'application');
  const current = await loadApplication(paths, applicationId);
  const payload = await readEventPayload(options);
  const expectedStateVersion = parseInteger(requireOption(options, 'expected-version'), 'expected-version');
  const event = {
    type: requireOption(options, 'type'),
    payload,
    idempotencyKey: options['idempotency-key'] ? String(options['idempotency-key']) : undefined,
    actor: options.actor ? String(options.actor) : 'codex'
  };
  const result = transition(current, event, { expectedStateVersion });
  await saveApplication(paths, result.application);
  await appendJsonLine(paths.receiptLedger, result.receipt);
  print({
    status: 'transitioned',
    applicationId,
    state: result.application.state,
    stateVersion: result.application.stateVersion,
    receipt: result.receipt
  }, Boolean(options.json));
}

async function commandManifest(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const application = await loadApplication(paths, requireOption(options, 'application'));
  const manifest = buildSubmitReviewManifest(application, {
    finalButtonLabel: options['button-label'] ? String(options['button-label']) : undefined,
    expiresInMinutes: options['expires-minutes'] ? parseInteger(options['expires-minutes'], 'expires-minutes') : 30
  });
  print(manifest, true);
}

async function commandDoctor(stateDir, options) {
  const paths = await ensureInitialized(stateDir);
  const policy = await readJson(paths.policy);
  const findings = [];
  if (policy.simplify?.allowDomAutomation !== false || policy.simplify?.allowPrivateApi !== false || policy.simplify?.allowScraping !== false) {
    findings.push('Simplify 安全策略被放宽；此构建要求三项都为 false');
  }
  if (policy.telemetry !== false) findings.push('telemetry 应保持关闭，除非用户明确配置');
  const readiness = evaluateFullAutoReadiness(await loadReadinessInputs(paths));
  print({
    healthy: findings.length === 0,
    findings,
    mode: policy.mode,
    stateDirectory: paths.root,
    fullAutoReady: readiness.ready
  }, Boolean(options.json));
  if (findings.length) process.exitCode = 2;
}

async function main() {
  const { positionals, options } = parseArguments(process.argv.slice(2));
  const command = positionals[0] || 'help';
  const stateDir = path.resolve(options['state-dir'] ? String(options['state-dir']) : defaultStateDir);

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(helpText());
      break;
    case 'init':
      await commandInit(stateDir, options);
      break;
    case 'questionnaire':
      await commandQuestionnaire(stateDir, options);
      break;
    case 'set-answer':
      await commandSetAnswer(stateDir, options);
      break;
    case 'status':
      await commandStatus(stateDir, options);
      break;
    case 'readiness':
      await commandReadiness(stateDir, options);
      break;
    case 'mode':
      await commandMode(stateDir, options);
      break;
    case 'new-application':
      await commandNewApplication(stateDir, options);
      break;
    case 'event':
      await commandEvent(stateDir, options);
      break;
    case 'manifest':
      await commandManifest(stateDir, options);
      break;
    case 'doctor':
      await commandDoctor(stateDir, options);
      break;
    default:
      throw new Error(`未知命令：${command}\n\n${helpText()}`);
  }
}

main().catch((error) => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});
