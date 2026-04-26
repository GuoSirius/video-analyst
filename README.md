# Video Analyst

视频分析工具桌面应用，基于 Electron + Vue 3 + TypeScript 构建。

## 下载安装

每个版本的安装包会在 GitHub Releases 页面发布：

**[Releases 页面](https://github.com/<username>/video-analyst/releases/latest)**

支持平台：
- **Windows**: `.exe` 安装包 (NSIS)
- **Linux**: `.AppImage` 通用包
- **macOS**: `.dmg` 磁盘镜像

## 开发环境要求

- Node.js 24+
- npm 10+

使用 nvm 安装：
```bash
nvm install 24
nvm use 24
```

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 代码检查 + 类型检查 + 构建
npm run build
```

## 代码提交流程

### 提交规范

commit message 格式：`<type>: <description>`

| 类型 | 版本更新 | 说明 |
|------|---------|------|
| `feat` | 次版本号 +1 | 新功能 |
| `fix` | 补丁版本号 +1 | Bug 修复 |
| `refactor` | 补丁版本号 +1 | 代码重构 |
| `perf` | 补丁版本号 +1 | 性能优化 |
| `docs` | 无更新 | 文档更新 |
| `chore` | 无更新 | 其他 |

### 完整发布流程

**一键发布（推荐）**：推送到 GitHub 和 Gitee，并自动构建

```bash
# 1. 提交代码（使用规范格式）
git add .
git commit -m "feat: 添加视频截图功能"

# 2. 一键发布：生成 CHANGELOG + 更新版本号 + 推送所有远程
npm run release:push
```

**分步执行**（可选）：

```bash
# 生成 CHANGELOG，更新版本号，创建 git tag
npm run release

# 推送到所有远程（GitHub + Gitee）
npm run push:all
```

### 各平台构建流程

| 操作 | 说明 |
|------|------|
| `npm run push` | 仅推送到默认 remote（GitHub） |
| `npm run push:all` | 推送到 GitHub 和 Gitee |
| `npm run release:push` | 一键完成：release + push:all |

### GitHub Actions 自动化

- **push 到 main 分支**：自动构建（Windows/macOS/Linux）
- **打 tag (v*)**：自动构建 + 创建 GitHub Release

### 手动指定版本

```bash
npm run release:major    # 主版本号 +1 (x.0.0)
npm run release:minor    # 次版本号 +1 (0.x.0)
npm run release:patch    # 补丁版本号 +1 (0.0.x)
```

## 技术栈

- Electron 36
- Vue 3.5 + Composition API
- TypeScript 5.9
- electron-vite 3
- Element Plus
- UnoCSS
