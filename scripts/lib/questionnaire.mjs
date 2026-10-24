import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:password|passwd|otp|one[- ]time code|recovery code|session cookie|api key)\b\s*[:=]\s*\S+/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/
];

const SUPPORTED_VALUE_TYPES = new Set([
  'date',
  'date-month',
  'email',
  'enum',
  'enum-list',
  'integer',
  'key-value-list',
  'number',
  'number-list',
  'string',
  'string-list',
  'url'
]);
const SUPPORTED_SENSITIVITIES = new Set(['ordinary', 'personal', 'protected', 'legal-material']);
const SUPPORTED_AUTOMATION_POLICIES = new Set(['auto-fill', 'ask-each-time', 'ask-until-verified', 'never-store']);
const SUPPORTED_MODES = new Set(['semi-auto', 'full-auto']);
const SUPPORTED_SCOPES = new Set(['profile', 'search', 'candidate-default', 'consent']);
const SUPPORTED_CONDITION_OPERATORS = new Set(['equals', 'not-equals', 'includes', 'not-empty']);

export async function loadQuestionnaire(filePath) {
  const baseCatalog = JSON.parse(await readFile(filePath, 'utf8'));
  const includedCatalogs = [];
  for (const include of baseCatalog.includes || []) {
    const includePath = filePath instanceof URL
      ? new URL(include, filePath)
      : path.resolve(path.dirname(filePath), include);
    includedCatalogs.push(JSON.parse(await readFile(includePath, 'utf8')));
  }
  const catalog = mergeCatalogs(baseCatalog, includedCatalogs);
  validateCatalog(catalog);
  return catalog;
}

function mergeCatalogs(baseCatalog, includedCatalogs) {
  const groups = baseCatalog.groups.map((group) => ({
    ...group,
    questions: group.questions.map((question) => ({ ...question }))
  }));

  for (const included of includedCatalogs) {
    if (included.schemaVersion !== baseCatalog.schemaVersion || included.locale !== baseCatalog.locale) {
      throw new Error('questionnaire include 与 base catalog 不兼容');
    }
    for (const incomingGroup of included.groups || []) {
      const index = groups.findIndex((group) => group.id === incomingGroup.id);
      if (index < 0) {
        groups.push({ ...incomingGroup, questions: incomingGroup.questions.map((question) => ({ ...question })) });
      } else {
        groups[index] = {
          ...groups[index],
          ...incomingGroup,
          questions: [...groups[index].questions, ...incomingGroup.questions.map((question) => ({ ...question }))]
        };
      }
    }
    for (const override of included.overrides || []) {
      const target = groups.flatMap((group) => group.questions).find((question) => question.id === override.id);
      if (!target) throw new Error(`questionnaire override 引用了未知问题：${override.id}`);
      Object.assign(target, override);
    }
  }

  return {
    ...baseCatalog,
    catalogVersion: baseCatalog.catalogVersion || 1,
    groups
  };
}

function validateCatalog(catalog) {
  if (catalog.schemaVersion !== 1 || !Number.isInteger(catalog.catalogVersion) || !Array.isArray(catalog.groups)) {
    throw new Error('不支持的 questionnaire schema');
  }

  const questions = flattenQuestions(catalog);
  const knownIds = new Set();
  for (const question of questions) {
    if (!question.id || knownIds.has(question.id)) throw new Error(`重复或缺失的问题 ID：${question.id || 'unknown'}`);
    knownIds.add(question.id);
    if (!SUPPORTED_VALUE_TYPES.has(question.valueType)) throw new Error(`${question.id} 使用不支持的 valueType`);
    if (!SUPPORTED_SENSITIVITIES.has(question.sensitivity)) throw new Error(`${question.id} 使用不支持的 sensitivity`);
    if (!SUPPORTED_AUTOMATION_POLICIES.has(question.automationPolicy)) throw new Error(`${question.id} 使用不支持的 automationPolicy`);
    if (!SUPPORTED_SCOPES.has(question.scope)) throw new Error(`${question.id} 使用不支持的 scope`);
    for (const mode of [...(question.requiredFor || []), ...(question.recommendedFor || [])]) {
      if (!SUPPORTED_MODES.has(mode)) throw new Error(`${question.id} 使用不支持的 mode：${mode}`);
    }
    if (question.automationPolicy === 'never-store' && question.requiredFor?.length) {
      throw new Error(`${question.id} 是 never-store，不能作为持久化必填项`);
    }
    if (['enum', 'enum-list'].includes(question.valueType) && !Array.isArray(question.allowedValues)) {
      throw new Error(`${question.id} 缺少 allowedValues`);
    }
  }

  for (const question of questions) {
    const conditions = [...(question.showWhen?.all || []), ...(question.showWhen?.any || [])];
    for (const condition of conditions) {
      if (!knownIds.has(condition.questionId)) throw new Error(`${question.id} 引用了未知条件问题：${condition.questionId}`);
      if (!SUPPORTED_CONDITION_OPERATORS.has(condition.operator)) {
        throw new Error(`${question.id} 使用不支持的 condition operator：${condition.operator}`);
      }
    }
  }
}

export function flattenQuestions(catalog) {
  return catalog.groups.flatMap((group) => group.questions.map((question) => ({
    ...question,
    scope: question.scope || group.scope || 'profile',
    reviewIntervalDays: question.reviewIntervalDays ?? group.reviewIntervalDays ?? null,
    groupId: group.id,
    groupTitle: group.title
  })));
}

function conditionMatches(condition, answerMap) {
  const answer = answerMap.get(condition.questionId);
  if (!answer || answer.value === null || answer.value === '') return false;
  const actual = answer.value;
  switch (condition.operator) {
    case 'equals':
      return actual === condition.value;
    case 'not-equals':
      return actual !== condition.value;
    case 'includes':
      return Array.isArray(actual)
        ? actual.includes(condition.value)
        : typeof actual === 'string' && actual.includes(String(condition.value));
    case 'not-empty':
      return Array.isArray(actual)
        ? actual.length > 0
        : typeof actual === 'object'
          ? Object.keys(actual).length > 0
          : String(actual).length > 0;
    default:
      return false;
  }
}

export function isQuestionApplicable(question, answerDocument) {
  if (!question.showWhen) return true;
  const answerMap = new Map((answerDocument.answers || []).map((item) => [item.questionId, item]));
  const all = question.showWhen.all || [];
  const any = question.showWhen.any || [];
  return all.every((condition) => conditionMatches(condition, answerMap))
    && (any.length === 0 || any.some((condition) => conditionMatches(condition, answerMap)));
}

export function parseAnswer(question, rawInput) {
  const raw = String(rawInput ?? '').trim();
  let value;

  if (!raw && question.defaultValue !== undefined) {
    value = question.defaultValue;
  } else if (!raw) {
    return null;
  } else {
    switch (question.valueType) {
      case 'number':
        value = Number(raw);
        if (!Number.isFinite(value)) throw new Error('请输入有效数字');
        break;
      case 'integer':
        value = Number(raw);
        if (!Number.isInteger(value)) throw new Error('请输入有效整数');
        break;
      case 'number-list':
        if (raw.split(',').some((item) => !item.trim())) throw new Error('数字列表不能包含空项');
        value = unique(raw.split(',').map((item) => Number(item.trim())));
        if (value.some((item) => !Number.isFinite(item))) throw new Error('请使用逗号分隔数字');
        break;
      case 'string-list':
        value = unique(raw.split(',').map((item) => item.trim()).filter(Boolean));
        break;
      case 'key-value-list':
        value = parseKeyValueList(raw);
        break;
      case 'enum-list':
        value = unique(raw.split(',').map((item) => item.trim()).filter(Boolean));
        if (value.some((item) => !question.allowedValues.includes(item))) {
          throw new Error(`允许值：${question.allowedValues.join(', ')}`);
        }
        break;
      case 'enum':
        if (!question.allowedValues.includes(raw)) throw new Error(`允许值：${question.allowedValues.join(', ')}`);
        value = raw;
        break;
      case 'date': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error('日期格式必须为 YYYY-MM-DD');
        const parsed = new Date(`${raw}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) throw new Error('请输入真实存在的日历日期');
        value = raw;
        break;
      }
      case 'date-month':
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new Error('年月格式必须为 YYYY-MM');
        value = raw;
        break;
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) throw new Error('请输入有效邮箱');
        value = raw;
        break;
      case 'url': {
        let parsed;
        try {
          parsed = new URL(raw);
        } catch {
          throw new Error('请输入有效 URL');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('URL 必须使用 http 或 https');
        if (question.validation?.httpsOnly && parsed.protocol !== 'https:') throw new Error('URL 必须使用 https');
        value = parsed.toString();
        break;
      }
      case 'string':
        value = raw;
        break;
      default:
        throw new Error(`不支持的 valueType：${question.valueType}`);
    }
  }

  validateQuestionValue(question, value);
  rejectSecretValue(question.id, value);
  return value;
}

function unique(values) {
  return [...new Set(values)];
}

function parseKeyValueList(raw) {
  const result = {};
  for (const item of raw.split(',')) {
    const separator = item.indexOf('=');
    if (separator <= 0 || separator === item.length - 1) throw new Error('请使用 key=value，并以逗号分隔');
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key || !value) throw new Error('key 与 value 均不能为空');
    if (['__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(result, key)) {
      throw new Error(`重复或不允许的 key：${key}`);
    }
    result[key] = value;
  }
  return result;
}

function validateQuestionValue(question, value) {
  if (value === null || value === undefined) throw new Error(`${question.id} 不能为空`);
  const stringTypes = ['string', 'email', 'url', 'date', 'date-month', 'enum'];
  if (stringTypes.includes(question.valueType) && (typeof value !== 'string' || !value.trim())) throw new Error('答案必须是非空字符串');
  if (['number', 'integer'].includes(question.valueType) && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('答案必须是有效数字');
  if (question.valueType === 'integer' && !Number.isInteger(value)) throw new Error('答案必须是整数');
  if (['string-list', 'enum-list', 'number-list'].includes(question.valueType)) {
    if (!Array.isArray(value) || !value.length) throw new Error('答案必须是非空列表');
    if (question.valueType === 'number-list' ? value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
      : value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('列表项类型无效');
  }
  if (question.valueType === 'enum' && !question.allowedValues?.includes(value)) throw new Error('答案不在允许值中');
  if (question.valueType === 'enum-list' && value.some((item) => !question.allowedValues?.includes(item))) throw new Error('答案不在允许值中');
  if (question.valueType === 'key-value-list') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.keys(value).length
      || Object.entries(value).some(([key, item]) => !key.trim() || ['__proto__', 'constructor', 'prototype'].includes(key)
        || typeof item !== 'string' || !item.trim())) throw new Error('答案必须是非空 key=value 映射');
  }
  if (question.valueType === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error('请输入有效邮箱');
  if (question.valueType === 'date') {
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('请输入真实存在的日历日期');
  }
  if (question.valueType === 'date-month' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error('年月格式必须为 YYYY-MM');
  if (question.valueType === 'url') {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL 必须是无凭据的 http 或 https');
    if (question.validation?.httpsOnly && url.protocol !== 'https:') throw new Error('URL 必须使用 https');
  }
  const validation = question.validation || {};
  if (typeof value === 'number') {
    if (validation.minimum !== undefined && value < validation.minimum) throw new Error(`最小值为 ${validation.minimum}`);
    if (validation.maximum !== undefined && value > validation.maximum) throw new Error(`最大值为 ${validation.maximum}`);
  }
  if (typeof value === 'string') {
    if (validation.minLength !== undefined && value.length < validation.minLength) throw new Error(`最少需要 ${validation.minLength} 个字符`);
    if (validation.maxLength !== undefined && value.length > validation.maxLength) throw new Error(`最多允许 ${validation.maxLength} 个字符`);
    if (validation.pattern && !new RegExp(validation.pattern).test(value)) throw new Error('输入格式不符合该问题要求');
  }
  if (Array.isArray(value)) {
    if (validation.minItems !== undefined && value.length < validation.minItems) throw new Error(`至少需要 ${validation.minItems} 项`);
    if (validation.maxItems !== undefined && value.length > validation.maxItems) throw new Error(`最多允许 ${validation.maxItems} 项`);
    if (validation.minimum !== undefined && value.some((item) => item < validation.minimum)) throw new Error(`列表项最小值为 ${validation.minimum}`);
    if (validation.maximum !== undefined && value.some((item) => item > validation.maximum)) throw new Error(`列表项最大值为 ${validation.maximum}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const count = Object.keys(value).length;
    if (validation.minItems !== undefined && count < validation.minItems) throw new Error(`至少需要 ${validation.minItems} 项`);
    if (validation.maxItems !== undefined && count > validation.maxItems) throw new Error(`最多允许 ${validation.maxItems} 项`);
  }
}

export function rejectSecretValue(questionId, value) {
  const serialized = JSON.stringify(value);
  if (/credential|password|otp|token|cookie|secret/i.test(questionId)) {
    throw new Error(`${questionId} 不得保存在 answers.json；请只使用 OS credential store 的 secretRef`);
  }
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(serialized)) throw new Error('检测到疑似凭据/验证码/令牌，已拒绝写入');
  }
}

function calculateExpiry(question, now) {
  if (!Number.isFinite(question.reviewIntervalDays) || question.reviewIntervalDays <= 0) return null;
  const verifiedAt = Date.parse(now);
  if (Number.isNaN(verifiedAt)) throw new Error('now 必须是有效 date-time');
  return new Date(verifiedAt + question.reviewIntervalDays * 86_400_000).toISOString();
}

export function upsertAnswer(document, question, value, {
  source = 'user-explicit',
  explicit = false,
  now = new Date().toISOString(),
  expiresAt
} = {}) {
  if (question.automationPolicy === 'never-store') throw new Error(`${question.id} 的值不得持久化`);
  validateQuestionValue(question, value);
  rejectSecretValue(question.id, value);
  if (['legal-material', 'protected'].includes(question.sensitivity) && !explicit) {
    throw new Error(`${question.id} 属于 ${question.sensitivity}，必须使用 explicit=true 记录用户明确回答`);
  }
  if (value === null && question.requiredFor?.length) throw new Error(`${question.id} 不能为空`);
  if (!['user-explicit', 'verified-document', 'approved-resume', 'deterministic-normalization', 'prefer-not-to-answer'].includes(source)) throw new Error('answer source 无效');
  if (['legal-material', 'protected'].includes(question.sensitivity) && source !== 'user-explicit' && value !== 'prefer-not-to-answer') throw new Error('法律与 protected 答案必须来自用户明确回答');
  if (!Number.isFinite(Date.parse(now))) throw new Error('verifiedAt 必须是有效时间');
  const reviewExpiry = calculateExpiry(question, now);
  let effectiveExpiry = expiresAt ?? reviewExpiry;
  if (effectiveExpiry !== null && (!Number.isFinite(Date.parse(effectiveExpiry)) || Date.parse(effectiveExpiry) <= Date.parse(now))) throw new Error('expiresAt 必须是 verifiedAt 之后的有效时间');
  if (reviewExpiry && (!effectiveExpiry || Date.parse(effectiveExpiry) > Date.parse(reviewExpiry))) effectiveExpiry = reviewExpiry;

  const answer = {
    questionId: question.id,
    questionRevision: question.revision || 1,
    answerScope: question.scope || 'profile',
    value,
    source: value === 'prefer-not-to-answer' ? 'prefer-not-to-answer' : source,
    sensitivity: question.sensitivity,
    automationPolicy: question.automationPolicy,
    verifiedAt: now,
    expiresAt: effectiveExpiry
  };
  const index = document.answers.findIndex((item) => item.questionId === question.id);
  if (index >= 0) document.answers[index] = answer;
  else document.answers.push(answer);
  return answer;
}

export function isAnswerCurrent(question, answer, now = Date.now()) {
  if (!answer || answer.value === null || answer.value === '' || (Array.isArray(answer.value) && answer.value.length === 0)) return false;
  const verifiedAt = Date.parse(answer.verifiedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt > now + 60000) return false;
  if (answer.expiresAt !== null && answer.expiresAt !== undefined
    && (!Number.isFinite(Date.parse(answer.expiresAt)) || Date.parse(answer.expiresAt) <= now)) return false;
  if (Number.isFinite(question.reviewIntervalDays) && question.reviewIntervalDays > 0
    && verifiedAt + question.reviewIntervalDays * 86400000 <= now) return false;
  if (answer.questionRevision !== (question.revision || 1)) return false;
  if (answer.answerScope !== question.scope || answer.sensitivity !== question.sensitivity
    || answer.automationPolicy !== question.automationPolicy || answer.automationPolicy === 'never-store') return false;
  if (['legal-material', 'protected'].includes(question.sensitivity) && !['user-explicit', 'prefer-not-to-answer'].includes(answer.source)) return false;
  try { validateQuestionValue(question, answer.value); rejectSecretValue(question.id, answer.value); } catch { return false; }
  return true;
}

export function missingRequiredAnswers(catalog, answerDocument, mode) {
  const current = new Map(answerDocument.answers.map((item) => [item.questionId, item]));
  return flattenQuestions(catalog).filter((question) => (
    question.requiredFor?.includes(mode)
    && isQuestionApplicable(question, answerDocument)
    && !isAnswerCurrent(question, current.get(question.id))
  ));
}

export async function runInteractiveQuestionnaire({
  catalog,
  answerDocument,
  mode = 'semi-auto',
  requiredOnly = false,
  includeAll = false
}) {
  const rl = createInterface({ input, output });
  const questions = flattenQuestions(catalog);
  const existing = new Map(answerDocument.answers.map((item) => [item.questionId, item]));

  try {
    for (const question of questions) {
      const required = question.requiredFor?.includes(mode);
      const recommended = question.recommendedFor?.includes(mode);
      if (requiredOnly && !required) continue;
      if (!requiredOnly && !includeAll && !required && !recommended) continue;
      if (!isQuestionApplicable(question, answerDocument)) continue;
      if (isAnswerCurrent(question, existing.get(question.id))) continue;
      output.write(`\n[${question.groupTitle}] ${question.prompt}\n`);
      if (question.allowedValues) output.write(`可选：${question.allowedValues.join(' / ')}\n`);
      if (question.reviewIntervalDays) output.write(`复核周期：${question.reviewIntervalDays} 天\n`);
      const raw = await rl.question('> ');
      const value = parseAnswer(question, raw);
      if (value === null && !required) continue;
      const answer = upsertAnswer(answerDocument, question, value, {
        source: 'user-explicit',
        explicit: ['legal-material', 'protected'].includes(question.sensitivity)
      });
      existing.set(question.id, answer);
    }
  } finally {
    rl.close();
  }
  return answerDocument;
}
