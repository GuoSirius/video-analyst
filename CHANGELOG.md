# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.3.10](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.9...v1.3.10) (2026-04-27)


### Bug Fixes

* 修复构建产物文件匹配 pattern ([6babd6c](https://gitee.com/siriussupreme/video-analyst/commit/6babd6c01907f1c6692f8c224a2729e6076d49bf))

### [1.3.9](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.8...v1.3.9) (2026-04-26)


### Bug Fixes

* 修复 release 资产重复上传问题 ([994958e](https://gitee.com/siriussupreme/video-analyst/commit/994958ec86f6482bfe0b392d4c61b28e4216abbc))

### [1.3.7](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.6...v1.3.7) (2026-04-26)


### Features

* 添加交互式发布脚本 ([b212603](https://gitee.com/siriussupreme/video-analyst/commit/b212603d2d71e7147e223d014cd8d32b1cd48f7d))

### [1.3.6](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.5...v1.3.6) (2026-04-26)

### [1.3.4](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.3...v1.3.4) (2026-04-26)

### [1.3.3](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.2...v1.3.3) (2026-04-26)

### [1.3.2](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.1...v1.3.2) (2026-04-26)


### Bug Fixes

* 禁止 electron-builder 在 CI 中自动发布 ([2604684](https://gitee.com/siriussupreme/video-analyst/commit/2604684305217dc15606451945044df80055a6d0))

### [1.3.1](https://gitee.com/siriussupreme/video-analyst/compare/v1.3.0...v1.3.1) (2026-04-26)


### Bug Fixes

* add .npmrc ([d16b009](https://gitee.com/siriussupreme/video-analyst/commit/d16b0098841bfbbf436950564acd567146db4f48))

## [1.3.0](https://gitee.com/siriussupreme/video-analyst/compare/v1.2.0...v1.3.0) (2026-04-26)


### Features

* 添加 ESLint 规则确保 import 在文件顶部 ([49cf67c](https://gitee.com/siriussupreme/video-analyst/commit/49cf67ca8b3b04ef60afc4d17706fc32fbb7bd07))
* 添加前端更新提示组件 ([0568895](https://gitee.com/siriussupreme/video-analyst/commit/0568895e3e2dc9b11e040ece9d3976de4bfa9c55))


### Bug Fixes

* 完善 ESLint 配置并修复自动更新组件类型问题 ([9bbee00](https://gitee.com/siriussupreme/video-analyst/commit/9bbee009ac24d2a07ae518bfc4b7ae30dee4edb9))
* 修复 electron-updater ESM 导入问题 ([eb288eb](https://gitee.com/siriussupreme/video-analyst/commit/eb288eb61df41cfa5e15416a99c0db83cec367b1))

## [1.2.0](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.5...v1.2.0) (2026-04-26)


### Features

* 添加自动更新功能 (electron-updater) ([1c53b35](https://gitee.com/siriussupreme/video-analyst/commit/1c53b35ad873eca27731c632a394a7dd2172557c))

### [1.1.5](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.4...v1.1.5) (2026-04-26)


### Bug Fixes

* 避免 tag push 时重复执行构建 ([3eb5553](https://gitee.com/siriussupreme/video-analyst/commit/3eb55532d10e2aec1e5df2faae4f4341ecb8d56e))
* 调整 --publish never 参数位置 ([3786b00](https://gitee.com/siriussupreme/video-analyst/commit/3786b000dc3cbc1a483aa64658a9654a57727d4b))
* 禁用 electron-builder 自动发布 ([26352a5](https://gitee.com/siriussupreme/video-analyst/commit/26352a512dba84c4d833ffcc62d33d8e8b7be133))
* 在 electron-builder.yml 中配置 publish: never ([06f1425](https://gitee.com/siriussupreme/video-analyst/commit/06f14257e2c3114b9f961ad4aa2bb7f408a217d1))

### [1.1.4](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.3...v1.1.4) (2026-04-26)


### Bug Fixes

* 修复 electron-builder 构建命令参数 ([c527e41](https://gitee.com/siriussupreme/video-analyst/commit/c527e4190aa6771603b85c027292028eeda47b43))

### [1.1.3](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.2...v1.1.3) (2026-04-26)


### Bug Fixes

* 修复 electron-builder 多平台构建命令 ([31eea4f](https://gitee.com/siriussupreme/video-analyst/commit/31eea4f791886462bf11aae5f8e1e1161b47f197))
* 优化 CI/CD 触发条件，仅 tag push 时创建 Release ([74fd0c7](https://gitee.com/siriussupreme/video-analyst/commit/74fd0c7d15ccc1e339622dcb43eb1ef9f629a883))

### [1.1.2](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.1...v1.1.2) (2026-04-26)

### [1.1.1](https://gitee.com/siriussupreme/video-analyst/compare/v1.1.0...v1.1.1) (2026-04-26)

## [1.1.0](https://gitee.com/siriussupreme/video-analyst/compare/v1.0.2...v1.1.0) (2026-04-26)


### Features

* 优化 CI/CD 流程，自动化版本发布 ([a258aa0](https://gitee.com/siriussupreme/video-analyst/commit/a258aa0dd63d7ecfa286c737933d7bcff00dd70c))


### Bug Fixes

* 修复 Release tag 格式和 artifacts 路径 ([634b413](https://gitee.com/siriussupreme/video-analyst/commit/634b4135454fb6306645460921711638836f37bf))
* 修复 Windows PowerShell 命令兼容性问题 ([5eeeed0](https://gitee.com/siriussupreme/video-analyst/commit/5eeeed0f5cdac3bfd15597234965c27a0f96d8e6))
* github ([5ed9256](https://gitee.com/siriussupreme/video-analyst/commit/5ed9256df01ee95b0374f554d1bd1be841c938af))

### [1.0.2](https://gitee.com/siriussupreme/video-analyst/compare/v1.0.1...v1.0.2) (2026-04-26)


### Bug Fixes

* 添加 CI 环境系统依赖安装 ([f78aff7](https://gitee.com/siriussupreme/video-analyst/commit/f78aff756163f2775466fc376cc5b0240fe76c3c))
* 添加 electron-builder 依赖 ([4836d58](https://gitee.com/siriussupreme/video-analyst/commit/4836d58c2157a28d0719ab8ec0001f2faa39b239))
* 修复 macOS postinstall 脚本执行顺序 ([5fe06a0](https://gitee.com/siriussupreme/video-analyst/commit/5fe06a0ac7f2a4d7f6de069e134280fa20c8b1e7))
* 修正 Ubuntu 依赖包名称 ([e88d50d](https://gitee.com/siriussupreme/video-analyst/commit/e88d50d14036164a7829494e83d86fdc6fdbe274))
* add package-lock.json ([03a43cf](https://gitee.com/siriussupreme/video-analyst/commit/03a43cf83bba25102017abb9d42f87a7223ba52d))

### [1.0.1](https://gitee.com/siriussupreme/video-analyst/compare/v0.1.1...v1.0.1) (2026-04-26)


### Bug Fixes

* 排除 Electron 主进程和脚本文件的 console 检查 ([933d902](https://gitee.com/siriussupreme/video-analyst/commit/933d9025492a7628ed122e4d1ce015e3326e644e))

### 0.1.1 (2026-04-26)


### Features

* 侧边栏布局、Font Awesome 图标集成、窗口控制优化 ([98324cd](https://gitee.com/siriussupreme/video-analyst/commit/98324cd97bf1d7d6581212ec6aa0637d6b0f730c))
* 配置 ESLint + TypeScript 检查，添加 CI/CD 自动构建发布 ([1deece3](https://gitee.com/siriussupreme/video-analyst/commit/1deece320d541afcb1b384b014d905959f5347d5))
* 添加 standard-version 自动版本管理 ([55e08f9](https://gitee.com/siriussupreme/video-analyst/commit/55e08f941fc79757ebb6a6ec29e5112be05de606))
