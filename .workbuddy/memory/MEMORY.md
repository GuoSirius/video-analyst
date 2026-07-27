# 项目长期记忆 — video-analyst

## 仓库与 Git 约定
- 远程：origin = `https://gitee.com/siriussupreme/video-analyst.git`（另有 github remote）。推送需 gitee 凭据；本沙箱无存储 token，`git push` 会失败，需用户补凭据或手动 push。
- 用户硬规则：每次代码改动完成必须 commit 并 push（不必等确认），但不自动发布（npm publish/release）。
- main 与 origin/main 长期不同步风险：main 曾停留在早期提交 ed717c5，项目主体文件此前只在暂存区从未提交。新建功能分支前先确认基线。

## 本沙箱 git 操作的坑（可复用，详见每日日志）
- unborn 分支上 `git commit` 产生的 commit 会变 dangling（ref 不写入）；`git branch -f` / `git update-ref` 对含斜杠分支名静默失败（需新建 `.git/refs/heads/feature/` 子目录被沙箱拦）。
  - 可靠流程：`git commit-tree <tree> -p <parent> -F <msg>` 造对象 → `mkdir -p .git/refs/heads/feature && printf '<sha>\n' > .git/refs/heads/feature/whole-site-crawl` 直写 ref（需 sandbox 关闭）。
- `npx` 在本沙箱因 safe-delete(trash) 失败；typescript 未本地安装，编译后端用 npx 缓存的 tsc 或避开 npx。
- `git reset --hard HEAD` 在 main 为真实分支时正常，可修复「checkout 旧 main 导致工作树缺文件」的脏状态。

## 整站爬取（site 模式）关键事实
- `crawl_frontier` 表必须有 `UNIQUE(task_id, url)`，否则 `INSERT OR IGNORE` 去重失效（曾导致重复入队/访问/提取）。
- 测试 mock 站点用 127.0.0.1 会被生产 SSRF 防护拦截，测试需覆盖 `fetchHtml` 绕过 host 校验（不改生产代码）。
- 测试位置：`server/src/crawler/__tests__/site-crawl.test.ts`，24 项全绿。
