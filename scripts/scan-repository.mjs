#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const selfPath = path.resolve(fileURLToPath(import.meta.url));
const root = path.resolve(path.dirname(selfPath), '..');
const skippedDirectories = new Set(['.git', 'node_modules']);
const maxTextBytes = 8 * 1024 * 1024;
const findings = [];
const seenFindings = new Set();
let textFileCount = 0;
let binaryFileCount = 0;

function relative(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function addFinding(filePath, line, kind, message) {
  const key = `${relative(filePath)}:${line}:${kind}`;
  if (seenFindings.has(key)) return;
  seenFindings.add(key);
  findings.push({ file: relative(filePath), line, kind, message });
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (text.charCodeAt(cursor) === 10) line += 1;
  }
  return line;
}

function isProbablyText(buffer) {
  const sampleLength = Math.min(buffer.length, 8192);
  if (sampleLength === 0) return true;

  let controlCharacters = 0;
  for (let index = 0; index < sampleLength; index += 1) {
    const byte = buffer[index];
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) controlCharacters += 1;
  }

  return controlCharacters / sampleLength < 0.01;
}

function scanPattern(filePath, text, expression, kind, message, accept = () => true) {
  expression.lastIndex = 0;
  let match;
  while ((match = expression.exec(text)) !== null) {
    if (accept(match)) {
      addFinding(filePath, lineNumberAt(text, match.index), kind, message);
    }
    if (match[0].length === 0) expression.lastIndex += 1;
  }
}

function safeExampleEmail(match) {
  const domain = match[0].split('@').at(-1).toLowerCase();
  return new Set([
    'example.com',
    'example.org',
    'example.net',
    'example.test',
    'example.invalid'
  ]).has(domain);
}

function safeExamplePhone(match) {
  let digits = match[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return false;
  const exchange = digits.slice(3, 6);
  const subscriber = Number(digits.slice(6));
  return exchange === '555' && subscriber >= 100 && subscriber <= 199;
}

function safePlaceholder(value) {
  const normalized = value.trim().replace(/^['"`]|['"`]$/g, '');
  return /^(?:null|undefined|redacted|changeme|hunter2|not-for-storage|not-a-real-secret)$/i.test(normalized)
    || /^(?:example|sample|dummy)(?:[-_.][A-Za-z0-9_-]+)?$/i.test(normalized)
    || /^(?:<[^>]+>|\$\{|process\.env\b)/i.test(normalized);
}

function knownSyntheticToken(value) {
  return new Set([
    'ghp_abcdefghijklmnopqrstuvwxyz1234'
  ]).has(value);
}

function sha256(value) {
  return createHash('sha256').update(value.normalize('NFKC').toLowerCase()).digest('hex');
}

function readGitConfig(key) {
  try {
    return execFileSync('git', ['config', '--get', key], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return '';
  }
}

function privateMarkerHashes() {
  // These fingerprints catch known private identity fragments without publishing them.
  const hashes = new Set([
    '7fec1a86b68f46a12da1110bf4060b4effe9d3d2fcb7092980d82326c3d3dcac',
    '571fc073d673a0a1f0fa14a86d3432c234fe09fce7bf5ab61bfa3be5f92882a5',
    '3bc33c90ce9047d144758caef8583d9cff43ba93f6384783e83b72ca51ed3cb9'
  ]);

  const configured = (process.env.APPLY_PILOT_PRIVATE_MARKERS ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);
  const runtimeMarkers = [
    ...configured,
    readGitConfig('user.name'),
    readGitConfig('user.email'),
    process.env.GIT_AUTHOR_NAME ?? '',
    process.env.GIT_AUTHOR_EMAIL ?? '',
    os.userInfo().username
  ];

  for (const marker of runtimeMarkers) {
    const normalized = marker.normalize('NFKC').trim().toLowerCase();
    if (normalized.length >= 4) hashes.add(sha256(normalized));
    const emailLocalPart = normalized.includes('@') ? normalized.split('@')[0] : '';
    if (emailLocalPart.length >= 4) hashes.add(sha256(emailLocalPart));
  }

  return hashes;
}

function scanPrivateMarkers(filePath, text, markerHashes) {
  const tokens = [...text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)];
  for (let index = 0; index < tokens.length; index += 1) {
    for (let width = 1; width <= 3 && index + width <= tokens.length; width += 1) {
      const slice = tokens.slice(index, index + width);
      const candidate = slice.map((token) => token[0]).join(' ');
      if (candidate.length < 4 || !markerHashes.has(sha256(candidate))) continue;
      addFinding(
        filePath,
        lineNumberAt(text, slice[0].index),
        'private-identity',
        '发现本机或项目私有身份标记；请改用虚构占位符。'
      );
    }
  }
}

function scanText(filePath, text, markerHashes) {
  scanPattern(
    filePath,
    text,
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    'private-key',
    '发现私钥头；私钥不得进入仓库。'
  );
  scanPattern(
    filePath,
    text,
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
    'github-token',
    '发现疑似 GitHub token。',
    (match) => !knownSyntheticToken(match[0])
  );
  scanPattern(
    filePath,
    text,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
    'openai-key',
    '发现疑似 API key。'
  );
  scanPattern(
    filePath,
    text,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    'aws-key',
    '发现疑似云服务 access key。'
  );
  scanPattern(
    filePath,
    text,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    'slack-token',
    '发现疑似 access token。'
  );
  scanPattern(
    filePath,
    text,
    /\bAIza[0-9A-Za-z_-]{35}\b/g,
    'google-api-key',
    '发现疑似 API key。'
  );
  scanPattern(
    filePath,
    text,
    /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    'jwt',
    '发现疑似 JWT。'
  );
  scanPattern(
    filePath,
    text,
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/@]+:[^@\s/]+@/gi,
    'credential-url',
    '发现包含用户名和密码的连接字符串。'
  );
  scanPattern(
    filePath,
    text,
    /(?:^|[,{;\s])["']?(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|session)["']?\s*[:=]\s*["']?([^"'\s,;}]+)/gim,
    'secret-assignment',
    '发现疑似硬编码凭据或会话值。',
    (match) => !safePlaceholder(match[1])
  );

  scanPattern(
    filePath,
    text,
    /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,63}\b/gi,
    'real-email',
    '发现非保留示例域名的邮箱地址。',
    (match) => !safeExampleEmail(match)
  );
  scanPattern(
    filePath,
    text,
    /(?<![\p{L}\p{N}])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]\d{3,4}[\s.-]\d{4}(?![\p{L}\p{N}])/gu,
    'real-phone',
    '发现疑似真实电话号码；示例请使用保留的 555-01xx 号码。',
    (match) => {
      const digitCount = match[0].replace(/\D/g, '').length;
      return digitCount >= 10 && digitCount <= 15 && !safeExamplePhone(match);
    }
  );
  scanPattern(
    filePath,
    text,
    /(?<![A-Za-z0-9+.-])[A-Za-z]:[\\/][^\s"'`<>|]+/g,
    'absolute-path',
    '发现 Windows 本机绝对路径；请改用仓库相对路径或占位符。'
  );
  scanPattern(
    filePath,
    text,
    /\\\\[A-Za-z0-9._$-]+\\[^\s"'`<>|]+/g,
    'absolute-path',
    '发现 UNC 本机或网络绝对路径。'
  );
  scanPattern(
    filePath,
    text,
    /\/(?:Users|home)\/[^/\s"'`<>]+(?:\/[^\s"'`<>]*)?/g,
    'absolute-path',
    '发现用户主目录绝对路径；请改用占位符。'
  );
  scanPattern(
    filePath,
    text,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
    'uuid',
    '发现 UUID；公开示例不得携带真实线程、申请或事务标识。'
  );
  scanPattern(
    filePath,
    text,
    /\b(?:thread|task|application|candidate|claim|transaction|requisition|job)[ _-]?(?:id|number|#)\b\s*[:=#-]?\s*["'`]?([A-Za-z0-9][A-Za-z0-9._-]{5,})/gi,
    'external-id',
    '发现疑似真实线程或申请标识；请使用 EXAMPLE/DEMO/TEST 占位值。',
    (match) => /\d/.test(match[1]) && !/^(?:example|demo|test|sample|fixture|placeholder)[._-]/i.test(match[1])
  );

  scanPrivateMarkers(filePath, text, markerHashes);
}

async function collectFiles(directory, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) await collectFiles(entryPath, files);
      continue;
    }
    if (entry.isSymbolicLink()) {
      addFinding(entryPath, 1, 'unscanned-symlink', '符号链接不会被跟随；发布前请改为可审查文件。');
      continue;
    }
    if (entry.isFile() && path.resolve(entryPath) !== selfPath) files.push(entryPath);
  }

  return files;
}

async function main() {
  const markerHashes = privateMarkerHashes();
  const files = await collectFiles(root);

  for (const filePath of files) {
    const metadata = await stat(filePath);
    const buffer = await readFile(filePath);
    if (!isProbablyText(buffer)) {
      binaryFileCount += 1;
      continue;
    }
    if (metadata.size > maxTextBytes) {
      addFinding(filePath, 1, 'unscanned-large-file', '文本文件超过 8 MiB，未完成隐私扫描。');
      continue;
    }

    textFileCount += 1;
    scanText(filePath, buffer.toString('utf8'), markerHashes);
  }

  findings.sort((left, right) =>
    left.file.localeCompare(right.file) || left.line - right.line || left.kind.localeCompare(right.kind)
  );

  if (findings.length > 0) {
    console.error(`隐私扫描失败：发现 ${findings.length} 个需处理的问题。`);
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.kind}] ${finding.message}`);
    }
    console.error('为避免二次泄露，扫描器不会打印命中的原始内容。');
    process.exitCode = 1;
    return;
  }

  console.log(`隐私扫描通过：已检查 ${textFileCount} 个文本文件，跳过 ${binaryFileCount} 个二进制文件。`);
}

main().catch((error) => {
  console.error(`隐私扫描器运行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
