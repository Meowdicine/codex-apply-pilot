import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  flattenQuestions,
  missingRequiredAnswers,
  parseAnswer,
  rejectSecretValue,
  upsertAnswer
} from '../scripts/lib/questionnaire.mjs';
import { evaluateFullAutoReadiness } from '../scripts/lib/readiness.mjs';

const root = new URL('../', import.meta.url);
const catalog = JSON.parse(await readFile(new URL('config/questionnaire.zh-CN.json', root), 'utf8'));
const policy = JSON.parse(await readFile(new URL('config/default-policy.json', root), 'utf8'));

function future(minutes = 60) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function past(minutes = 60) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function validValue(question) {
  if (question.id === 'automation.full-auto-opt-in') return 'yes';
  if (question.allowedValues) return question.allowedValues[0];
  switch (question.valueType) {
    case 'date': return '2030-01-01';
    case 'date-month': return '2030-01';
    case 'number': return 0;
    case 'number-list': return [4];
    case 'string-list': return ['example'];
    case 'enum-list': return [question.allowedValues[0]];
    default: return `verified-${question.id}`;
  }
}

function completeAnswers() {
  const document = { schemaVersion: 1, answers: [] };
  for (const question of flattenQuestions(catalog)) {
    if (!question.requiredFor?.includes('full-auto')) continue;
    upsertAnswer(document, question, validValue(question), {
      source: 'user-explicit',
      explicit: ['legal-material', 'protected'].includes(question.sensitivity)
    });
  }
  return document;
}

function readyFixture(overrides = {}) {
  return {
    policy,
    catalog,
    answers: completeAnswers(),
    consent: {
      schemaVersion: 1,
      fullAutoConsent: {
        active: true,
        allowedDomains: ['jobs.example.test'],
        validFrom: past(),
        expiresAt: future(),
        revokedAt: null
      },
      capabilities: {
        osCredentialStoreReady: true,
        browserSmokeTestPassed: true,
        exactlyOnceRecoveryTestPassed: true,
        dryRunsPassed: 2
      }
    },
    resumeCatalog: {
      schemaVersion: 1,
      baselines: [
        { family: 'software', immutable: true, artifactSha256: 'a'.repeat(64) },
        { family: 'data', immutable: true, artifactSha256: 'b'.repeat(64) },
        { family: 'infrastructure', immutable: true, artifactSha256: 'c'.repeat(64) }
      ]
    },
    applicationIndex: {
      schemaVersion: 1,
      applications: [
        { mode: 'semi-auto', state: 'submitted-verified', portalFamily: 'greenhouse' },
        { mode: 'semi-auto', state: 'submitted-verified', portalFamily: 'lever' },
        { mode: 'semi-auto', state: 'submitted-verified', portalFamily: 'greenhouse' }
      ]
    },
    ...overrides
  };
}

test('legal and protected answers require explicit user confirmation', () => {
  const question = flattenQuestions(catalog).find((item) => item.id === 'legal.sponsorship-required');
  const document = { schemaVersion: 1, answers: [] };

  assert.throws(
    () => upsertAnswer(document, question, 'no', { source: 'approved-resume', explicit: false }),
    /必须使用 explicit=true/
  );
  const answer = upsertAnswer(document, question, 'no', { source: 'user-explicit', explicit: true });
  assert.equal(answer.source, 'user-explicit');
});

test('required legal answers with a non-explicit source remain missing', () => {
  const document = completeAnswers();
  const answer = document.answers.find((item) => item.questionId === 'legal.work-authorization');
  answer.source = 'approved-resume';

  assert.ok(missingRequiredAnswers(catalog, document, 'full-auto').some((item) => item.id === answer.questionId));
});

test('secret-like question IDs and values are rejected', () => {
  assert.throws(() => rejectSecretValue('portal.password', 'not-for-storage'), /不得保存在/);
  assert.throws(() => rejectSecretValue('profile.notes', 'password=hunter2'), /疑似凭据/);
  assert.throws(() => rejectSecretValue('profile.notes', 'ghp_abcdefghijklmnopqrstuvwxyz1234'), /疑似凭据/);
});

test('question parsing validates enums and calendar formats', () => {
  const sponsorship = flattenQuestions(catalog).find((item) => item.id === 'legal.sponsorship-required');
  assert.equal(parseAnswer(sponsorship, 'no'), 'no');
  assert.throws(() => parseAnswer(sponsorship, 'maybe'), /允许值/);

  const graduation = flattenQuestions(catalog).find((item) => item.id === 'education.expected-graduation');
  assert.equal(parseAnswer(graduation, '2030-12'), '2030-12');
  assert.throws(() => parseAnswer(graduation, '2030-13'), /年月格式/);
});

test('full-auto readiness passes only with the complete maturity fixture', () => {
  const result = evaluateFullAutoReadiness(readyFixture());
  assert.equal(result.ready, true, JSON.stringify(result.checks, null, 2));
  assert.ok(result.checks.every((item) => item.passed));
});

test('full-auto readiness fails independently on maturity and safety gaps', async (t) => {
  const base = readyFixture();
  const cases = [
    ['not enough semi-auto successes', {
      ...base,
      applicationIndex: { schemaVersion: 1, applications: base.applicationIndex.applications.slice(0, 2) }
    }, 'verified-semi-auto-submissions'],
    ['not enough distinct resume families', {
      ...base,
      resumeCatalog: {
        schemaVersion: 1,
        baselines: base.resumeCatalog.baselines.map((item) => ({ ...item, family: 'software' }))
      }
    }, 'distinct-resume-families'],
    ['credential store unavailable', {
      ...base,
      consent: {
        ...base.consent,
        capabilities: { ...base.consent.capabilities, osCredentialStoreReady: false }
      }
    }, 'os-credential-store-ready'],
    ['consent expired', {
      ...base,
      consent: {
        ...base.consent,
        fullAutoConsent: { ...base.consent.fullAutoConsent, expiresAt: past() }
      }
    }, 'time-bounded-consent-active'],
    ['unresolved unknown submit state', {
      ...base,
      applicationIndex: {
        schemaVersion: 1,
        applications: [
          ...base.applicationIndex.applications,
          { mode: 'full-auto', state: 'unknown-submit-state-no-repeat', portalFamily: 'workday' }
        ]
      }
    }, 'unresolved-hard-stops']
  ];

  for (const [name, fixture, failedId] of cases) {
    await t.test(name, () => {
      const result = evaluateFullAutoReadiness(fixture);
      assert.equal(result.ready, false);
      assert.equal(result.checks.find((item) => item.id === failedId).passed, false);
    });
  }
});

test('full-auto opt-in answer of no cannot satisfy readiness', () => {
  const fixture = readyFixture();
  fixture.answers.answers.find((item) => item.questionId === 'automation.full-auto-opt-in').value = 'no';

  const result = evaluateFullAutoReadiness(fixture);
  assert.equal(result.ready, false);
  assert.equal(result.checks.find((item) => item.id === 'full-auto-opt-in').passed, false);
});
