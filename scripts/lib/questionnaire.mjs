import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:password|passwd|otp|one[- ]time code|recovery code|session cookie|api key)\b\s*[:=]\s*\S+/i,
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16})\b/
];

export async function loadQuestionnaire(filePath) {
  const catalog = JSON.parse(await readFile(filePath, 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.groups)) throw new Error('不支持的 questionnaire schema');
  return catalog;
}

export function flattenQuestions(catalog) {
  return catalog.groups.flatMap((group) => group.questions.map((question) => ({ ...question, groupId: group.id, groupTitle: group.title })));
}

export function parseAnswer(question, rawInput) {
  const raw = String(rawInput ?? '').trim();
  if (!raw && question.defaultValue !== undefined) return question.defaultValue;
  if (!raw) return null;

  let value;
  switch (question.valueType) {
    case 'number':
      value = Number(raw);
      if (!Number.isFinite(value)) throw new Error('请输入有效数字');
      break;
    case 'number-list':
      value = raw.split(',').map((item) => Number(item.trim()));
      if (value.some((item) => !Number.isFinite(item))) throw new Error('请使用逗号分隔数字');
      break;
    case 'string-list':
      value = raw.split(',').map((item) => item.trim()).filter(Boolean);
      break;
    case 'enum-list':
      value = raw.split(',').map((item) => item.trim()).filter(Boolean);
      if (value.some((item) => !question.allowedValues.includes(item))) {
        throw new Error(`允许值：${question.allowedValues.join(', ')}`);
      }
      break;
    case 'enum':
      if (!question.allowedValues.includes(raw)) throw new Error(`允许值：${question.allowedValues.join(', ')}`);
      value = raw;
      break;
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) throw new Error('日期格式必须为 YYYY-MM-DD');
      value = raw;
      break;
    case 'date-month':
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new Error('年月格式必须为 YYYY-MM');
      value = raw;
      break;
    case 'string':
      value = raw;
      break;
    default:
      throw new Error(`不支持的 valueType：${question.valueType}`);
  }

  rejectSecretValue(question.id, value);
  return value;
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

export function upsertAnswer(document, question, value, { source = 'user-explicit', explicit = false, now = new Date().toISOString() } = {}) {
  rejectSecretValue(question.id, value);
  if (['legal-material', 'protected'].includes(question.sensitivity) && !explicit) {
    throw new Error(`${question.id} 属于 ${question.sensitivity}，必须使用 explicit=true 记录用户明确回答`);
  }
  if (value === null && question.requiredFor?.length) throw new Error(`${question.id} 不能为空`);

  const answer = {
    questionId: question.id,
    value,
    source: value === 'prefer-not-to-answer' ? 'prefer-not-to-answer' : source,
    sensitivity: question.sensitivity,
    automationPolicy: question.automationPolicy,
    verifiedAt: now,
    expiresAt: null
  };
  const index = document.answers.findIndex((item) => item.questionId === question.id);
  if (index >= 0) document.answers[index] = answer;
  else document.answers.push(answer);
  return answer;
}

export function missingRequiredAnswers(catalog, answerDocument, mode) {
  const current = new Map(answerDocument.answers.map((item) => [item.questionId, item]));
  const now = Date.now();
  return flattenQuestions(catalog).filter((question) => {
    if (!question.requiredFor?.includes(mode)) return false;
    const answer = current.get(question.id);
    if (!answer || answer.value === null || answer.value === '' || (Array.isArray(answer.value) && answer.value.length === 0)) return true;
    if (answer.expiresAt && Date.parse(answer.expiresAt) <= now) return true;
    if (['legal-material', 'protected'].includes(question.sensitivity) && !['user-explicit', 'prefer-not-to-answer'].includes(answer.source)) return true;
    return false;
  });
}

export async function runInteractiveQuestionnaire({ catalog, answerDocument, mode = 'semi-auto', requiredOnly = false }) {
  const rl = createInterface({ input, output });
  const questions = flattenQuestions(catalog);
  const existing = new Map(answerDocument.answers.map((item) => [item.questionId, item]));

  try {
    for (const question of questions) {
      if (requiredOnly && !question.requiredFor?.includes(mode)) continue;
      if (existing.has(question.id)) continue;
      output.write(`\n[${question.groupTitle}] ${question.prompt}\n`);
      if (question.allowedValues) output.write(`可选：${question.allowedValues.join(' / ')}\n`);
      const raw = await rl.question('> ');
      const value = parseAnswer(question, raw);
      if (value === null && !question.requiredFor?.includes(mode)) continue;
      upsertAnswer(answerDocument, question, value, {
        source: 'user-explicit',
        explicit: ['legal-material', 'protected'].includes(question.sensitivity)
      });
    }
  } finally {
    rl.close();
  }
  return answerDocument;
}
