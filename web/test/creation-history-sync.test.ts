import { describe, expect, test } from "bun:test";
import { CreationHistorySync, type HistorySyncStatus } from "@/services/creation-history-sync";
import { historyMessagePayload } from "@/services/creation-history-payload";
import type { CreationConversation, CreationMessage } from "@/pages/create/creation-types";
import type { HistoryDetail, HistoryMutation } from "@/services/api/creation-history";

const copy = <T>(value: T): T => structuredClone(value);
const message = (id: string, content = id): CreationMessage => ({ id, content, role: "assistant", status: "done", createdAt: "2026-10-24T01:00:00Z" });
const conversation = (id: string, messages = [message("m1")]): CreationConversation => ({ id, title: id, updatedAt: "2026-10-24T01:00:00Z", messages });

// Protocol fixture for client queue races. Actual HTTP/database behavior is tested in Go.
function server() {
    const rows = new Map<string, HistoryDetail>();
    let calls = 0;
    const api = {
        list: async () => ({ items: [...rows.values()].map((row) => copy(row)), next: "" }),
        get: async (id: string) => copy(rows.get(id)!),
        sync: async (id: string, req: HistoryMutation) => {
            calls++;
            const old = rows.get(id) || { id, title: "", updatedAt: "2026-10-24T02:00:00Z", revision: 0, metadataRevision: 0, deleted: false, messages: [], conflicts: [] };
            const row = copy(old);
            row.conflicts = [];
            if (!row.deleted) {
                if (req.delete) {
                    row.deleted = true;
                    row.messages = [];
                    row.revision++;
                } else {
                    if (req.metadata && (req.metadata.title !== row.title || (req.metadata.canvasId || "") !== (row.canvasId || ""))) {
                        if (req.metadata.revision !== row.metadataRevision) row.conflicts.push("metadata");
                        else {
                            row.title = req.metadata.title;
                            row.canvasId = req.metadata.canvasId;
                            row.metadataRevision++;
                            row.revision++;
                        }
                    }
                    for (const item of req.messages || []) {
                        const previous = row.messages.find((m) => m.id === item.id);
                        if (previous?.deleted) {
                            if (!item.deleted) row.conflicts.push(item.id);
                            continue;
                        }
                        if (item.deleted) {
                            if ((previous?.revision || 0) !== item.revision) {
                                row.conflicts.push(item.id);
                                continue;
                            }
                            row.messages = [...row.messages.filter((m) => m.id !== item.id), { ...copy(item), revision: item.revision + 1 }];
                            row.revision++;
                            continue;
                        }
                        if (JSON.stringify(previous?.data) === JSON.stringify(item.data)) continue;
                        if ((previous?.revision || 0) !== item.revision) {
                            row.conflicts.push(item.id);
                            continue;
                        }
                        row.messages = [...row.messages.filter((m) => m.id !== item.id), { ...copy(item), revision: item.revision + 1 }];
                        row.revision++;
                    }
                }
            }
            rows.set(id, row);
            return copy(row);
        },
    };
    return { rows, api, calls: () => calls };
}
function device(remote: ReturnType<typeof server>, legacy: CreationConversation[] = [], options: { cloud?: boolean; initial?: string; prepare?: (m: CreationMessage) => Promise<Record<string, unknown>>; write?: (value: string) => Promise<void> } = {}) {
    let disk = options.initial || "";
    let current: CreationConversation[] = [];
    let status: HistorySyncStatus = { phase: "local" };
    let active = true;
    let offline = false;
    const api = Object.fromEntries(
        Object.entries(remote.api).map(([key, fn]) => [
            key,
            async (...args: unknown[]) => {
                if (offline) throw new Error("离线");
                return (fn as (...args: unknown[]) => unknown)(...args);
            },
        ]),
    ) as typeof remote.api;
    const sync = new CreationHistorySync({
        read: async () => disk || null,
        readLegacy: async () => copy(legacy),
        write: async (value) => {
            await options.write?.(value);
            disk = value;
        },
        api,
        prepare: options.prepare || (async (m) => historyMessagePayload(m)),
        cloud: options.cloud ?? true,
        active: () => active,
        onChange: (value) => {
            current = copy(value);
        },
        onStatus: (value) => {
            status = value;
        },
    });
    return {
        sync,
        api,
        load: async () => {
            current = copy(await sync.load());
            return current;
        },
        save: async (value: CreationConversation[]) => {
            current = copy(value);
            await sync.save(value);
        },
        remove: async (id: string) => {
            current = current.filter((item) => item.id !== id);
            await sync.remove(id, current);
        },
        removeMessages: async (id: string, ids: string[]) => {
            current = current.map((c) => (c.id === id ? { ...c, messages: c.messages.filter((m) => !ids.includes(m.id)) } : c));
            await sync.removeMessages(id, ids);
        },
        value: () => current,
        disk: () => disk,
        status: () => status,
        offline: (value: boolean) => {
            offline = value;
        },
        stop: () => {
            active = false;
            sync.dispose();
        },
    };
}

describe("创作历史离线队列与修订合并", () => {
    async function conflictingDevices(options: Parameters<typeof device>[2] = {}) {
        const remote = server();
        const a = device(remote, [conversation("c")]);
        await a.load();
        await a.sync.sync();
        const b = device(remote, [], { ...options, initial: a.disk() });
        await b.load();
        await a.save([{ ...a.value()[0], title: "server title" }]);
        await a.sync.sync();
        await b.save([{ ...b.value()[0], title: "local title" }]);
        await b.sync.sync();
        return { remote, a, b };
    }
    test("处理指定冲突后刷新不再报警，原始副本仍可导出和恢复", async () => {
        const { remote, b } = await conflictingDevices();
        const backup = b.sync.conflictBackups()[0];
        expect(b.status().phase).toBe("conflict");
        await b.sync.resolveConflict(backup.key, "keep");
        expect(b.status()).toMatchObject({ phase: "synced", backupCount: 1, unresolvedCount: 0 });
        const reloaded = device(remote, [], { initial: b.disk() });
        await reloaded.load();
        await reloaded.sync.sync();
        expect(reloaded.status().phase).toBe("synced");
        expect(JSON.parse(reloaded.sync.conflictBackup())[0].local).toEqual(backup.local);
        expect(reloaded.sync.conflictBackups()[0].resolvedAt).toBeTruthy();
        expect(reloaded.value()[0].title).toBe("server title");
    });
    test("恢复已删除对话的副本使用新 ID，保留 tombstone、原消息及副本，重复操作幂等", async () => {
        const { remote, a, b } = await conflictingDevices();
        await a.remove("c");
        await a.sync.sync();
        await b.sync.sync();
        const backup = b.sync.conflictBackups()[0];
        const id = await b.sync.resolveConflict(backup.key, "restore", "恢复对话".repeat(60));
        expect(id).not.toBe("c");
        expect(b.status().phase).toBe("pending");
        expect(b.value()[0].messages).toEqual(backup.local.messages);
        expect(Array.from(b.value()[0].title)).toHaveLength(120);
        expect(await b.sync.resolveConflict(backup.key, "restore")).toBe(id);
        await b.sync.sync();
        expect(remote.rows.get("c")?.deleted).toBe(true);
        expect(remote.rows.get(id!)?.messages).toHaveLength(1);
        expect(JSON.parse(b.sync.conflictBackup())[0].local).toEqual(backup.local);
        const reloaded = device(remote, [], { initial: b.disk() });
        await reloaded.load();
        expect(await reloaded.sync.resolveConflict(backup.key, "restore")).toBe(id);
        expect(reloaded.value().filter((c) => c.id === id)).toHaveLength(1);
    });
    test("落盘失败时不确认冲突、不添加恢复对话，重试后才更新状态", async () => {
        let fail = false;
        const { b } = await conflictingDevices({
            write: async () => {
                if (fail) throw new Error("disk full");
            },
        });
        const backup = b.sync.conflictBackups()[0];
        const before = b.disk();
        fail = true;
        await expect(b.sync.resolveConflict(backup.key, "keep")).rejects.toThrow("disk full");
        await expect(b.sync.resolveConflict(backup.key, "restore")).rejects.toThrow("disk full");
        expect(b.disk()).toBe(before);
        expect(b.value()).toHaveLength(1);
        expect(b.sync.conflictBackups()[0].resolvedAt).toBeUndefined();
        expect(b.status().phase).toBe("conflict");
        fail = false;
        await b.sync.resolveConflict(backup.key, "restore");
        expect(b.value()).toHaveLength(2);
    });
    test("处理旧快照不会吞掉同一对话的新冲突", async () => {
        const { a, b } = await conflictingDevices();
        const old = b.sync.conflictBackups()[0];
        await a.save([{ ...a.value()[0], messages: [message("m1", "server edit")] }]);
        await a.sync.sync();
        await b.save([{ ...b.value()[0], messages: [message("m1", "local edit")] }]);
        await b.sync.sync();
        expect(b.sync.conflictBackups()).toHaveLength(2);
        await b.sync.resolveConflict(old.key, "keep");
        expect(b.status()).toMatchObject({ phase: "conflict", unresolvedCount: 1 });
        expect(b.sync.conflictBackups()[1].resolvedAt).toBeUndefined();
    });
    test("恢复落盘期间的新消息与恢复副本一起保存，刷新不丢失", async () => {
        let unblock: (() => void) | undefined;
        let started: (() => void) | undefined;
        let block = false;
        const { remote, b } = await conflictingDevices({
            write: async () => {
                if (block) {
                    block = false;
                    started?.();
                    await new Promise<void>((resolve) => {
                        unblock = resolve;
                    });
                }
            },
        });
        const ready = new Promise<void>((resolve) => {
            started = resolve;
        });
        block = true;
        const restoring = b.sync.resolveConflict(b.sync.conflictBackups()[0].key, "restore");
        await ready;
        const saving = b.save([{ ...b.value()[0], messages: [...b.value()[0].messages, message("during-restore")] }]);
        unblock!();
        const restoredId = await restoring;
        await saving;
        const reloaded = device(remote, [], { initial: b.disk() });
        await reloaded.load();
        expect(
            reloaded
                .value()
                .find((c) => c.id === "c")
                ?.messages.map((m) => m.id),
        ).toEqual(["m1", "during-restore"]);
        expect(reloaded.value().find((c) => c.id === restoredId)?.messages).toHaveLength(1);
        expect(reloaded.sync.conflictBackups()[0].restoredConversationId).toBe(restoredId);
    });
    test("已处理后再次发生相同内容的冲突，仍保留新的待处理快照", async () => {
        const { a, b } = await conflictingDevices();
        const old = b.sync.conflictBackups()[0];
        await b.sync.resolveConflict(old.key, "keep");
        await a.save([{ ...a.value()[0], title: "server title 2" }]);
        await a.sync.sync();
        await b.save([old.local]);
        await b.sync.sync();
        expect(b.status()).toMatchObject({ phase: "conflict", backupCount: 2, unresolvedCount: 1 });
        expect(b.sync.conflictBackups()[1].key).not.toBe(old.key);
    });
    test("处理副本时账号切换不会发布旧账号状态，停止后不能查看或处理副本", async () => {
        let release: (() => void) | undefined;
        let wait = false;
        const { b } = await conflictingDevices({
            write: async () => {
                if (wait)
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
            },
        });
        const backup = b.sync.conflictBackups()[0];
        wait = true;
        const resolving = b.sync.resolveConflict(backup.key, "restore");
        await Promise.resolve();
        await Promise.resolve();
        b.stop();
        release!();
        await expect(resolving).rejects.toThrow("账号已切换");
        expect(b.value()).toHaveLength(1);
        expect(b.status().phase).toBe("conflict");
        expect(() => b.sync.conflictBackups()).toThrow("账号已切换");
        expect(() => b.sync.resolveConflict(backup.key, "keep")).toThrow("账号已切换");
    });
    test("旧渲染快照缺少新拉取消息时不会生成删除命令", async () => {
        const remote = server();
        const a = device(remote, [conversation("c", [message("one")])]);
        await a.load();
        await a.sync.sync();
        const before = copy(a.value());
        await remote.api.sync("c", { messages: [{ id: "remote", revision: 0, data: historyMessagePayload(message("remote")) }] });
        await a.sync.sync();
        await a.save(before);
        await a.sync.sync();
        expect(remote.rows.get("c")?.messages.filter((m) => !m.deleted)).toHaveLength(2);
        expect(a.value()[0].messages).toHaveLength(2);
    });
    test("分批提交 75 条已有消息时，前批确认不覆盖尚未提交的编辑", async () => {
        const remote = server();
        const a = device(remote, [
            conversation(
                "large",
                Array.from({ length: 75 }, (_, i) => message("m" + i)),
            ),
        ]);
        await a.load();
        await a.sync.sync();
        await a.save([{ ...a.value()[0], messages: a.value()[0].messages.map((m) => ({ ...m, content: "edited " + m.id })) }]);
        await a.sync.sync();
        expect(remote.rows.get("large")?.messages).toHaveLength(75);
        expect(remote.rows.get("large")?.messages.every((m) => m.data.content === "edited " + m.id)).toBe(true);
        expect(a.value()[0].messages.every((m) => m.content === "edited " + m.id)).toBe(true);
    });

    test("单条消息删除同步并阻止旧设备复活，保留同对话其他消息", async () => {
        const remote = server();
        const a = device(remote, [conversation("c", [message("one"), message("two")])]);
        await a.load();
        await a.sync.sync();
        const b = device(remote);
        await b.load();
        await b.sync.sync();
        await a.removeMessages("c", ["one"]);
        await a.sync.sync();
        await b.save([{ ...b.value()[0], messages: b.value()[0].messages.map((m) => ({ ...m, content: m.content + " stale" })) }]);
        await b.sync.sync();
        expect(b.value()[0].messages.map((m) => m.id)).toEqual(["two"]);
        expect(remote.rows.get("c")?.messages.find((m) => m.id === "one")?.deleted).toBe(true);
        expect(JSON.parse(b.disk()).conflicts).toHaveLength(1);
    });

    test("拉取时删除与远端编辑冲突，不可用新修订强行删除更新", async () => {
        const remote = server();
        const a = device(remote, [conversation("c", [message("one"), message("two")])]);
        await a.load();
        await a.sync.sync();
        const b = device(remote);
        await b.load();
        await b.sync.sync();
        await a.save([{ ...a.value()[0], messages: a.value()[0].messages.map((m) => ({ ...m, content: "new cloud" })) }]);
        await a.sync.sync();
        await b.removeMessages("c", ["one"]);
        await b.sync.sync();
        await b.sync.sync();
        expect(remote.rows.get("c")?.messages.find((m) => m.id === "one")?.deleted).not.toBe(true);
        expect(b.value()[0].messages.find((m) => m.id === "one")?.content).toBe("new cloud");
    });
    test("旧本地历史重复补传不重复；重载从一个持久记录恢复修订", async () => {
        const remote = server();
        const old = [conversation("c1")];
        const a = device(remote, old);
        await a.load();
        await a.sync.sync();
        const calls = remote.calls();
        await a.sync.sync();
        expect(remote.calls()).toBe(calls);
        expect(remote.rows.get("c1")?.messages).toHaveLength(1);
        const reloaded = device(remote, old, { initial: a.disk() });
        await reloaded.load();
        await reloaded.sync.sync();
        expect(remote.calls()).toBe(calls);
        expect(old[0].messages[0].content).toBe("m1");
        expect(reloaded.status().phase).toBe("synced");
    });

    test("旧缓存不能覆盖云端较新消息或标题；不同 ID 仍补入且冲突副本保留", async () => {
        const remote = server();
        const a = device(remote, [conversation("c1", [message("m1", "cloud")])]);
        await a.load();
        await a.sync.sync();
        const old = conversation("c1", [message("m1", "old"), message("offline")]);
        old.title = "old title";
        const b = device(remote, [old]);
        await b.load();
        await b.sync.sync();
        expect(b.value()[0].title).toBe("c1");
        expect(b.value()[0].messages.find((m) => m.id === "m1")?.content).toBe("cloud");
        expect(remote.rows.get("c1")?.messages).toHaveLength(2);
        expect(JSON.parse(b.disk()).conflicts[0].local.title).toBe("old title");
        expect(b.status().phase).toBe("conflict");
    });

    test("两个离线设备并发追加与重命名不整数组覆盖", async () => {
        const remote = server();
        const a = device(remote, [conversation("c1")]);
        await a.load();
        await a.sync.sync();
        const b = device(remote);
        await b.load();
        await b.sync.sync();
        await a.save([{ ...a.value()[0], title: "A rename", messages: [...a.value()[0].messages, message("a")] }]);
        await b.save([{ ...b.value()[0], title: "B rename", messages: [...b.value()[0].messages, message("b")] }]);
        await Promise.all([a.sync.sync(), b.sync.sync()]);
        await a.sync.sync();
        await b.sync.sync();
        expect(new Set(remote.rows.get("c1")?.messages.map((m) => m.id))).toEqual(new Set(["m1", "a", "b"]));
        expect(a.value()[0].title).toBe(b.value()[0].title);
    });

    test("离线删除保留待同步标记，旧设备随后补传不能复活", async () => {
        const remote = server();
        const a = device(remote, [conversation("c1")]);
        await a.load();
        await a.sync.sync();
        const b = device(remote);
        await b.load();
        await b.sync.sync();
        a.offline(true);
        await a.remove("c1");
        await a.sync.sync();
        expect(JSON.parse(a.disk()).deleted).toEqual(["c1"]);
        a.offline(false);
        await a.sync.sync();
        await b.save([{ ...b.value()[0], messages: [...b.value()[0].messages, message("late")] }]);
        await b.sync.sync();
        expect(b.value()).toHaveLength(0);
        expect(remote.rows.get("c1")?.deleted).toBe(true);
        expect(JSON.parse(b.disk()).conflicts[0].local.messages).toHaveLength(2);
    });

    test("断网保留正文和队列，恢复后重复重试收敛", async () => {
        const remote = server();
        const a = device(remote, [conversation("c1")]);
        await a.load();
        a.offline(true);
        await a.sync.sync();
        expect(a.status().phase).toBe("error");
        expect(JSON.parse(a.disk()).conversations[0].messages).toHaveLength(1);
        a.offline(false);
        await a.sync.sync();
        await a.sync.sync();
        expect(remote.rows.get("c1")?.messages).toHaveLength(1);
    });

    test("较早页面快照缺少刚拉到的云端对话时，不推断为删除", async () => {
        const remote = server();
        const a = device(remote, [conversation("c1")]);
        await a.load();
        await a.sync.sync();
        const b = device(remote);
        const before = await b.load();
        await b.sync.sync();
        await b.save(before);
        await b.sync.sync();
        expect(remote.rows.get("c1")?.deleted).toBe(false);
        expect(JSON.parse(b.disk()).conversations.some((item: CreationConversation) => item.id === "c1")).toBe(true);
        expect(JSON.parse(b.disk()).deleted).toEqual([]);
    });

    test("消息在上传途中继续变化时保留新值并再次提交", async () => {
        const remote = server();
        let release!: () => void;
        let entered!: () => void;
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let first = true;
        const a = device(remote, [conversation("c1")], {
            prepare: async (m) => {
                if (first) {
                    first = false;
                    entered();
                    await blocked;
                }
                return historyMessagePayload(m);
            },
        });
        await a.load();
        const run = a.sync.sync();
        await ready;
        await a.save([conversation("c1", [message("m1", "new content")])]);
        const again = a.sync.sync();
        release();
        await Promise.all([run, again]);
        expect(remote.rows.get("c1")?.messages[0].data.content).toBe("new content");
        expect(a.value()[0].messages[0].content).toBe("new content");
    });

    test("单条历史缺失媒体时继续拉取其他云端历史", async () => {
        const remote = server();
        await remote.api.sync("cloud", { metadata: { revision: 0, title: "cloud" }, messages: [{ id: "cloud-m", revision: 0, data: historyMessagePayload(message("cloud-m")) }] });
        const a = device(remote, [conversation("broken")], {
            prepare: async () => {
                throw new Error("媒体缺失");
            },
        });
        await a.load();
        await a.sync.sync();
        expect(
            a
                .value()
                .map((c) => c.id)
                .sort(),
        ).toEqual(["broken", "cloud"]);
        expect(a.status().phase).toBe("error");
    });

    test("媒体上传失败后拉取新版本，不会用旧缓存套取最新修订覆盖云端", async () => {
        const remote = server();
        await remote.api.sync("c1", { metadata: { revision: 0, title: "cloud title" }, messages: [{ id: "m1", revision: 0, data: historyMessagePayload(message("m1", "new cloud")) }] });
        let failing = true;
        const old = conversation("c1", [message("m1", "old local"), message("distinct-local")]);
        old.title = "old title";
        const a = device(remote, [old], {
            prepare: async (m) => {
                if (failing) throw new Error("missing media");
                return historyMessagePayload(m);
            },
        });
        await a.load();
        await a.sync.sync();
        failing = false;
        await a.sync.sync();
        expect(remote.rows.get("c1")?.title).toBe("cloud title");
        expect(remote.rows.get("c1")?.messages.find((m) => m.id === "m1")?.data.content).toBe("new cloud");
        expect(remote.rows.get("c1")?.messages).toHaveLength(2);
        expect(JSON.parse(a.disk()).conflicts).toHaveLength(1);
    });

    test("账号切换取消旧会话；游客不自动上传或合并", async () => {
        const remote = server();
        let release!: () => void;
        const wait = new Promise<void>((resolve) => {
            release = resolve;
        });
        const a = device(remote, [conversation("private")], {
            prepare: async (m) => {
                await wait;
                return historyMessagePayload(m);
            },
        });
        await a.load();
        const run = a.sync.sync();
        a.stop();
        release();
        await run;
        expect(remote.calls()).toBe(0);
        const guest = device(remote, [conversation("guest")], { cloud: false });
        await guest.load();
        await guest.sync.sync();
        expect(remote.calls()).toBe(0);
        expect(guest.status().phase).toBe("local");
        const b = device(remote);
        await b.load();
        await b.sync.sync();
        expect(b.value()).toHaveLength(0);
    });

    test("云端 payload 不包含临时地址、嵌套配置或渠道密钥", () => {
        const payload = historyMessagePayload({
            ...message("m"),
            resultUrls: ["blob:temporary"],
            resultStorageKeys: ["resource:r1"],
            attachments: [{ id: "a", name: "a", type: "image/png", storageKey: "resource:r1", url: "https://example.invalid/signed?signature=x", previewUrl: "blob:preview", dataUrl: "data:image/png;base64,AA==" }],
            settings: { ratio: "1:1", apiKey: "must-not-persist" } as never,
        } as CreationMessage);
        expect(JSON.stringify(payload)).not.toContain("blob:");
        expect(JSON.stringify(payload)).not.toContain("signature=");
        expect(JSON.stringify(payload)).not.toContain("apiKey");
        expect(payload.resultStorageKeys).toEqual(["resource:r1"]);
    });

    test("新同步缓存继续剔除有稳定 key 的临时 resultUrls", async () => {
        const remote = server();
        const a = device(remote);
        await a.load();
        const item = { ...message("m"), resultStorageKeys: ["resource:r"], resultUrls: ["https://example.invalid/temporary?signature=x"] };
        await a.save([conversation("c", [item])]);
        expect(JSON.parse(a.disk()).conversations[0].messages[0].resultUrls).toBeUndefined();
        expect(a.value()[0].messages[0].resultUrls).toHaveLength(1);
    });
});
