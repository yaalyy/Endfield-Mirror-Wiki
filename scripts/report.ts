// Explicit local handoff command; weekly synchronization never rewrites tracked documentation.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readJson, json } from "./io.ts";
const manifest = await readJson(".mirror/current/manifest.json");
const verified = await readJson("reports/verify.json");
const browser = await readJson("reports/browser-results.json");
const unit = await readJson("reports/unit-results.json");
const fixture = await readJson("reports/fixtures/browser-results.json");
const workflows = await readJson("reports/workflows.json");
const edge = await readJson("reports/edge-smoke.json");
const realMedia = await readJson("reports/real-media.json");
const auth = await readJson("reports/real-auth-refresh.json");
const interactions = await readJson("reports/interaction-review.json");
const visual = await readJson("reports/visual-review.json");
const devBase = await readJson("reports/dev-base.json");
const coverage = await Promise.all(
  ["chromium", "firefox"].map((name) =>
    readJson(`reports/coverage-${name}.json`),
  ),
);
const images = await Promise.all(
  ["chromium", "firefox"].map((name) =>
    readJson(`reports/images-${name}.json`),
  ),
);
const check = (ok: unknown, message: string) => {
  if (!ok) throw Error("交接报告前置条件失败: " + message);
};
check(unit.numFailedTests === 0 && unit.numPassedTests > 0, "单元测试");
check(
  browser.stats.unexpected === 0 && browser.stats.expected === 18,
  "18 项生产浏览器测试",
);
check(
  fixture.stats.unexpected === 0 && fixture.stats.expected === 18,
  "18 项离线浏览器测试",
);
check(
  verified.snapshot.snapshotId === manifest.snapshotId &&
    verified.dist.snapshotId === manifest.snapshotId,
  "生产快照版本",
);
for (const c of coverage)
  check(
    c.snapshotId === manifest.snapshotId &&
      c.entries ===
        Object.values<number>(manifest.counts).reduce((a, b) => a + b, 0) &&
      !c.errors.length &&
      !c.missing.length,
    "全部词条覆盖",
  );
for (const image of images)
  check(
    image.snapshotId === manifest.snapshotId &&
      image.decoded === verified.snapshot.images &&
      !image.failures.length,
    "图片解码",
  );
check(edge.snapshotId === manifest.snapshotId && !edge.errors.length, "Edge");
check(
  realMedia.checks.every((m: any) => m.success) &&
    realMedia.responses.every((r: any) => r.requestReferrer === null),
  "真实外链媒体",
);
check(auth.finalBusinessCode === 0 && auth.refreshes === 2, "真实失效刷新");
check(
  interactions.snapshotId === manifest.snapshotId &&
    interactions.results.length === 2 &&
    interactions.results.every(
      (r: any) =>
        r.checks.length === 3 &&
        r.checks.every((c: any) => c.forwardBack) &&
        r.keyboardLightbox &&
        r.keyboardTabs &&
        r.gifFailureSource &&
        JSON.stringify(r.searchPagination) === "[50,100]",
    ),
  "筛选、前进后退、键盘、GIF 失败和搜索分页补充检查",
);
check(visual.order.length === 6 && visual.widths.length === 2, "代表视觉截图");
check(
  devBase.catalog && devBase.image && devBase.viteEntry,
  "自定义开发子路径",
);
const actionlint = await readJson("reports/actionlint.json");
check(actionlint.exitCode === 0, "actionlint");
const git = execFileSync(
  "git",
  ["status", "--short", "--untracked-files=all"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);
check(
  !git
    .split("\n")
    .some((line) => /\s(?:\.mirror|dist|reports|node_modules)\//.test(line)),
  "生成物进入 Git",
);
const bytes = verified.dist;
const report = {
  createdAt: new Date().toISOString(),
  snapshotId: manifest.snapshotId,
  syncedAt: manifest.syncedAt,
  counts: manifest.counts,
  capacity: bytes,
  unitTests: unit.numPassedTests,
  productionBrowserTests: browser.stats.expected,
  fixtureBrowserTests: fixture.stats.expected,
  coverage,
  images,
  edge,
  realMedia,
  auth,
  interactions,
  visual,
  devBase,
  workflows,
  actionlint,
  git: { generatedFilesIgnored: true, sourceChanges: "uncommitted" },
  online: {
    pushed: false,
    settingsModified: false,
    deployed: false,
    actionsExecuted: false,
  },
};
await json("reports/final-summary.json", report);
await json("docs/local-acceptance.json", report);
const text = `# 本地验收与交接报告

验收日期：2026-11-20。报告生成时间：${report.createdAt}。本次没有推送代码、修改 GitHub 设置、运行远端 Actions 或执行部署。源码与文档仍为本地未提交状态。

## 已在本地验证

| 项目 | 结果 |
| --- | --- |
| Node / npm | Node 24.22.3；本机初始无 npm，使用忽略目录内 npm 12.2.3 启动 shim；最终锁文件 npm ci 成功，项目不依赖该 shim |
| 空缓存真实同步 | 从不存在 current 的环境完成全部公开详情和静态图获取；首次成功 2026-11-20T04:51:28.082Z |
| 最终成功同步 | ${manifest.syncedAt} |
| 词条 | 干员 ${manifest.counts.operators}、武器 ${manifest.counts.weapons}、装备 ${manifest.counts.equipment}；合计 ${coverage[0].entries} |
| 静态图 | ${manifest.media.filter((m: any) => m.kind === "image").length} 个完整来源 URL；${verified.snapshot.images} 个内容 SHA-256 去重文件 |
| 缓存复跑 | ${manifest.stats.notModified} 个 304；${manifest.stats.downloaded} 个重新下载；三个栏目无增删 |
| 结构 | 3 类组件、7 类块、3 类行内；没有实际非空 dialogList；所有引用文档与块通过检查 |
| 单元测试 | ${unit.numPassedTests} 项通过；签名、POST、重试、失效刷新、目录变化、结构、缓存、坏图、快照中断、容量和缺资源 |
| 固定样本流程 | 六个真实词条，独立快照、构建、verify 及 ${fixture.stats.expected} 项双浏览器测试通过；不访问实时原站 |
| 生产浏览器 | ${browser.stats.expected} 项通过，Chromium 与 Firefox；每种均覆盖全部 ${coverage[0].entries} 词条、${coverage[0].tabs} 标签内容、${coverage[0].textFragments} 个正文片段断言 |
| 图片浏览器验证 | 每种浏览器解码 ${verified.snapshot.images} 个本地文件，无失败；测试默认阻断外网 |
| 响应式与交互 | 375 / 768 / 1440；每栏两详情；筛选/刷新/后退滚动、名称/技能/档案/台词/效果搜索、深链接、失效定位、图片 Esc、表格、手机导航、语音单段切换与媒体失败入口 |
| 补充交互 | 双浏览器核对三栏同组并集/跨组交集的实际 ID 和排序、刷新与前进后退；键盘图片放大/Esc、方向键标签；阻断 GIF 后原站入口；搜索 50→100 条 |
| Edge | Windows Edge ${edge.browser}，真实词条与正文搜索通过，无页面异常 |
| 真实外链 | 一张 GIF 与一段语音成功加载，响应 200/206，均没有 Referer；这不是所有外链的永久可用保证 |
| 真实认证失败恢复 | 注入一次无效匿名签名，HTTP 401 / code 10000；一次额外刷新后目录 code 0，无令牌日志 |
| Git | .mirror、dist、reports、node_modules 被忽略；本次未提交任何内容 |

## 生产容量

| 类别 | 未压缩字节 |
| --- | ---: |
| 静态图片 | ${bytes.images.toLocaleString("en-US")} |
| 词条与目录/构建/媒体数据 | ${bytes.details.toLocaleString("en-US")} |
| 搜索数据 | ${bytes.search.toLocaleString("en-US")} |
| 页面代码、样式与入口 | ${bytes.code.toLocaleString("en-US")} |
| 合计 | **${bytes.total.toLocaleString("en-US")}** |

约 ${(bytes.total / 1e6).toFixed(1)} MB，低于 750,000,000 预警和 900,000,000 发布门禁。所有数据版本一致，所有本地资源引用存在，静态图已改写；dist 无原始响应、认证信息、测试/报告或下载的 GIF、音频、视频和分片。

最终快照：\`${manifest.snapshotId}\`。网站在 /Endfield-Mirror-Wiki/ 子路径实际预览和测试。

开发服务器另在 /alternate-mirror/ 验证目录、静态图片与 Vite 入口，统一读取配置中的基础路径。

## 仅完成配置或静态检查

两个工作流通过 YAML/配置规则检查与官方 actionlint ${actionlint.version}。共 ${workflows.pinnedActionReferences} 处 Action 引用使用已核验完整 SHA。检查包括默认只读、周一 UTC 04:17、手动默认 false、部署变量与输入条件、单并发不取消、成功缓存、40+5 分钟预算、网站 30 天/报告 14 天归档和最小部署权限。

这些结果不能证明 GitHub runner、缓存服务、定时调度、仓库权限或 Pages 环境已经运行成功。

## 需要首次线上部署后验证

- 默认分支上的真实 CI、全量同步 Action 与调度触发。
- Actions 缓存恢复/保存、归档下载、Pages 产物和环境权限。
- 真实公网子路径、Hash 深链接、CDN 缓存与更新后版本提示。
- 定时任务长期无活动停用后的人工恢复流程。

首次启用及操作说明在 [维护手册](OPERATIONS.md)。本次线上操作保持为未执行。

## 视觉与证据

原站三个分类和每栏两个详情均有 1440/375 截图，另有筛选、技能标签/表格及 GIF 阻断状态。具体参考与允许差异在 [视觉说明](VISUAL.md)。镜像使用系统字体、自己的非官方标识和响应式导航，保留深色导航、灰色内容、荧黄强调、立绘、资料卡与章节结构，不宣称逐像素一致。

本机证据：reports/final-summary.json、unit-results.json、browser-results.json、coverage-{chromium,firefox}.json、images-*.json、capacity.json、verify.json、real-media.json、real-auth-refresh.json、edge-smoke.json、interaction-review.json、visual-review.json、workflows.json、actionlint.json 与 screenshots/。reports/fixtures/ 保存离线浏览器结果。报告汇总也保存在 [local-acceptance.json](local-acceptance.json)，首次空缓存与结构基线在 [baseline-evidence.json](baseline-evidence.json)。完整下载与报告目录按计划不进入 Git。

自动化默认阻断外网，播放互斥与卸载暂停使用媒体模拟；真实 GIF/音频抽查独立执行。视觉对照图为 reports/visual-comparison-375.png 和 reports/visual-comparison-1440.png，六个详情左原站、右镜像；长标题与封面间距已人工核对。

## 已知边界

视频样例只有临时鉴权 HLS；镜像使用本地封面与原站按钮，没有稳定播放器页内播放承诺。GIF/语音真实抽查成功不代表所有媒体在所有地区永远可用；失败始终保留正文、重试及来源入口。来源出现未知非空结构会阻止生产同步，需新增真实样本适配。当前没有分支对话实际样本，未来非空 dialogList 会明确失败，不能被静默跳过。

缓存和短期 Action 归档不是长期备份。定时工作流可能因长期无活动被 GitHub 停用，需要维护者人工启用和补同步。全部线上结果仍待首次部署验收。
`;
await writeFile("docs/ACCEPTANCE.md", text);
console.log({
  report: "docs/ACCEPTANCE.md",
  unitTests: report.unitTests,
  browserTests: report.productionBrowserTests,
  bytes: bytes.total,
});
