#!/usr/bin/env node
/**
 * Interactive Release Script
 * 交互式发布脚本 - 一站式完成提交、版本发布、推送
 */

import { execSync } from 'child_process';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

const run = (cmd, options = {}) => {
  console.log(`\n📦 执行: ${cmd}\n`);
  try {
    execSync(cmd, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    console.error(`❌ 命令执行失败: ${cmd}`);
    return false;
  }
};

const COMMIT_TYPES = [
  { value: 'feat', label: 'feat', desc: '新功能' },
  { value: 'fix', label: 'fix', desc: 'Bug 修复' },
  { value: 'docs', label: 'docs', desc: '文档更新' },
  { value: 'style', label: 'style', desc: '代码格式（不影响功能）' },
  { value: 'refactor', label: 'refactor', desc: '重构' },
  { value: 'perf', label: 'perf', desc: '性能优化' },
  { value: 'test', label: 'test', desc: '测试相关' },
  { value: 'build', label: 'build', desc: '构建相关' },
  { value: 'ci', label: 'ci', desc: 'CI 配置' },
  { value: 'chore', label: 'chore', desc: '其他修改' },
];

const SCOPES = [
  { value: '', label: '无 scope' },
  { value: 'core', label: 'core - 核心模块' },
  { value: 'ui', label: 'ui - 界面' },
  { value: 'api', label: 'api - 接口' },
  { value: 'config', label: 'config - 配置' },
  { value: 'deps', label: 'deps - 依赖' },
  { value: 'workflow', label: 'workflow - 工作流' },
];

const RELEASE_TYPES = [
  { value: 'patch', label: 'patch (1.2.3 → 1.2.4)', desc: '补丁版本 - Bug 修复' },
  { value: 'minor', label: 'minor (1.2.3 → 1.3.0)', desc: '次版本 - 新功能' },
  { value: 'major', label: 'major (1.2.3 → 2.0.0)', desc: '主版本 - 破坏性变更' },
];

async function selectOption(options, prompt) {
  console.log(`\n${prompt}`);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt.label} ${opt.desc ? `- ${opt.desc}` : ''}`);
  });
  const idx = await question(`\n请选择 (1-${options.length}): `);
  const index = parseInt(idx) - 1;
  return options[index >= 0 && index < options.length ? index : 0];
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         🚀 Video Analyst 交互式发布脚本 🚀                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  // 检查 git 状态
  try {
    execSync('git status', { stdio: 'pipe' });
  } catch {
    console.error('❌ 当前目录不是 Git 仓库');
    process.exit(1);
  }

  // 检查是否有未提交的更改
  const status = execSync('git status --porcelain').toString().trim();
  let needsCommit = status.length > 0;

  if (needsCommit) {
    console.log('\n📋 待提交的更改:');
    console.log(status.split('\n').map(line => `   ${line}`).join('\n'));
  }

  // 选择操作模式
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  选择操作模式                                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  1. 📝 仅提交代码 (不发布)');
  console.log('  2. 🚀 提交并发布 (包含版本升级和 CHANGELOG)');
  console.log('  3. 🏷️  仅推送现有 tag');
  console.log('  4. 📜 查看当前状态');
  console.log('  5. ❌ 退出');

  const mode = await question('\n请选择 (1-5): ');

  if (mode === '5' || mode === 'q' || mode === 'Q') {
    console.log('👋 已取消');
    rl.close();
    process.exit(0);
  }

  if (mode === '4') {
    console.log('\n📊 Git 状态:');
    run('git status');
    console.log('\n📋 最近提交:');
    run('git log --oneline -10');
    console.log('\n🏷️  现有标签:');
    run('git tag -l --sort=-version:refname | head -10');
    rl.close();
    process.exit(0);
  }

  // 仅推送 tag
  if (mode === '3') {
    const remote = await question('\n推送所有 tag 到哪个远程? (1. origin / 2. github / 3. 所有): ');
    if (remote === '1' || remote === '') {
      run('git push origin --tags');
    } else if (remote === '2') {
      run('git push github --tags');
    } else {
      run('git push origin --tags && git push github --tags');
    }
    rl.close();
    process.exit(0);
  }

  // 需要先提交
  if (mode === '1' || mode === '2') {
    if (!needsCommit) {
      console.log('\n⚠️  没有需要提交的更改');
      const cont = await question('是否继续执行发布流程? (y/N): ');
      if (cont.toLowerCase() !== 'y') {
        rl.close();
        process.exit(0);
      }
    } else {
      // 选择 commit 类型
      const typeOpt = await selectOption(COMMIT_TYPES, '选择提交类型:');
      const scopeOpt = await selectOption(SCOPES, '选择影响范围:');

      // 输入描述
      const desc = await question('\n请输入提交描述 (简短描述): ');
      if (!desc.trim()) {
        console.error('❌ 描述不能为空');
        rl.close();
        process.exit(1);
      }

      // 确认提交
      const scopeStr = scopeOpt.value ? `(${scopeOpt.value})` : '';
      const commitMsg = `${typeOpt.value}${scopeStr}: ${desc.trim()}`;

      console.log(`\n📝 提交信息: ${commitMsg}`);

      const confirm = await question('确认提交? (Y/n): ');
      if (confirm.toLowerCase() === 'n') {
        console.log('👋 已取消');
        rl.close();
        process.exit(0);
      }

      // 执行提交
      run('git add -A');
      if (!run(`git commit -m "${commitMsg}"`)) {
        rl.close();
        process.exit(1);
      }
    }
  }

  // 发布版本
  if (mode === '2') {
    const releaseOpt = await selectOption(RELEASE_TYPES, '选择发布类型:');

    const confirm = await question(`\n确认发布 ${releaseOpt.value} 版本? (Y/n): `);
    if (confirm.toLowerCase() === 'n') {
      console.log('👋 已取消');
      rl.close();
      process.exit(0);
    }

    // 执行 standard-version
    console.log(`\n🚀 执行 standard-version (${releaseOpt.value})...`);
    if (!run(`npx standard-version --release-as ${releaseOpt.value}`)) {
      rl.close();
      process.exit(1);
    }
  }

  // 选择推送目标
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  选择推送目标                                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('  1. origin (gitee)');
  console.log('  2. github');
  console.log('  3. 全部推送 (origin + github)');

  const pushTarget = await question('\n请选择 (1-3): ');

  let pushed = false;
  if (pushTarget === '1' || pushTarget === '') {
    console.log('\n📤 推送到 origin...');
    pushed = run('git push origin main');
    if (mode === '2') {
      run('git push origin --tags');
    }
  } else if (pushTarget === '2') {
    console.log('\n📤 推送到 github...');
    pushed = run('git push github main');
    if (mode === '2') {
      run('git push github --tags');
    }
  } else if (pushTarget === '3') {
    console.log('\n📤 推送到所有远程...');
    pushed = run('git push origin main && git push github main');
    if (mode === '2') {
      run('git push origin --tags && git push github --tags');
    }
  }

  // 完成
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ 操作完成!                                                ║');
  console.log('╚════════════════════════════════════════════════════════════╝');

  if (mode === '2') {
    console.log('\n📌 提示:');
    console.log('   - GitHub Actions 将自动构建三个平台的安装包');
    console.log('   - 构建完成后，请手动创建 GitHub Release (如有需要)');
    console.log('   - 或使用 softprops/action-gh-release 自动发布');
  }

  rl.close();
}

main().catch((err) => {
  console.error('❌ 发生错误:', err);
  rl.close();
  process.exit(1);
});
