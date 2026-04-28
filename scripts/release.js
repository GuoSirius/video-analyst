#!/usr/bin/env node
/**
 * Release Script - 发布流程
 * 1. 校验流程 (lint, typecheck)
 * 2. 提交未提交代码
 * 3. 选择发布版本类型（显示版本变动）
 * 4. 更新 changelog、package
 * 5. 创建 tag
 * 6. 推送（由用户手动执行）
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_URL = 'https://github.com/GuoSirius/video-analyst';

const run = (cmd, options = {}) => {
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...options });
    return true;
  } catch {
    console.error(`✗ 命令执行失败: ${cmd}`);
    return false;
  }
};

const exec = (cmd) => execSync(cmd, { encoding: 'utf-8' }).trim();

const RELEASE_TYPES = [
  { value: 'patch', label: 'patch', desc: '补丁版本 (Bug 修复)' },
  { value: 'minor', label: 'minor', desc: '次版本 (新功能)' },
  { value: 'major', label: 'major', desc: '主版本 (破坏性变更)' },
];

/**
 * 计算版本号变动
 */
function getVersionBump(currentVersion, type) {
  const parts = currentVersion.split('.').map(Number);
  const [major, minor, patch] = parts;
  
  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      return currentVersion;
  }
}

function askQuestion(question) {
  return new Promise((resolve) => {
    import('readline').then(({ default: readline }) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  });
}

async function selectReleaseType(currentVersion) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                    选择发布版本类型                       ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  RELEASE_TYPES.forEach((type, i) => {
    const nextVersion = getVersionBump(currentVersion, type.value);
    const marker = i === 0 ? ' ◀ (默认)' : '';
    console.log(`  ${i + 1}. ${type.label.padEnd(6)} - ${type.desc} (${currentVersion} → ${nextVersion})${marker}`);
  });

  while (true) {
    const answer = await askQuestion('\n请选择 (1-3，默认 1): ');
    const idx = parseInt(answer || '1') - 1;
    if (idx >= 0 && idx < RELEASE_TYPES.length) {
      return RELEASE_TYPES[idx];
    }
    console.log('无效选择，请重新输入 (1-3)');
  }
}

/**
 * 按类型分类提交
 */
function categorizeCommits(commits) {
  const groups = {
    feat: [], fix: [], perf: [], refactor: [],
    docs: [], style: [], test: [], build: [],
    ci: [], chore: [], other: []
  };

  const SECTION_TITLES = {
    feat: '✨ Features',
    fix: '🐛 Bug Fixes',
    perf: '⚡ Performance',
    refactor: '🔄 Refactoring',
    docs: '📝 Documentation',
    style: '💄 Styles',
    test: '🧪 Tests',
    build: '📦 Build System',
    ci: '🔧 CI/CD',
    chore: '🔧 Chores',
    other: '📋 Other Changes'
  };

  for (const c of commits) {
    const [msg, hash] = c.split('|');
    const url = `[${hash}](${REPO_URL}/commit/${hash})`;

    let type, desc;
    if (/^feat(\(.+\))?:/.test(msg)) {
      type = 'feat'; desc = msg.replace(/^feat(\(.+\))?:\s*/, '');
    } else if (/^fix(\(.+\))?:/.test(msg)) {
      type = 'fix'; desc = msg.replace(/^fix(\(.+\))?:\s*/, '');
    } else if (/^perf(\(.+\))?:/.test(msg)) {
      type = 'perf'; desc = msg.replace(/^perf(\(.+\))?:\s*/, '');
    } else if (/^refactor(\(.+\))?:/.test(msg)) {
      type = 'refactor'; desc = msg.replace(/^refactor(\(.+\))?:\s*/, '');
    } else if (/^docs(\(.+\))?:/.test(msg)) {
      type = 'docs'; desc = msg.replace(/^docs(\(.+\))?:\s*/, '');
    } else if (/^style(\(.+\))?:/.test(msg)) {
      type = 'style'; desc = msg.replace(/^style(\(.+\))?:\s*/, '');
    } else if (/^test(\(.+\))?:/.test(msg)) {
      type = 'test'; desc = msg.replace(/^test(\(.+\))?:\s*/, '');
    } else if (/^build(\(.+\))?:/.test(msg)) {
      type = 'build'; desc = msg.replace(/^build(\(.+\))?:\s*/, '');
    } else if (/^ci(\(.+\))?:/.test(msg)) {
      type = 'ci'; desc = msg.replace(/^ci(\(.+\))?:\s*/, '');
    } else if (/^chore(\(.+\))?:/.test(msg)) {
      type = 'chore'; desc = msg.replace(/^chore(\(.+\))?:\s*/, '');
    } else {
      type = 'other'; desc = msg;
    }

    groups[type].push(`- ${desc} ${url}`);
  }

  return { groups, SECTION_TITLES };
}

/**
 * 生成版本块
 */
function generateVersionBlock(version, prevVersion, commits, SECTION_TITLES) {
  const { groups } = categorizeCommits(commits);
  const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'other'];

  let block = `### [${version}](${REPO_URL}/compare/v${prevVersion}...v${version})\n\n`;

  let hasContent = false;
  for (const type of SECTION_ORDER) {
    if (groups[type] && groups[type].length > 0) {
      block += `\n### ${SECTION_TITLES[type]}\n\n`;
      block += groups[type].join('\n') + '\n';
      hasContent = true;
    }
  }

  if (!hasContent) {
    block += '- No functional changes in this release\n';
  }

  return block + '\n';
}

/**
 * 获取所有标签
 */
function getTags() {
  try {
    const tags = execSync('git tag -l "v*" --sort=-v:refname', { encoding: 'utf-8' })
      .trim().split('\n').filter(t => t);
    return tags.map(t => t.replace('v', ''));
  } catch {
    return [];
  }
}

/**
 * 获取版本间的所有提交
 */
function getCommits(fromTag, toTag) {
  const range = fromTag ? `v${fromTag}..v${toTag}` : `v${toTag}`;
  try {
    const commits = execSync(`git log ${range} --format="%s|%h"`, { encoding: 'utf-8' })
      .trim().split('\n').filter(c => c);

    return commits.filter(c => {
      const [msg] = c.split('|');
      return !/^chore\(release\):\s*\d+\.\d+\.\d+$/.test(msg);
    });
  } catch {
    return [];
  }
}

/**
 * 生成完整的 CHANGELOG
 */
function generateFullChangelog(SECTION_TITLES) {
  const tags = getTags();
  if (tags.length === 0) {
    console.log('No tags found');
    return;
  }

  let changelog = `# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

`;

  for (let i = 0; i < tags.length; i++) {
    const version = tags[i];
    const prevVersion = i < tags.length - 1 ? tags[i + 1] : null;
    const commits = getCommits(prevVersion, version);
    changelog += generateVersionBlock(version, prevVersion || '0.0.0', commits, SECTION_TITLES);
  }

  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  writeFileSync(changelogPath, changelog, 'utf-8');
  console.log(`✓ CHANGELOG 生成完成 (${tags.length} 个版本)`);
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║            🚀 Video Analyst 版本发布 🚀                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // 1. 检查 git 状态
  try {
    exec('git status');
  } catch {
    console.error('✗ 当前目录不是 Git 仓库');
    process.exit(1);
  }

  const status = exec('git status --porcelain');

  // 2. 代码检查
  console.log('\n【1/6】校验流程');
  if (!run('npm run lint')) {
    console.error('✗ Lint 检查失败');
    process.exit(1);
  }
  if (!run('npm run typecheck')) {
    console.error('✗ TypeScript 类型检查失败');
    process.exit(1);
  }
  console.log('✓ 校验通过');

  // 3. 提交代码
  console.log('\n【2/6】提交代码');
  if (status) {
    console.log('待提交的更改:');
    console.log(status);
    const commitMsg = await askQuestion('\n请输入提交信息（或按回车使用默认值 "chore: 发布新版本"）: ');
    const msg = commitMsg.trim() || 'chore: 发布新版本';
    console.log(`\n📝 提交信息: ${msg}`);
    run('git add -A');
    if (!run(`git commit -m "${msg}"`)) process.exit(1);
  } else {
    console.log('✓ 无需提交');
  }

  // 4. 拉取远程
  console.log('\n📥 拉取远程最新代码...');
  run('git fetch origin');
  run('git fetch github');

  // 5. 选择发布类型
  console.log('\n【3/6】选择发布版本类型');
  const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  const currentVersion = pkg.version;
  const releaseType = await selectReleaseType(currentVersion);
  const nextVersion = getVersionBump(currentVersion, releaseType.value);
  console.log(`\n✓ 选择: ${releaseType.label} (${currentVersion} → ${nextVersion})`);

  // 6. 确认发布
  const confirm = await askQuestion(`\n确认发布? (Y/n): `);
  if (confirm?.toLowerCase() === 'n') {
    console.log('已取消');
    process.exit(0);
  }

  // 7. 更新版本和创建 tag
  console.log('\n【4/6】更新 package.json 和创建 tag');
  if (!run(`npx standard-version --release-as ${releaseType.value} --skip-changelog`)) {
    process.exit(1);
  }

  // 8. 获取新版本号
  const newPkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  const newTag = `v${newPkg.version}`;
  console.log(`\n✓ 版本: ${currentVersion} → ${newPkg.version}`);
  console.log(`✓ 标签: ${newTag}`);

  // 9. 生成完整 CHANGELOG
  console.log('\n【5/6】更新 CHANGELOG');
  const SECTION_TITLES = {
    feat: '✨ Features',
    fix: '🐛 Bug Fixes',
    perf: '⚡ Performance',
    refactor: '🔄 Refactoring',
    docs: '📝 Documentation',
    style: '💄 Styles',
    test: '🧪 Tests',
    build: '📦 Build System',
    ci: '🔧 CI/CD',
    chore: '🔧 Chores',
    other: '📋 Other Changes'
  };
  generateFullChangelog(SECTION_TITLES);
  run('git add CHANGELOG.md');
  run('git commit --amend --no-edit');
  run(`git tag -d ${newTag}`);
  run(`git tag ${newTag}`);

  // 10. 推送
  console.log('\n【6/6】推送');
  if (!run('git push origin main')) process.exit(1);
  if (!run('git push origin --tags')) process.exit(1);
  if (!run('git push github main')) process.exit(1);
  if (!run('git push github --tags')) process.exit(1);

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║            ✅ 发布完成!                                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  版本: ${newPkg.version}`);
  console.log(`  标签: ${newTag}`);
  console.log('\n📌 GitHub Actions 将自动构建并发布安装包');
}

main().catch((err) => {
  console.error('✗ 发生错误:', err);
  process.exit(1);
});
