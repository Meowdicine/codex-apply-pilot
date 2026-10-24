#!/usr/bin/env node

import assert from 'node:assert/strict';
import { access, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function localReference(reference, base = root) {
  assert.equal(typeof reference, 'string', 'local reference 必须是 string');
  const absolute = path.resolve(base, reference);
  const actual = await realpath(absolute);
  const relative = path.relative(root, actual);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'local reference 不得离开 repository');
  await access(actual);
  return actual;
}

function requiredString(value, field) {
  assert.ok(typeof value === 'string' && value.trim(), `${field} 必须是非空 string`);
}

async function main() {
  const plugin = JSON.parse(await readFile(path.join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
  assert.match(plugin.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  requiredString(plugin.description, 'plugin description');
  requiredString(plugin.author?.name, 'plugin author');
  requiredString(plugin.license, 'plugin license');
  for (const field of ['homepage', 'repository']) assert.equal(new URL(plugin[field]).protocol, 'https:');
  const skillsRoot = await localReference(plugin.skills);
  for (const field of ['displayName', 'shortDescription', 'longDescription', 'developerName', 'category']) {
    requiredString(plugin.interface?.[field], `plugin interface.${field}`);
  }
  for (const field of ['composerIcon', 'logo']) await localReference(plugin.interface[field]);
  assert.ok(plugin.interface.defaultPrompt.length > 0);
  for (const prompt of plugin.interface.defaultPrompt) requiredString(prompt, 'defaultPrompt');

  let skillCount = 0;
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(skillsRoot, entry.name);
    const source = await readFile(path.join(directory, 'SKILL.md'), 'utf8');
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    assert.ok(frontmatter, `${entry.name}: 缺少 YAML frontmatter`);
    const fields = new Map();
    // 本仓库 skills 使用 name/description 两个单行 plain scalar，其他 YAML 形态需显式升级 validator。
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const match = line.match(/^(name|description): ([^\r\n]+)$/);
      assert.ok(match, `${entry.name}: 不支持的 frontmatter 形态`);
      assert.ok(!fields.has(match[1]), `${entry.name}: frontmatter key 重复`);
      assert.ok(!/^[\[\]{}&*!|>'"@`]/.test(match[2]), `${entry.name}: 需要单行 plain scalar`);
      assert.ok(!/:\s|\s#/.test(match[2]), `${entry.name}: plain scalar 存在 YAML 歧义`);
      fields.set(match[1], match[2]);
    }
    assert.equal(fields.get('name'), entry.name);
    assert.match(fields.get('name'), /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(fields.get('name').length <= 64);
    requiredString(fields.get('description'), `${entry.name}: description`);
    assert.ok(fields.get('description').length <= 1024);
    assert.ok(!/[<>]/.test(fields.get('description')));
    for (const match of source.matchAll(/\]\((references\/[^)]+)\)/g)) await localReference(match[1], directory);
    const agent = await readFile(path.join(directory, 'agents', 'openai.yaml'), 'utf8');
    for (const field of ['display_name', 'short_description', 'default_prompt']) {
      assert.match(agent, new RegExp(`^  ${field}: .+`, 'm'));
    }
    skillCount += 1;
  }
  assert.ok(skillCount > 0, 'plugin 至少需要一个 skill');
  console.log(`Plugin manifest 与 ${skillCount} 个 skills 校验通过。`);
}

main().catch((error) => {
  console.error(`Plugin/skill 校验失败：${error.message}`);
  process.exitCode = 1;
});
