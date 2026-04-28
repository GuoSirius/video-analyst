#!/usr/bin/env node
/**
 * Release Script - 一站式版本发布脚本
 * 功能：代码检查 → 提交 → 校验 → 更新版本 → 更新 changelog → 打 tag → 发布
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const run = (cmd, options = {}) => {
  console.log(`\n▶ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
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

function selectReleaseType() {
  console.log('\n请选择发布类型:');
  RELEASE_TYPES.forEach((type, i) => {
    console.log(`  ${i + 1}. ${type.label.padEnd(6)} - ${type.desc}`);
  });

  return new Promise((resolve) => {
    import('readline').then(({ default: readline }) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question('\n请选择 (1-3，默认 1): ', (answer) => {
        rl.close();
        const idx = parseInt(answer || '1') - 1;
        resolve(RELEASE_TYPES[idx >= 0 && idx < 3 ? idx : 0]);
      });
    });
  });
}

function askQuestion(question) {
  return new Promise((resolve) => {
    import('readline').then(({ default: readline }) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  });
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
  console.log('\n🔍 运行代码检查...');
  if (!run('npm run lint')) {
    console.error('✗ Lint 检查失败');
    process.exit(1);
  }
  if (!run('npm run typecheck')) {
    console.error('✗ TypeScript 类型检查失败');
    process.exit(1);
  }
  console.log('✓ 代码检查通过');

  // 3. 提交代码（如果有未提交的更改）
  if (status) {
    console.log('\n📋 待提交的更改:');
    console.log(status);

    const commitMsg = await askQuestion('\n请输入提交信息（或按回车使用默认值 "chore: 发布新版本"）: ');
    const msg = commitMsg.trim() || 'chore: 发布新版本';

    console.log(`\n📝 提交信息: ${msg}`);
    run('git add -A');
    if (!run(`git commit -m "${msg}"`)) {
      process.exit(1);
    }
  } else {
    console.log('\n✓ 无需提交，已同步到最新代码');
  }

  // 4. 拉取最新代码
  console.log('\n📥 拉取远程最新代码...');
  run('git fetch origin');
  run('git fetch github');

  // 5. 选择发布类型
  const releaseType = await selectReleaseType();
  console.log(`\n✓ 选择发布类型: ${releaseType.label}`);

  // 6. 获取当前版本
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  const currentVersion = pkg.version;
  console.log(`\n📦 当前版本: ${currentVersion}`);

  // 7. 生成新版本号
  const [major, minor, patch] = currentVersion.split('.').map(Number);
  let newVersion;
  if (releaseType.value === 'major') {
    newVersion = `${major + 1}.0.0`;
  } else if (releaseType.value === 'minor') {
    newVersion = `${major}.${minor + 1}.0`;
  } else {
    newVersion = `${major}.${minor}.${patch + 1}`;
  }
  console.log(`📦 新版本: ${newVersion}`);

  // 8. 确认发布
  const confirm = await askQuestion(`\n确认发布 ${newVersion}? (Y/n): `);
  if (confirm?.toLowerCase() === 'n') {
    console.log('已取消');
    process.exit(0);
  }

  // 9. 生成当前版本的发布说明
  const releaseNotes = generateReleaseNotes(currentVersion, newVersion);

  // 10. 运行 standard-version（更新版本、CHANGELOG、打 tag）
  console.log('\n🔄 更新版本和 CHANGELOG...');
  if (!run(`npx standard-version --release-as ${releaseType.value}`)) {
    process.exit(1);
  }

  // 11. 获取新 tag
  const newTag = `v${newVersion}`;
  console.log(`\n🏷️  新标签: ${newTag}`);

  // 12. 写入 GitHub Release 说明
  const releaseNotesPath = path.join(__dirname, '..', 'RELEASE_NOTES.md');
  writeFileSync(releaseNotesPath, releaseNotes, 'utf-8');
  run('git add RELEASE_NOTES.md');
  run(`git commit --amend --no-edit`);
  run(`git tag -d ${newTag}`);
  run(`git tag ${newTag}`);

  // 13. 推送到 origin (gitee)
  console.log('\n📤 推送到 origin (gitee)...');
  if (!run('git push origin main')) process.exit(1);
  if (!run('git push origin --tags')) process.exit(1);

  // 14. 推送到 github
  console.log('\n📤 推送到 github...');
  if (!run('git push github main')) process.exit(1);
  if (!run('git push github --tags')) process.exit(1);

  // 15. 清理临时文件
  if (existsSync(releaseNotesPath)) {
    const { unlinkSync } = await import('fs');
    unlinkSync(releaseNotesPath);
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║            ✅ 发布完成!                                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\n  版本: ${newVersion}`);
  console.log('  标签: ' + newTag);
  console.log('  远程: origin (gitee), github');
  console.log('\n📌 GitHub Actions 将自动构建并发布安装包');
}

/**
 * 生成 GitHub Release 发布说明（仅包含当前版本提交）
 */
function generateReleaseNotes(fromTag, toVersion) {
  try {
    const commits = exec(`git log --oneline v${fromTag}..HEAD --format="%h %s"`)
      .split('\n')
      .filter(line => line.trim());

    if (commits.length === 0) {
      return `# ${toVersion}\n\n暂无更新内容\n`;
    }

    const typeGroups = {
      feat: { title: '✨ Features (新功能)', commits: [] },
      fix: { title: '🐛 Bug Fixes (Bug 修复)', commits: [] },
      perf: { title: '⚡ Performance Improvements (性能优化)', commits: [] },
      refactor: { title: '🔄 Code Refactoring (重构)', commits: [] },
      docs: { title: '📝 Documentation (文档)', commits: [] },
      style: { title: '💄 Styles (样式)', commits: [] },
      test: { title: '🧪 Tests (测试)', commits: [] },
      build: { title: '📦 Build System (构建)', commits: [] },
      ci: { title: '🔧 CI/CD', commits: [] },
      chore: { title: '🔧 Chores (其他)', commits: [] },
    };

    commits.forEach((commit) => {
      const match = commit.match(/^([a-f0-9]+)\s+(.+)$/);
      if (!match) return;
      const [, hash, message] = match;

      const typeMatch = message.match(/^(\w+)(\(.+\))?:\s*(.+)$/);
      if (typeMatch) {
        const [, type, scope, desc] = typeMatch;
        const scopeStr = scope ? `**${scope}** ` : '';
        const formatted = `${scopeStr}${desc} (${hash})`;
        if (typeGroups[type]) {
          typeGroups[type].commits.push(formatted);
        } else {
          typeGroups.chore.commits.push(formatted);
        }
      } else {
        typeGroups.chore.commits.push(`${message} (${hash})`);
      }
    });

    const lines = [`# ${toVersion}\n`];

    Object.values(typeGroups).forEach(({ title, commits }) => {
      if (commits.length > 0) {
        lines.push(`\n## ${title}\n`);
        commits.forEach(msg => lines.push(`- ${msg}`));
      }
    });

    return lines.join('\n');
  } catch {
    return `# ${toVersion}\n\n暂无更新内容\n`;
  }
}

main().catch((err) => {
  console.error('✗ 发生错误:', err);
  process.exit(1);
});
