import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import test from "node:test";

const root = path.dirname(new URL(import.meta.url).pathname);
const run = promisify(execFile);

test("publishable plugin directories have unique ids matching their package name", async () => {
  const ids = new Map();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith("src-")) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }

    assert.equal(manifest.id, entry.name);
    assert.equal(ids.has(manifest.id), false, `duplicate publishable id: ${manifest.id}`);
    ids.set(manifest.id, entry.name);
  }
});

test("existing plugin archives use their filename as the manifest id", async () => {
  const { stdout } = await run("python3", ["-c", [
    "import glob,json,os,zipfile",
    "for p in glob.glob('plugin-packages/*.yingce-plugin'):",
    "  with zipfile.ZipFile(p) as z: assert json.loads(z.read('manifest.json'))['id'] == os.path.basename(p).replace('.yingce-plugin',''), p",
  ].join("\n")], { cwd: path.dirname(root) });
  assert.equal(stdout, "");
});

test("async provider profiles declare cancellation semantics", async () => {
  const profiles = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const provider of manifest.contributes?.providers || []) {
      if (!provider.poll) continue;
      const hasCancel = provider.cancel && provider.cancel.method && provider.cancel.path;
      const hasNonCancelable = provider.nonCancelable && typeof provider.nonCancelable.reason === "string" && provider.nonCancelable.reason.trim();
      assert.equal(Boolean(hasCancel || hasNonCancelable), true, `${entry.name}/${provider.id} must declare cancel or nonCancelable`);
      profiles.push(`${entry.name}/${provider.id}`);
    }
  }
  assert.ok(profiles.length > 0, "expected at least one async provider profile");
});

test("new streaming audio and KM video profiles declare their execution semantics", async () => {
  for (const id of ["doubao-streaming-tts", "km-kemei-video"]) {
    const manifestPath = path.join(root, id, "manifest.json");
    assert.ok(existsSync(manifestPath), `${id} manifest must exist`);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const provider of manifest.contributes.providers.filter((provider) => provider.poll)) {
      assert.ok(provider.cancel || provider.nonCancelable?.reason?.trim(), `${id}/${provider.id} needs cancellation semantics`);
    }
  }
  const audio = JSON.parse(await readFile(path.join(root, "doubao-streaming-tts", "manifest.json"), "utf8"));
  assert.equal(audio.contributes.providers[0].capabilities[0], "audio");
  assert.equal(audio.contributes.providers[0].poll, undefined);
  const video = JSON.parse(await readFile(path.join(root, "km-kemei-video", "manifest.json"), "utf8"));
  assert.equal(video.contributes.providers[0].cancel.method, "DELETE");
});

test("OpenAI Images source and archive agree on inline media support", async () => {
  const source = JSON.parse(await readFile(path.join(root, "openai-images", "manifest.json"), "utf8"));
  const { stdout } = await run("python3", ["-c", [
    "import json,zipfile",
    "with zipfile.ZipFile('plugin-packages/openai-images.yingce-plugin') as z:",
    "  m=json.loads(z.read('manifest.json'))",
    "  print(json.dumps({'version':m['version'],'requiresPublicMediaUrls':m['contributes']['providers'][0]['requiresPublicMediaUrls']}))",
  ].join("\n")], { cwd: path.dirname(root) });
  const archive = JSON.parse(stdout);
  assert.equal(source.version, "2.0.1");
  assert.equal(source.contributes.providers[0].requiresPublicMediaUrls, false);
  assert.deepEqual(archive, {
    version: source.version,
    requiresPublicMediaUrls: source.contributes.providers[0].requiresPublicMediaUrls,
  });
});

test("affected source packages match every archived member byte", async () => {
  const { stdout } = await run("python3", ["-c", [
    "import os,zipfile",
    "names=['dashscope-wan3-video','newapi-video-generations-v1','doubao-streaming-tts','km-kemei-video','openai-images']",
    "for name in names:",
    "  root=os.path.join('plugin-packages',name)",
    "  files={os.path.relpath(os.path.join(dp,f),root).replace(os.sep,'/'):open(os.path.join(dp,f),'rb').read() for dp,_,fs in os.walk(root) for f in fs}",
    "  with zipfile.ZipFile(os.path.join('plugin-packages',name+'.yingce-plugin')) as z:",
    "    members=set(z.namelist())",
    "    assert members==set(files), (name,sorted(members-set(files)),sorted(set(files)-members))",
    "    for member in members:",
    "      assert not member.startswith('/') and '..' not in member.split('/'), (name,member)",
    "      assert z.read(member)==files[member], (name,member)",
  ].join("\n")], { cwd: path.dirname(root) });
  assert.equal(stdout, "");
});
