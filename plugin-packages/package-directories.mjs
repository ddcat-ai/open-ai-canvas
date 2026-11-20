import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// 同 ID 的辅助源码副本不参与发行；目录名与 manifest ID 一致的目录是正式来源。
export async function packageDirectories(root) {
  const packages = new Map();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(root, entry.name, "manifest.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const names = packages.get(manifest.id) || [];
    names.push(entry.name);
    packages.set(manifest.id, names);
  }
  return [...packages.entries()].map(([id, names]) => {
    if (names.includes(id)) return id;
    if (names.length === 1) return names[0];
    throw new Error(`plugin ${id} has multiple source directories: ${names.join(", ")}`);
  }).sort();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log((await packageDirectories(dirname(fileURLToPath(import.meta.url)))).join("\n"));
}
