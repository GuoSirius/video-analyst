# Video Analyst

视频分析工具桌面应用，基于 Electron + Vue 3 + TypeScript 构建。

## 下载安装

每个版本的安装包会在 GitHub Releases 页面发布：

**[Releases 页面](https://github.com/<username>/video-analyst/releases/latest)**

支持平台：
- **Windows**: `.exe` 安装包 (NSIS)
- **Linux**: `.AppImage` 通用包
- **macOS**: `.dmg` 磁盘镜像

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建（生产环境检查 console/debugger）
npm run build

# 代码检查
npm run lint

# 类型检查
npm run typecheck
```

## 发布版本

使用 Conventional Commits 规范提交代码，运行以下命令发布新版本：

```bash
# 自动根据 commit 类型更新版本号
npm run release

# 指定主版本号 (x.0.0)
npm run release:major

# 指定次版本号 (0.x.0)
npm run release:minor

# 指定补丁版本号 (0.0.x)
npm run release:patch
```

### 提交规范

commit message 格式：`<type>: <description>`

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `docs` | 文档更新 |
| `style` | 代码格式 |
| `test` | 测试 |
| `build` | 构建相关 |
| `ci` | CI 相关 |
| `chore` | 其他 |

示例：
```bash
git add .
git commit -m "feat: 添加视频截图功能"
git push
npm run release
```

## 技术栈

- Electron 36
- Vue 3.5 + Composition API
- TypeScript 5.9
- electron-vite 3
- Element Plus
- UnoCSS
