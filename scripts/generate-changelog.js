import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const REPO_URL = 'https://github.com/GuoSirius/video-analyst';
const CHANGELOG_FILE = 'CHANGELOG.md';

// 获取所有标签
function getTags() {
  const tags = execSync('git tag -l "v*" --sort=-v:refname', { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(t => t);
  return tags.map(t => t.replace('v', ''));
}

// 获取版本间的所有提交
function getCommits(fromTag, toTag) {
  const range = fromTag ? `v${fromTag}..v${toTag}` : `v${toTag}`;
  const commits = execSync(`git log ${range} --format="%s|%h"`, { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(c => c);
  
  // 过滤掉版本发布提交
  return commits.filter(c => {
    const [msg] = c.split('|');
    return !/^chore\(release\):\s*\d+\.\d+\.\d+$/.test(msg);
  });
}

// 按类型分类提交
function categorizeCommits(commits) {
  const groups = {
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    build: [],
    ci: [],
    chore: [],
    other: []
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
  
  return groups;
}

const SECTION_TITLES = {
  feat: 'Features',
  fix: 'Bug Fixes',
  perf: 'Performance Improvements',
  refactor: 'Code Refactoring',
  docs: 'Documentation',
  build: 'Build System',
  ci: 'Continuous Integration',
  chore: 'Other Changes',
  other: 'Other Changes'
};

const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'build', 'ci', 'chore', 'other'];

// 生成版本块
function generateVersionBlock(version, prevVersion, commits) {
  const groups = categorizeCommits(commits);
  
  let block = `### [${version}](${REPO_URL}/compare/v${prevVersion}...v${version})\n\n`;
  
  let hasContent = false;
  for (const type of SECTION_ORDER) {
    if (groups[type].length > 0) {
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

// 主函数
function main() {
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
    
    changelog += generateVersionBlock(version, prevVersion || '0.0.0', commits);
  }

  writeFileSync(CHANGELOG_FILE, changelog, 'utf-8');
  console.log(`CHANGELOG generated successfully with ${tags.length} versions`);
}

main();
