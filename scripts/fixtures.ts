import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processSnapshot } from "./sync.ts";
import { readJson, sha } from "./io.ts";
import type { Media } from "../shared/types.ts";
export const fixturePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
  "base64",
);
export async function makeFixtures(root = ".mirror/fixtures") {
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, "media"), { recursive: true });
  const hash = sha(fixturePng);
  const localPath = `media/${hash}.png`;
  await writeFile(join(root, localPath), fixturePng);
  const raw = await readJson("tests/fixtures/catalog.json");
  const items = new Map();
  for (const id of ["2503", "2338", "2502", "2501", "2764", "2763"])
    items.set(id, (await readJson("tests/fixtures/" + id + ".json")).item);
  return processSnapshot(root, raw, items, {
    fixture: true,
    oldRoot: root,
    mediaLoader: async (url, hint) =>
      hint === "image"
        ? {
            url,
            kind: "image",
            localPath,
            sha256: hash,
            bytes: fixturePng.length,
          }
        : { url, kind: hint as Media["kind"], bytes: 0 },
  });
}
if (import.meta.filename === process.argv[1]) await makeFixtures();
