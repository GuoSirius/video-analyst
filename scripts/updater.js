/**
 * standard-version updater
 * 自定义版本更新逻辑
 */

import { readFileSync } from 'fs';

export default function updater(version, versionType, commitGroup, commitHash, prerelease) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
  pkg.version = version;
  return JSON.stringify(pkg, null, 2) + '\n';
}
