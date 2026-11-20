import { cp, mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { build, createServer } from "vite";
import { exists, readJson, json } from "./io.ts";
import { validateSnapshot, validateDist } from "./validate.ts";
const root =
  process.env.MIRROR_SNAPSHOT ||
  (process.argv.includes("--fixtures")
    ? ".mirror/fixtures"
    : ".mirror/current");
if (!(await exists(join(root, "manifest.json"))))
  throw Error(
    "没有成功快照。请先运行 npm run sync 或 npm run prepare:fixtures。",
  );
await validateSnapshot(root);
if (process.argv[2] === "dev") {
  const server = await createServer({
    plugins: [
      {
        name: "mirror-data",
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            const pathname = decodeURIComponent((req.url || "").split("?")[0]);
            const path = (
              pathname.startsWith(server.config.base)
                ? pathname.slice(server.config.base.length)
                : pathname
            ).replace(/^\//, "");
            if (!path.startsWith("data/") && !path.startsWith("media/"))
              return next();
            if (path.includes("..") || path.includes("\\")) {
              res.statusCode = 400;
              res.end();
              return;
            }
            try {
              const data = await readFile(
                join(root, path.startsWith("data/") ? "processed" : "", path),
              );
              res.setHeader(
                "Content-Type",
                path.endsWith(".json")
                  ? "application/json"
                  : path.endsWith(".svg")
                    ? "image/svg+xml"
                    : path.endsWith(".webp")
                      ? "image/webp"
                      : path.endsWith(".png")
                        ? "image/png"
                        : "image/jpeg",
              );
              res.end(data);
            } catch {
              res.statusCode = 404;
              res.end("快照资源不存在");
            }
          });
        },
      },
    ],
  });
  await server.listen();
  server.printUrls();
} else {
  await rm("dist", { recursive: true, force: true });
  await build();
  await cp(join(root, "processed"), "dist", { recursive: true });
  const manifest = await readJson(join(root, "manifest.json"));
  await mkdir("dist/media", { recursive: true });
  for (const p of new Set<string>(
    manifest.media.map((m: any) => m.localPath).filter(Boolean),
  ))
    await cp(join(root, p), join("dist", p));
  const result = await validateDist();
  await json("reports/capacity.json", result);
  console.log("容量报告", result);
}
