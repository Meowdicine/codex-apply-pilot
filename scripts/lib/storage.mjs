import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const writeQueues = new Map();

export async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJsonAtomicUnlocked(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  const body = `${JSON.stringify(value, null, 2)}\n`;

  try {
    const handle = await open(tempPath, 'wx');
    try {
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    JSON.parse(await readFile(tempPath, 'utf8'));
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function writeJsonAtomic(filePath, value) {
  const queueKey = path.resolve(filePath);
  const previous = writeQueues.get(queueKey) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(() => writeJsonAtomicUnlocked(queueKey, value));
  writeQueues.set(queueKey, current);
  try {
    await current;
  } finally {
    if (writeQueues.get(queueKey) === current) writeQueues.delete(queueKey);
  }
}

export async function appendJsonLine(filePath, value) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

export function statePaths(stateDir) {
  const root = path.resolve(stateDir);
  return {
    root,
    policy: path.join(root, 'policy.json'),
    profile: path.join(root, 'profile.json'),
    answers: path.join(root, 'answers.json'),
    consent: path.join(root, 'consent-policy.json'),
    resumeCatalog: path.join(root, 'resume-catalog.json'),
    applicationsIndex: path.join(root, 'applications', 'index.json'),
    applicationsDir: path.join(root, 'applications'),
    receiptLedger: path.join(root, 'receipts', 'events.jsonl')
  };
}

export async function initializeState(stateDir, defaultPolicy) {
  const paths = statePaths(stateDir);
  await mkdir(paths.applicationsDir, { recursive: true });
  await mkdir(path.dirname(paths.receiptLedger), { recursive: true });

  const documents = [
    [paths.policy, defaultPolicy],
    [paths.profile, { schemaVersion: 1, updatedAt: null, facts: [] }],
    [paths.answers, { schemaVersion: 1, answers: [] }],
    [paths.consent, {
      schemaVersion: 1,
      fullAutoConsent: {
        active: false,
        allowedDomains: [],
        dailySubmitCap: defaultPolicy.fullAuto.defaultDailySubmitCap,
        validFrom: null,
        expiresAt: null,
        revokedAt: null
      },
      capabilities: {
        osCredentialStoreReady: false,
        browserSmokeTestPassed: false,
        exactlyOnceRecoveryTestPassed: false,
        dryRunsPassed: 0
      }
    }],
    [paths.resumeCatalog, { schemaVersion: 1, baselines: [] }],
    [paths.applicationsIndex, { schemaVersion: 1, applications: [] }]
  ];

  for (const [filePath, value] of documents) {
    try {
      await readJson(filePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await writeJsonAtomic(filePath, value);
    }
  }

  return paths;
}

export async function loadApplication(paths, applicationId) {
  return readJson(path.join(paths.applicationsDir, `${applicationId}.json`));
}

export async function saveApplication(paths, application) {
  const applicationPath = path.join(paths.applicationsDir, `${application.applicationId}.json`);
  const index = await readJson(paths.applicationsIndex);
  const summary = {
    applicationId: application.applicationId,
    candidateId: application.candidateId,
    company: application.company,
    role: application.role,
    officialUrl: application.officialUrl,
    portalFamily: application.portalFamily,
    mode: application.mode,
    state: application.state,
    stateVersion: application.stateVersion,
    submitAttemptCount: application.submitAttemptCount,
    terminal: application.terminal,
    updatedAt: application.updatedAt
  };

  const existing = index.applications.findIndex((item) => item.applicationId === application.applicationId);
  if (existing >= 0) index.applications[existing] = summary;
  else index.applications.push(summary);

  await writeJsonAtomic(applicationPath, application);
  await writeJsonAtomic(paths.applicationsIndex, index);
  return applicationPath;
}
