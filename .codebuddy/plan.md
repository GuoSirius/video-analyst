# Video Analyst - 视频分析工具项目计划

## 项目概述

Video Analyst 是一个基于 Electron + Vue3 的跨平台桌面应用，用于视频/音频文件的语音转文字和分析。

## 技术栈

- **构建工具**: electron-vite v3.1.0
- **前端框架**: Vue 3.5.32 + TypeScript 5.7.0
- **UI 组件库**: Element Plus 2.9.0
- **CSS 方案**: UnoCSS 66.0.0
- **状态管理**: Pinia 2.3.0
- **国际化**: vue-i18n 10.0.0
- **持久化存储**: electron-store 8.1.0
- **音频处理**: fluent-ffmpeg 2.1.3

## 开发阶段与进度

### 阶段 1: 项目初始化 (v0.1.0) ✅
- 使用 Vite 初始化 Vue3 + TypeScript 项目
- 配置 Electron 主进程、Element Plus 和 UnoCSS
- 创建基础项目结构和配置文件

### 阶段 2: 窗口管理 (v0.2.0) ✅
- 实现多窗口创建、拖拽、缩放
- 实现窗口最大化、最小化、关闭
- 实现窗口置顶、置底
- 实现窗口全屏、还原

### 阶段 3: 系统托盘 (v0.2.0) ✅
- 实现系统托盘图标创建
- 实现左键切换显示/隐藏窗口
- 实现右键菜单（显示窗口、退出应用）

### 阶段 4: 多语言和多主题 (v0.3.0) ✅
- 实现中英文切换（默认中文）
- 实现暗黑、亮色、自动模式（默认暗黑）
- 集成 Element Plus 国际化

### 阶段 5: 视频分析 UI (v0.4.0) ✅
- 实现自定义标题栏
- 实现文件/文件夹选择器
- 实现处理配置（子目录、递归层数、转文字方式）
- 实现任务列表展示

### 阶段 6: 音频提取和转文字 (v0.5.0) ✅
- 实现 ffmpeg 音频提取
- 实现本地 Whisper 模块转文字
- 实现云端 LLM API 转文字双模式
- 实现任务状态管理

### 阶段 7: 设置与进度管理 (v0.6.0) ✅
- 实现大模型配置 CRUD 管理
- 实现处理进度跟踪
- 实现异常恢复功能

### 阶段 8: 升级依赖和文档 (v0.7.0) 🔄
- 升级所有依赖到最新兼容版本
- 保存项目计划到 .codebuddy/plan.md

## 已完成功能

1. **窗口管理**: 多窗口、拖拽、缩放、最大化/最小化/关闭/置顶/全屏/还原
2. **系统托盘**: 托盘图标、左键切换显示/隐藏、右键菜单
3. **多语言**: 中英文切换，默认中文
4. **多主题**: 暗黑/亮色/自动模式，默认暗黑
5. **视频分析 UI**: 自定义标题栏、文件/文件夹选择器、任务列表
6. **音频提取和转文字**: ffmpeg 音频提取、本地 Whisper/云端 API 双模式
7. **设置管理**: 大模型配置 CRUD
8. **进度管理**: 任务状态持久化、异常恢复

## 待实现功能

1. **ffmpeg 集成**: 将 ffmpeg 二进制文件打包到应用中
2. **云端 API 完善**: 完善 OpenAI Whisper API、文心一言等云端 API 调用
3. **任务队列管理**: 实现任务队列，限制并发数
4. **文字后处理**: 使用大模型对转写文本进行总结、分析、整理
5. **打包和分发**: 使用 electron-builder 打包应用，支持 Windows、MacOS、Linux

## 项目结构

```
video-analyst/
├── electron/                # Electron 主进程和工具模块
│   ├── main.ts           # 主进程入口
│   ├── preload.ts        # 预加载脚本
│   ├── tray.ts           # 系统托盘管理
│   └── utils/           # 工具模块
│       ├── ffmpeg.ts     # ffmpeg 调用封装
│       └── transcription.ts # 转文字逻辑
├── src/                    # 渲染进程（Vue 应用）
│   ├── main.ts          # Vue 入口
│   ├── App.vue          # 根组件
│   ├── components/      # Vue 组件
│   │   └── AppHeader.vue # 自定义标题栏
│   ├── views/           # 页面组件
│   │   ├── Home.vue    # 首页/视频分析
│   │   └── Settings.vue # 设置页面
│   ├── router/          # Vue Router 配置
│   ├── store/           # Pinia 状态管理
│   │   ├── app.ts      # 应用状态
│   │   └── tasks.ts    # 任务状态
│   ├── i18n/            # 国际化
│   │   ├── index.ts    # vue-i18n 配置
│   │   └── locales/    # 语言包
│   ├── types/           # TypeScript 类型定义
│   └── style.css        # 全局样式
├── resources/             # 资源文件
│   └── icons/          # 应用图标、托盘图标
├── .codebuddy/           # CodeBuddy 配置和计划
│   └── plan.md         # 项目计划文档
├── electron.vite.config.ts # electron-vite 配置
├── package.json          # 项目依赖配置
└── tsconfig.json         # TypeScript 配置
```

## 版本历史

- **v0.1.0**: 项目初始化
- **v0.2.0**: 窗口管理和系统托盘
- **v0.3.0**: 多语言和多主题
- **v0.4.0**: 视频分析 UI
- **v0.5.0**: 音频提取和转文字
- **v0.6.0**: 设置与进度管理
- **v0.7.0**: 升级依赖和文档（当前版本）

## 后续计划

1. 完善云端 API 调用（OpenAI Whisper API、文心一言等）
2. 实现文字后处理功能（总结、分析、整理）
3. 实现任务队列管理，限制并发数
4. 打包和分发应用（Windows、MacOS、Linux）
5. 添加更多功能（视频预览、音频播放、文本编辑等）

## Gitee 仓库

项目代码已推送到 Gitee 仓库：https://gitee.com/siriussupreme/video-analyst.git

每个开发阶段完成后都会提交并推送代码，方便版本管理和后续迭代。
