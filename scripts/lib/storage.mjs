import { mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const writeQueues = new Map();

export async function withStateLock(stateDir, operation) {
  await mkdir(stateDir, { recursive: true });
  const lockPath = path.join(stateDir, '.writer.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('state writer lock 已存在；确认原进程结束后才能人工恢复，禁止自动抢锁');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await handle.sync();
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath);
  }
}

export async function loadApplicationRecords(paths) {
  const entries = await readdir(paths.applicationsDir, { withFileTypes: true });
  const records = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name !== 'index.json' && entry.name.endsWith('.json')) {
      records.push(await readJson(path.join(paths.applicationsDir, entry.name)));
    }
  }
  return records;
}

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

export async function readJsonLines(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`JSONL 第 ${index + 1} 行无效：${filePath}`);
      }
    });
}

export function contentAddressedJsonPath(baseDirectory, namespace, digest) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(namespace || '')) throw new Error('content-addressed namespace 无效');
  if (!/^[a-f0-9]{64}$/i.test(digest || '')) throw new Error('content-addressed digest 必须是 SHA-256');
  return path.join(baseDirectory, namespace, `${digest.toLowerCase()}.json`);
}

export async function saveArtifactBytes(baseDirectory, digest, bytes) {
  if (!/^[a-f0-9]{64}$/.test(digest || '')) throw new Error('artifact digest 必须是 SHA-256');
  await mkdir(baseDirectory, { recursive: true });
  const target = path.join(baseDirectory, digest);
  let handle;
  try {
    handle = await open(target, 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    if (!(await readFile(target)).equals(bytes)) throw new Error('artifact content-addressed bytes 冲突');
  } finally {
    if (handle) await handle.close();
  }
  return target;
}

export async function saveContentAddressedJson(baseDirectory, namespace, digest, value) {
  const target = contentAddressedJsonPath(baseDirectory, namespace, digest);
  await mkdir(path.dirname(target), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  let handle;
  try {
    handle = await open(target, 'wx');
    await handle.writeFile(body, 'utf8');
    await handle.sync();
    await handle.close();
    return target;
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error?.code !== 'EEXIST') {
      await rm(target, { force: true }).catch(() => {});
      throw error;
    }
    const existing = await readFile(target, 'utf8');
    if (existing !== body) throw new Error(`content-addressed 文件冲突：${target}`);
    return target;
  }
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
    preflightDir: path.join(root, 'preflight'),
    answerSnapshotsDir: path.join(root, 'snapshots', 'answers'),
    artifactManifestsDir: path.join(root, 'manifests', 'artifacts'),
    artifactBlobsDir: path.join(root, 'artifacts'),
    receiptLedger: path.join(root, 'receipts', 'events.jsonl')
  };
}

export async function initializeState(stateDir, defaultPolicy) {
  const paths = statePaths(stateDir);
  await mkdir(paths.applicationsDir, { recursive: true });
  await mkdir(paths.preflightDir, { recursive: true });
  await mkdir(paths.answerSnapshotsDir, { recursive: true });
  await mkdir(paths.artifactManifestsDir, { recursive: true });
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
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,}$/.test(applicationId || '')) throw new Error('applicationId 格式无效');
  return readJson(path.join(paths.applicationsDir, `${applicationId}.json`));
}

export async function saveApplication(paths, application) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,}$/.test(application.applicationId || '')) throw new Error('applicationId 格式无效');
  const applicationPath = path.join(paths.applicationsDir, `${application.applicationId}.json`);
  const index = await readJson(paths.applicationsIndex);
  const summary = {
    applicationId: application.applicationId,
    candidateId: application.candidateId,
    candidateIdentity: application.candidateIdentity || null,
    company: application.company,
    role: application.role,
    location: application.location || null,
    employerJobId: application.employerJobId || null,
    officialUrl: application.officialUrl,
    portalFamily: application.portalFamily,
    mode: application.mode,
    state: application.state,
    stateVersion: application.stateVersion,
    submitAttemptCount: application.submitAttemptCount,
    preflight: application.preflight || null,
    answerSnapshotSha: application.answerSnapshotSha || null,
    artifactManifestSha: application.artifactManifestSha || null,
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
