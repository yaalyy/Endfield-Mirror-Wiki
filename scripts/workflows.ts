import { parseDocument } from "yaml";
import { readFile, readdir } from "node:fs/promises";
import { readJson, json } from "./io.ts";
const pins = await readJson("docs/action-pins.json");
const known = new Map(pins.actions.map((p: any) => [p.repo, p.sha]));
const fail = (condition: unknown, reason: string) => {
  if (!condition) throw Error("工作流校验失败: " + reason);
};
let actionCount = 0;
const workflows: Record<string, any> = {};
for (const name of await readdir(".github/workflows")) {
  const text = await readFile(".github/workflows/" + name, "utf8");
  const doc = parseDocument(text, { uniqueKeys: true });
  fail(!doc.errors.length, name + " YAML " + doc.errors.map((e) => e.message));
  const w = doc.toJS();
  workflows[name] = w;
  fail(!w.on.pull_request_target, name + " 禁止 pull_request_target");
  fail(w.permissions?.contents === "read", name + " 默认只读");
  for (const [jobId, j] of Object.entries<any>(w.jobs)) {
    fail(j["runs-on"] === "ubuntu-24.04", jobId + " runner");
    fail(j["timeout-minutes"] > 0, jobId + " timeout");
    for (const step of j.steps || []) {
      if (step.uses) {
        const match = /^([^@]+)@([a-f0-9]{40})$/.exec(step.uses);
        fail(match, step.uses + " 必须完整 SHA");
        const repo = match![1].split("/").slice(0, 2).join("/");
        fail(known.get(repo) === match![2], step.uses + " 未经 pin 清单核验");
        actionCount++;
      }
      if (step.run)
        fail(
          !/git\s+(push|commit)|gh\s+/.test(step.run),
          "禁止工作流提交或远端修改",
        );
    }
  }
}
const ci = workflows["checks.yml"],
  sync = workflows["sync-pages.yml"];
fail("push" in ci.on && "pull_request" in ci.on, "CI 触发");
fail(sync.on.schedule[0].cron === "17 4 * * 1", "周一 UTC 04:17");
for (const key of ["force_refresh", "allow_removals", "publish"])
  fail(
    sync.on.workflow_dispatch.inputs[key].type === "boolean" &&
      sync.on.workflow_dispatch.inputs[key].default === false,
    key + " 默认 false",
  );
fail(sync.concurrency["cancel-in-progress"] === false, "不取消当前发布");
fail(sync.jobs.build.permissions.contents === "read", "构建只读");
fail(
  !sync.jobs.build.permissions.pages &&
    !sync.jobs.build.permissions["id-token"],
  "构建无部署权限",
);
fail(
  sync.jobs.deploy.permissions.pages === "write" &&
    sync.jobs.deploy.permissions["id-token"] === "write",
  "部署权限",
);
fail(Object.keys(sync.jobs.deploy.permissions).length === 2, "部署最小权限");
fail(
  sync.jobs.build["timeout-minutes"] + sync.jobs.deploy["timeout-minutes"] ===
    45,
  "构建与部署总超时 45 分钟",
);
fail(
  sync.jobs.deploy.if.includes("vars.PAGES_DEPLOY_ENABLED == 'true'") &&
    sync.jobs.deploy.if.includes(
      "github.event_name == 'schedule' || inputs.publish == true",
    ),
  "发布开关",
);
const save = sync.jobs.build.steps.find((s: any) => s.id === "save-cache");
fail(save["continue-on-error"] === true, "缓存保存失败仅警告");
fail(save.with.path === ".mirror/current", "只缓存成功快照");
fail(
  save.with.key ===
    "mirror-v1-${{ runner.os }}-${{ github.run_id }}-${{ github.run_attempt }}",
  "唯一缓存键",
);
const build = sync.jobs.build.steps;
fail(
  build.findIndex((s: any) => s.run === "npm run verify") < build.indexOf(save),
  "校验后保存",
);
const summary = {
  checkedAt: new Date().toISOString(),
  workflows: Object.keys(workflows),
  pinnedActionReferences: actionCount,
  validation:
    "YAML parse + semantic policy checks; does not execute GitHub Actions",
};
await json("reports/workflows.json", summary);
console.log(summary);
