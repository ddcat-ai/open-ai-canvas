import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateKeyPairSync, createHash, verify } from "node:crypto";
import { signRelease } from "./sign-release.mjs";

test("签名绑定原始清单，验证包摘要且不覆盖既有签名", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "yingce-sign-test-"));
  try {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const key = path.join(dir, "test-key.pem");
    await writeFile(key, privateKey.export({type:"pkcs8", format:"pem"}), {mode:0o600});
    const bytes = Buffer.from("synthetic test artifact, not a release");
    await writeFile(path.join(dir, "test.zip"), bytes);
    const manifest = {
      schemaVersion:1, sequence:1, expiresAt:Math.floor(Date.now()/1000)+3600,
      version:"0.1.0",commit:"a".repeat(40),channel:"stable",minLauncherVersion:"0.1.0",releaseId:"test-1",
      artifacts:[{platform:"windows",arch:"x86_64",path:"test.zip",size:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),kind:"zip"}],
      migration:{dataSchema:1,requiresMigration:false},releaseNotes:"测试"
    };
    const file = path.join(dir, "release-manifest.json");
    await writeFile(file, JSON.stringify(manifest));
    const result = await signRelease(file,key,dir);
    const raw = await readFile(file);
    const sig = Buffer.from((await readFile(result.signaturePath,"utf8")).trim(),"base64");
    assert.equal(verify(null,raw,publicKey,sig),true);
    assert.equal(verify(null,Buffer.concat([raw,Buffer.from(" ")]),publicKey,sig),false);
    await assert.rejects(signRelease(file,key,dir),/EEXIST/);
    await writeFile(path.join(dir,"test.zip"),"tampered");
    await assert.rejects(signRelease(file,key,dir),/size\/hash/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
