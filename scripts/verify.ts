import { validateSnapshot, validateDist } from "./validate.ts";
import { json } from "./io.ts";
const snapshot = await validateSnapshot(
  process.env.MIRROR_SNAPSHOT ||
    (process.argv.includes("--fixtures")
      ? ".mirror/fixtures"
      : ".mirror/current"),
);
const dist = await validateDist();
if (snapshot.snapshotId !== dist.snapshotId)
  throw Error("构建与当前成功快照不同");
await json("reports/verify.json", {
  time: new Date().toISOString(),
  snapshot,
  dist,
});
console.log({ snapshot, dist });
