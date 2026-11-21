# 维护与部署

## 首次启用 Pages

1. 检查本地 README 的安装、完整同步、单测、构建、verify 与浏览器测试结果。
2. 由维护者将代码与 `.github/workflows/` 推送到默认分支。确认 `.mirror/`、dist、reports、node_modules 没有进入提交。
3. 仓库 Settings → Pages → Build and deployment → Source 选择 GitHub Actions。按仓库实际安全策略允许官方 Pages Actions 与部署环境。
4. Actions → Sync and Pages → Run workflow，先保持三个输入 false。确认只读构建成功，网站归档和报告齐全；此时不部署。
5. 确认后在 Settings → Secrets and variables → Actions → Variables 建立 `PAGES_DEPLOY_ENABLED`，值为严格小写 `true`。不用设置 API 密钥。
6. 再次手动运行，`publish=true`；其他输入通常 false。检查 deploy job、Pages 环境与 Pages 页面给出的 URL。
7. 线上检查项目子路径、Hash 直达刷新、395（或当轮实际数）词条、搜索 Worker、图片、媒体失败入口和更新提示，再把线上结果加入验收记录。

变量未设置、false 或其他值时都只构建。取消发布可将变量改为 false，现有站点不会因下次只读构建被清空。

## 每周与手动更新

每周一 UTC 04:17 调度，调度时间可能被 GitHub 延迟;

恢复方法：在仓库 Actions 中打开对应工作流，按 GitHub 界面重新启用；确认位于默认分支，然后手动补运行一次。是否发布仍由仓库变量及 publish 输入共同决定。

正常更新手动输入均 false；要立即发布则 publish=true。只有核实图片源变化或缓存问题才开 force_refresh；只有确认栏目大幅真实删除才开 allow_removals。不要用放开删除来掩盖接口返回不完整。

## 缓存、归档与恢复

缓存只含通过完整同步和验证的 `.mirror/current/`，键 `mirror-v1-<OS>-<runId>-<attempt>`，恢复前缀 `mirror-v1-<OS>-`。先恢复旧缓存，完成同步及全部验证，再用新的唯一键保存快照；通过缓存 API 确认当前分支的新键存在后，才删除同分支、同版本及 OS 前缀的其他快照。保存失败或无法确认新缓存时保留旧缓存；清理失败只警告，不阻断网站归档和发布。build job 需要 `actions: write` 权限执行清理。不可变缓存可能过期或被清理，缓存缺失会全量重建。格式变化需同步升级版本前缀；缓存不是长期备份。

每次成功构建保存网站归档 14 天，报告 7 天。网站归档可下载解压到本地 dist 后使用 preview 检查；若要重新发布，维护者可以新增一个从该归档按官方要求上传 Pages 的人工工作流，或使用原代码/快照重新构建。
清 Actions 缓存：在仓库 Actions → Caches 中删除对应 mirror-v1 前缀缓存，再手动运行。清本地网络缓存：通常 `npm run sync -- --force` 即可；要从零重建可先将 `.mirror/current/` 移到单独备份目录，再运行同步。确认路径后再做文件清理，不误删源码。

同步过程在独立 staging，不可访问的必要详情/图片、未知结构、目录连续变化或门禁超限都使本轮失败，不覆盖 current。成功才将旧 current 变为 previous。进程在切换的两个 rename 之间中断时，下次会从 previous 恢复 current。异常退出可能残留 `.mirror/sync.lock`；确认无同步进程后才删除该锁。成功同步清理 staging；失败保留临时快照辅助诊断，必要时人工清理。

失败发生在部署前时不会触碰线上站点。请查看运行摘要、reports/sync-error.json、结构路径、容量或浏览器失败截图；修复后再手动运行。不要以空内容、外部原图回退、删正文或忽略错误“修复”发布。

## 容量与路径

Pages 官方站点上限 1 GB；项目按所有未压缩文件字节求和，750MB 预警，超过 900MB 阻止。报告区分静态图、词条数据、搜索数据和页面代码。

默认 `SITE_BASE=/Endfield-Mirror-Wiki/`。如果迁移到新仓库名或根域名，构建时设置正确 SITE_BASE 并在相应子路径重新验收。所有路由采用 Hash，因此 Pages 不需要服务器路由重写。
