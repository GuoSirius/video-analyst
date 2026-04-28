import { execSync } from 'child_process';
import { writeFileSync } from 'fs';

const REPO_URL = 'https://github.com/GuoSirius/video-analyst';

const exec = (cmd) => execSync(cmd, { encoding: 'utf-8' }).trim();

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

const SECTION_ORDER = ['feat', 'fix', 'perf', 'refactor', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'other'];

function categorizeCommits(commits) {
  const groups = { feat: [], fix: [], perf: [], refactor: [], docs: [], style: [], test: [], build: [], ci: [], chore: [], other: [] };
  for (const c of commits) {
    const [msg, hash] = c.split('|');
    const url = `[${hash}](${REPO_URL}/commit/${hash})`;
    let type, desc;
    if (/^feat(\(.+\))?:/.test(msg)) { type = 'feat'; desc = msg.replace(/^feat(\(.+\))?:\s*/, ''); }
    else if (/^fix(\(.+\))?:/.test(msg)) { type = 'fix'; desc = msg.replace(/^fix(\(.+\))?:\s*/, ''); }
    else if (/^perf(\(.+\))?:/.test(msg)) { type = 'perf'; desc = msg.replace(/^perf(\(.+\))?:\s*/, ''); }
    else if (/^refactor(\(.+\))?:/.test(msg)) { type = 'refactor'; desc = msg.replace(/^refactor(\(.+\))?:\s*/, ''); }
    else if (/^docs(\(.+\))?:/.test(msg)) { type = 'docs'; desc = msg.replace(/^docs(\(.+\))?:\s*/, ''); }
    else if (/^style(\(.+\))?:/.test(msg)) { type = 'style'; desc = msg.replace(/^style(\(.+\))?:\s*/, ''); }
    else if (/^test(\(.+\))?:/.test(msg)) { type = 'test'; desc = msg.replace(/^test(\(.+\))?:\s*/, ''); }
    else if (/^build(\(.+\))?:/.test(msg)) { type = 'build'; desc = msg.replace(/^build(\(.+\))?:\s*/, ''); }
    else if (/^ci(\(.+\))?:/.test(msg)) { type = 'ci'; desc = msg.replace(/^ci(\(.+\))?:\s*/, ''); }
    else if (/^chore(\(.+\))?:/.test(msg)) { type = 'chore'; desc = msg.replace(/^chore(\(.+\))?:\s*/, ''); }
    else { type = 'other'; desc = msg; }
    groups[type].push(`- ${desc} ${url}`);
  }
  return groups;
}

function generateVersionBlock(version, prevVersion, commits) {
  const groups = categorizeCommits(commits);
  let block = `### [${version}](${REPO_URL}/compare/v${prevVersion}...v${version})\n\n`;
  let hasContent = false;
  for (const type of SECTION_ORDER) {
    if (groups[type] && groups[type].length > 0) {
      block += `\n### ${SECTION_TITLES[type]}\n\n`;
      block += groups[type].join('\n') + '\n';
      hasContent = true;
    }
  }
  if (!hasContent) block += '- No functional changes in this release\n';
  return block + '\n';
}

function getTags() {
  try {
    const tags = execSync('git tag -l "v*" --sort=-v:refname', { encoding: 'utf-8' }).trim().split('\n').filter(t => t);
    return tags.map(t => t.replace('v', ''));
  } catch { return []; }
}

function getCommits(fromTag, toTag) {
  const range = fromTag ? `v${fromTag}..v${toTag}` : `v${toTag}`;
  try {
    const commits = execSync(`git log ${range} --format="%s|%h"`, { encoding: 'utf-8' }).trim().split('\n').filter(c => c);
    return commits.filter(c => !/^chore\(release\):\s*\d+\.\d+\.\d+$/.test(c.split('|')[0]));
  } catch { return []; }
}

const tags = getTags();
let changelog = `# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

`;

for (let i = 0; i < tags.length; i++) {
  const version = tags[i];
  const prevVersion = i < tags.length - 1 ? tags[i + 1] : null;
  const commits = getCommits(prevVersion, version);
  changelog += generateVersionBlock(version, prevVersion || '0.0.0', commits);
}

writeFileSync('CHANGELOG.md', changelog, 'utf-8');
console.log(`✓ CHANGELOG generated with ${tags.length} versions`);
