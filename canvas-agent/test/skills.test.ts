import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { codexInput, writeSkillFiles } from "../src/agents.js";
import { parseAgentSkills } from "../src/modules/canvas-agent-http.js";

test("codexInput keeps skills as native UserInput items", () => {
    const input = codexInput("请按技能执行", ["/tmp/reference.png"], [{
        type: "skill",
        name: "canvas-shot-list",
        path: "/tmp/skill/SKILL.md",
    }]);

    assert.deepEqual(input, [
        { type: "text", text: "请按技能执行", text_elements: [] },
        { type: "localImage", path: "/tmp/reference.png" },
        { type: "skill", name: "canvas-shot-list", path: "/tmp/skill/SKILL.md" },
    ]);
    assert.equal(JSON.stringify(input).includes("$canvas-shot-list"), false);
});

test("writeSkillFiles creates Codex-compatible SKILL.md inputs and unique names", async () => {
    const prepared = await writeSkillFiles([
        { skillId: "same", name: "第一个技能", description: "first", instruction: "do first" },
        { skillId: "same", name: "第二个技能", description: "second", instruction: "do second" },
        {
            skillId: "package",
            name: "目录技能",
            description: "package",
            files: [
                { path: "SKILL.md", contentBase64: Buffer.from("# 目录技能\n\n按需读取参考文件。", "utf8").toString("base64") },
                { path: "references/guide.md", contentBase64: Buffer.from("# Guide", "utf8").toString("base64") },
            ],
        },
        { skillId: "empty", name: "空技能", instruction: "   " },
    ]);

    try {
        assert.equal(prepared.inputs.length, 3);
        assert.deepEqual(prepared.inputs.map((item) => item.type), ["skill", "skill", "skill"]);
        assert.deepEqual(prepared.inputs.map((item) => item.name), ["canvas-same", "canvas-same-2", "canvas-package"]);
        for (const item of prepared.inputs.slice(0, 2)) {
            assert.equal(item.path.endsWith("/SKILL.md"), true);
            const body = await fs.readFile(item.path, "utf8");
            assert.match(body, /^---\nname: canvas-same(?:-2)?\ndescription: /);
            assert.match(body, /\n---\n\n#/);
        }
        const packageInput = prepared.inputs[2];
        assert.match(await fs.readFile(packageInput.path, "utf8"), /^---\nname: canvas-package\ndescription: /);
        assert.equal(await fs.readFile(path.join(path.dirname(packageInput.path), "references", "guide.md"), "utf8"), "# Guide");
    } finally {
        await Promise.all(prepared.directories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
    }
});

test("parseAgentSkills validates and bounds browser skill bundles", () => {
    const input = [
        {
            skillId: "safe",
            name: " safe ",
            description: " desc ",
            version: " v2 ",
            files: [
                { path: "SKILL.md", mimeType: "text/markdown", contentBase64: Buffer.from("# Safe").toString("base64") },
                { path: "references/a.md", mimeType: "text/markdown", contentBase64: Buffer.from("A").toString("base64") },
            ],
        },
        { skillId: "legacy", name: "legacy", instruction: " instruction " },
        { name: "missing instruction" },
        null,
        { name: "unsafe", files: [{ path: "../SKILL.md", contentBase64: Buffer.from("bad").toString("base64") }] },
    ];
    const parsed = parseAgentSkills(input);

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].name, "safe");
    assert.equal(parsed[0].version, "v2");
    assert.deepEqual(parsed[0].files?.map((file) => file.path), ["SKILL.md", "references/a.md"]);
    assert.deepEqual(parsed[1], { skillId: "legacy", name: "legacy", instruction: "instruction" });
});
