import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageDirectories } from "./package-directories.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const runtime = ({ documentation, ...manifest }) => manifest;
const normalize = (value) => value.replace(/\r\n?/g, "\n").trimEnd();

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), "yingce-catalog-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  for (const name of ["generate-catalog.mjs", "embed-documentation.mjs", "package-directories.mjs"]) {
    await cp(join(root, name), join(temp, name));
  }
  const ids = [];
  for (const id of await packageDirectories(root)) {
    const manifest = await json(join(root, id, "manifest.json"));
    if (!manifest.contributes?.providers?.some((provider) => provider.capabilities?.includes("text"))) continue;
    ids.push(id);
    await cp(join(root, id), join(temp, id), { recursive: true });
  }
  assert.equal(ids.length, 34);
  return { temp, ids };
}

function generate(temp, ids) {
  return execFileSync(process.execPath, [join(temp, "generate-catalog.mjs"), ...ids], { cwd: temp, encoding: "utf8" });
}

async function snapshot(dir) {
  const files = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [name, value] of Object.entries(await snapshot(path))) files[`${entry.name}/${name}`] = value;
    } else {
      files[entry.name] = { content: await readFile(path, "utf8"), mtime: (await stat(path)).mtimeMs };
    }
  }
  return files;
}

test("selected text regeneration retains canonical runtime, custom prose and current tables", async (t) => {
  const { temp, ids } = await fixture(t);
  const selected = ["ollama-chat", "anthropic-messages", "aws-bedrock-converse", "openai-chat-completions"];
  const id = selected[0];
  const manifestPath = join(temp, id, "manifest.json");
  const manifest = await json(manifestPath);
  manifest.version = "9.8.7";
  const provider = manifest.contributes.providers[0];
  provider.create.body.catalog_sentinel = { $ref: `request.providerOptions.${provider.id}.catalog_sentinel` };
  provider.create.originPath = true;
  provider.agent = { method: "POST", path: "/custom-agent", body: { sentinel: true } };
  provider.agentResponse = { textPaths: ["sentinel.agent"] };
  provider.response.textPaths = ["sentinel.response"];
  provider.validations = [{ when: true, message: "catalog validation sentinel" }];
  provider.parameters.push({ name: "catalog_parameter", type: "string", mapping: "sentinel", description: "kept" });
  manifest.configuration.fields.push({ name: "catalog_config", type: "string", label: "kept" });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const interfacePath = join(temp, id, "docs", "interface.md");
  let source = await readFile(interfacePath, "utf8");
  source = source.replace("## 上游请求模板逐字段清单", "## Custom contract\n\nKeep this prose exactly.\n\n## 上游请求模板逐字段清单");
  source = source.replace("## Provider 扩展键", "Custom prose inside a generated section.\n\n## Provider 扩展键");
  await writeFile(interfacePath, source);
  const before = {};
  for (const packageID of ids) before[packageID] = await snapshot(join(temp, packageID));
  assert.match(generate(temp, selected), /generated 4 protocol packages/);
  for (const packageID of ids) {
    const after = await snapshot(join(temp, packageID));
    if (!selected.includes(packageID)) {
      assert.deepEqual(after, before[packageID], `unselected ${packageID} must not be written`);
      continue;
    }
    assert.equal(normalize(after["README.md"].content), normalize(before[packageID]["README.md"].content));
    const actual = await json(join(temp, packageID, "manifest.json"));
    assert.deepEqual(runtime(actual), runtime(JSON.parse(before[packageID]["manifest.json"].content)));
    const document = after["docs/interface.md"].content;
    assert.ok(actual.documentation.includes(document.trim()));
    const contract = document.split("<!-- YINGCE_MANIFEST_CONTRACT_START -->")[1].split("```json\n")[1].split("\n```")[0];
    assert.deepEqual(runtime(JSON.parse(contract)), runtime(actual));
  }
  const document = await readFile(interfacePath, "utf8");
  const tables = document.split("<!-- YINGCE_MANIFEST_CONTRACT_START -->")[0];
  for (const value of ["Keep this prose exactly.", "Custom prose inside a generated section.", "create.body.catalog_sentinel", "create.originPath", "catalog_parameter", "catalog_config", "sentinel.response", "sentinel.agent", "POST /custom-agent"]) assert.ok(tables.includes(value), value);
  const once = await snapshot(join(temp, id));
  generate(temp, selected);
  const twice = await snapshot(join(temp, id));
  for (const name of Object.keys(once)) assert.equal(twice[name].content, once[name].content, `idempotent ${name}`);
});

test("all 34 text packages including mixed-provider manifests regenerate without runtime changes", async (t) => {
  const { temp, ids } = await fixture(t);
  const before = {};
  for (const id of ids) before[id] = await snapshot(join(temp, id));
  assert.match(generate(temp, ids), /generated 34 protocol packages/);
  for (const id of ids) {
    const after = await json(join(temp, id, "manifest.json"));
    assert.deepEqual(runtime(after), runtime(JSON.parse(before[id]["manifest.json"].content)), id);
    const document = await readFile(join(temp, id, "docs", "interface.md"), "utf8");
    assert.ok(document.indexOf("## 协议身份") < document.indexOf("<!-- YINGCE_MANIFEST_CONTRACT_START -->"), id);
    assert.ok(document.indexOf("## 响应映射逐字段清单") < document.indexOf("<!-- YINGCE_MANIFEST_CONTRACT_START -->"), id);
    assert.equal(normalize(await readFile(join(temp, id, "README.md"), "utf8")), normalize(before[id]["README.md"].content));
  }
});

test("unknown selections fail before writing any package", async (t) => {
  const { temp } = await fixture(t);
  const before = await snapshot(temp);
  assert.throws(() => generate(temp, ["ollama-chat", "does-not-exist"]), /unknown protocol package/);
  assert.deepEqual(await snapshot(temp), before);
});
