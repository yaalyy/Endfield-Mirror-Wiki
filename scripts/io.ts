import { mkdir, readFile, writeFile, stat, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
export const sha = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export async function readJson<T = any>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8"));
}
export async function json(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
export async function exists(file: string) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}
export async function files(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const d of await readdir(root, { withFileTypes: true })) {
    const p = join(root, d.name);
    if (d.isDirectory()) result.push(...(await files(p)));
    else result.push(p);
  }
  return result;
}
export async function pool<T, R>(
  values: T[],
  fn: (value: T, index: number) => Promise<R>,
  concurrency = 4,
) {
  const result: R[] = Array(values.length);
  let next = 0;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failure && next < values.length) {
        const i = next++;
        try {
          result[i] = await fn(values[i], i);
        } catch (error) {
          failure = error;
        }
      }
    }),
  );
  if (failure) throw failure;
  return result;
}
