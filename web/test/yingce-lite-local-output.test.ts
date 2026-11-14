import { expect, test } from "bun:test";

import { importLocalOutputResource } from "../src/pages/workbench/local-output-resource";

test("imports only the active account's local generation image", async () => {
    let uploads = 0;
    const dependencies = {
        scope: () => "alice",
        read: async () => new Blob(["image"], { type: "image/png" }),
        upload: async () => {
            uploads++;
            return { id: "local-resource" };
        },
    } as unknown as Parameters<typeof importLocalOutputResource>[1];
    expect(await importLocalOutputResource("generation-image:alice:result", dependencies)).toBe("local-resource");
    await expect(importLocalOutputResource("generation-image:bob:result", dependencies)).rejects.toThrow("当前账号以外");
    expect(uploads).toBe(1);
});

test("account switch while reading prevents resource upload", async () => {
    let scope = "alice";
    let uploads = 0;
    const dependencies = {
        scope: () => scope,
        read: async () => {
            scope = "bob";
            return new Blob(["image"], { type: "image/png" });
        },
        upload: async () => {
            uploads++;
            return { id: "resource" };
        },
    } as unknown as Parameters<typeof importLocalOutputResource>[1];
    await expect(importLocalOutputResource("generation-image:alice:result", dependencies)).rejects.toThrow("账号已切换");
    expect(uploads).toBe(0);
});
