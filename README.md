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

## 技术栈

- Electron 36
- Vue 3.5 + Composition API
- TypeScript 5.9
- electron-vite 3
- Element Plus
- UnoCSS
