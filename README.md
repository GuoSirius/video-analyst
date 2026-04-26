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

**推送代码到 main 分支后，CI/CD 自动完成：**
1. 自动生成 CHANGELOG
2. 自动更新版本号
3. 自动构建安装包
4. 自动发布 Release

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

### 提交流程

```bash
# 1. 提交代码（使用规范格式）
git add .
git commit -m "feat: 添加视频截图功能"
git push

# 2. CI/CD 自动完成后续流程
# - Version Release: 生成 CHANGELOG + 更新版本号 + 推送 tag
# - Build: 编译代码 + 构建安装包
# - Release: 发布到 GitHub Releases
```

### 本地发布（可选）

如果需要手动发布：

```bash
npm run release          # 自动根据 commit 类型更新版本号
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
