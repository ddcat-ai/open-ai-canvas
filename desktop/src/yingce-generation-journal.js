const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// Each record belongs to the account scope chosen by the main process. The
// journal contains local generation context and results, never credentials.
function createGenerationJournal(root) {
    const active = new Set();
    function fileFor(scope, id) {
        if (!/^[a-f0-9]{64}$/.test(scope) || typeof id !== "string" || !/^yingce-local:[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error("无效的生成记录标识");
        return path.join(root, "accounts", scope, "generation-journal", `${id.slice("yingce-local:".length)}.json`);
    }
    function write(file, value, exclusive = false) {
        const serialized = JSON.stringify(value);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const temp = `${file}.${crypto.randomBytes(8).toString("hex")}.tmp`;
        try {
            fs.writeFileSync(temp, serialized, { flag: "wx", mode: 0o600 });
            if (exclusive) fs.linkSync(temp, file);
            else fs.renameSync(temp, file);
        } finally {
            try { fs.unlinkSync(temp); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
    }
    return {
        begin(scope, context) {
            if (!context || typeof context !== "object" || Array.isArray(context) || !["text", "image", "audio"].includes(context.capability)) throw new Error("无效的生成恢复信息");
            const allowed = new Set(["id", "capability", "prompt", "model", "projectId", "nodeId", "sourceNodeId", "domainProjectId", "edit", "layerDecomposition", "textWire", "protocol", "format", "createdAt", "batchId", "batchIndex", "batchCount"]);
            if (Object.keys(context).some((key) => !allowed.has(key))) throw new Error("生成恢复信息包含不支持的字段");
            for (const [key, value] of Object.entries(context)) {
                if (key === "layerDecomposition") {
                    if (typeof value !== "boolean") throw new Error("无效的生成恢复信息");
                } else if (["batchIndex", "batchCount"].includes(key)) {
                    if (!Number.isSafeInteger(value) || value < 0) throw new Error("无效的生成恢复信息");
                } else if (typeof value !== "string" || value.length > (key === "prompt" ? 100000 : 1024)) throw new Error("无效的生成恢复信息");
            }
            if (!context.prompt || !context.model || !context.createdAt) throw new Error("生成恢复信息不完整");
            const serialized = JSON.stringify(context);
            if (Buffer.byteLength(serialized) > 1024 * 1024) throw new Error("生成恢复信息过大");
            const file = fileFor(scope, context.id);
            write(file, { version: 1, context: JSON.parse(serialized), status: "pending" }, true);
            active.add(file);
        },
        complete(scope, context, result) {
            const file = fileFor(scope, context.id);
            const storedResult = context.capability === "audio" && result?.bytes instanceof Uint8Array
                ? { contentType: result.contentType, bytesBase64: Buffer.from(result.bytes).toString("base64") } : result;
            try { write(file, { version: 1, context, status: "completed", result: storedResult }); }
            finally { active.delete(file); }
        },
        fail(scope, context, error) {
            const unknown = error?.outcomeUnknown === true || error?.reason === "outcome_unknown" || error?.status === 409 || error?.code === 40901;
            const file = fileFor(scope, context.id);
            try { write(file, { version: 1, context, status: unknown ? "unknown" : "failed" }); }
            finally { active.delete(file); }
        },
        list(scope) {
            const directory = path.dirname(fileFor(scope, "yingce-local:probe"));
            let files;
            try { files = fs.readdirSync(directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
            return files.filter((file) => /^[a-zA-Z0-9-]{1,80}\.json$/.test(file)).map((file) => {
                let record;
                try {
                    const contents = fs.readFileSync(path.join(directory, file), "utf8");
                    record = JSON.parse(contents);
                    if (record?.version !== 1 || !record.context || path.basename(fileFor(scope, record.context.id)) !== file || !["pending", "unknown", "failed", "completed"].includes(record.status)) throw new Error("invalid record");
                } catch {
                    // Preserve the damaged file and continue recovering other results.
                    return { version: 1, status: "invalid", context: { id: `yingce-local:${file.slice(0, -5)}` } };
                }
                return record.status === "pending" && !active.has(path.join(directory, file)) ? { ...record, status: "unknown" } : record;
            });
        },
        acknowledge(scope, id) {
            const file = fileFor(scope, id);
            const record = JSON.parse(fs.readFileSync(file, "utf8"));
            if (record?.status !== "completed" || record?.context?.id !== id) throw new Error("生成结果尚未准备好，无法确认保存");
            fs.unlinkSync(file);
        },
    };
}

module.exports = { createGenerationJournal };
