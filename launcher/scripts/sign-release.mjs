#!/usr/bin/env node
// Signs publisher-reviewed manifests; never generates or prints private keys.
import { readFile, writeFile, stat } from "node:fs/promises";
import { createPrivateKey, createPublicKey, createHash, sign } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

export async function signRelease(manifestPath, keyPath, releaseDirectory) {
  if (!manifestPath || !keyPath || !releaseDirectory) throw new Error("Usage: node sign-release.mjs MANIFEST.json PRIVATE-KEY.pem RELEASE-DIRECTORY");
  const raw = await readFile(manifestPath);
  const manifest = JSON.parse(raw.toString("utf8"));
  if (manifest.schemaVersion !== 1 || manifest.channel !== "stable" || !Number.isSafeInteger(manifest.sequence) || manifest.sequence <= 0 ||
      !Number.isSafeInteger(manifest.expiresAt) || manifest.expiresAt <= Date.now() / 1000 ||
      !/^[0-9a-f]{40}$/.test(manifest.commit) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(manifest.releaseId ?? "") ||
      !/^\d+\.\d+\.\d+$/.test(manifest.minLauncherVersion ?? "") || !manifest.version ||
      !Number.isSafeInteger(manifest.migration?.dataSchema) || manifest.migration.dataSchema < 0 ||
      typeof manifest.migration.requiresMigration !== "boolean" || !Array.isArray(manifest.artifacts) || !manifest.artifacts.length) {
    throw new Error("Invalid release manifest or expiration");
  }
  const root = path.resolve(releaseDirectory);
  const targets = new Set();
  for (const artifact of manifest.artifacts) {
    const target = artifact.platform + "/" + artifact.arch;
    if (!["windows/x86_64", "linux/x86_64", "macos/x86_64", "macos/aarch64"].includes(target) || targets.has(target)) throw new Error("Unsupported or duplicate artifact target");
    targets.add(target);
    if (artifact.kind !== "zip" || typeof artifact.path !== "string" || artifact.path.includes("\\") ||
        artifact.path.split("/").some(p => !p || p === "." || p === ".." || !/^[A-Za-z0-9._-]+$/.test(p)) ||
        !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || !/^[0-9a-f]{64}$/.test(artifact.sha256)) throw new Error("Invalid artifact metadata");
    const file = path.resolve(root, artifact.path);
    const rel = path.relative(root, file);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Artifact escapes release directory");
    if (!(await stat(file)).isFile()) throw new Error("Artifact must be a regular file");
    const bytes = await readFile(file);
    if (bytes.length !== artifact.size || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) throw new Error("Artifact size/hash does not match manifest");
  }
  const key = createPrivateKey(await readFile(keyPath));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Only Ed25519 publishing keys are supported");
  const signature = sign(null, raw, key).toString("base64");
  // Exclusive output: require publisher to review/remove any prior signature explicitly.
  await writeFile(manifestPath + ".sig", signature + "\n", { flag: "wx", mode: 0o644 });
  const der = createPublicKey(key).export({ type: "spki", format: "der" });
  return { publicKey: der.subarray(-32).toString("base64"), signaturePath: manifestPath + ".sig" };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  signRelease(...process.argv.slice(2)).then(result => {
    console.log("Manifest signed: " + result.signaturePath);
    console.log("YINGCE_RELEASE_PUBLIC_KEY=" + result.publicKey);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
