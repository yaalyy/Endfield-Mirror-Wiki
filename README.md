# 终末地Wiki镜像

面向海外访问的非官方 GitHub Pages 静态镜像，完整覆盖干员、武器、装备三个公开栏目。文字与静态图片本地提供，GIF、语音、视频保留来源外链。页面支持中文全文搜索、来源筛选、章节/标签深链接、图片放大和手机浏览。


## 开始使用

安装 Node.js **24.x**（包含 npm），在项目根目录运行以下命令。PowerShell 与 Linux 使用同一套 npm 命令。

```text
npm ci
npm run sync
npm run dev
```

开发地址由终端打印；默认基础路径为 `/Endfield-Mirror-Wiki/`。同步会通过公开读取接口下载当前三个栏目的所有详情和必要静态图片，首次约数百 MB。来源新增词条会自动纳入。不会提交任何生成物到 Git。

无网络时，可以使用仓库内六个真实固定样本预览。测试图片使用明确的 1×1 PNG 占位，数据带固定样本标识；这不是正式生产内容。

```text
npm run prepare:fixtures
npm run dev -- --fixtures
npm run build -- --fixtures
npm run verify -- --fixtures
```

样本放在独立的 `.mirror/fixtures/`，不会覆盖真实 `.mirror/current/`。没有成功快照时 dev/build 会报出明确指引，不会展示空站。

## 常用命令

| 命令                               | 功能                                   |
| ---------------------------------- | -------------------------------------- |
| `npm ci`                           | 按 package-lock.json 安装              |
| `npm run sync`                     | 完整同步，验证/复用图片缓存            |
| `npm run sync -- --force`          | 图片不使用条件校验缓存，全部重取       |
| `npm run sync -- --allow-removals` | 接受任一栏目超过 10% 的真实删除        |
| `npm run prepare:fixtures`         | 生成独立离线样本快照                   |
| `npm run dev`                      | 使用成功快照启动开发服务器             |
| `npm run build`                    | 清理 dist 后从成功快照构建；不隐式联网 |
| `npm run preview`                  | 预览生产子路径，通常为端口 4173        |
| `npm run typecheck`                | TypeScript 检查                        |
| `npm test`                         | 单元、网络模拟、存储和门禁测试         |
| `npm run test:e2e`                 | Chromium/Firefox 浏览器测试，读取 dist |
| `npm run verify`                   | 类型、快照、全部资源与产物容量检查     |

首次运行浏览器测试前执行 `npx playwright install chromium firefox`。Linux CI 使用 `npx playwright install --with-deps chromium firefox`。测试会遍历当前 dist 的每一个词条、每一个标签页并核对正文片段；全量数据测试比固定样本耗时更长。测试中的外链媒体默认阻断，避免批量下载语音。

正常生产验证顺序：

```text
npm test
npm run build
npm run verify
npm run test:e2e
```

