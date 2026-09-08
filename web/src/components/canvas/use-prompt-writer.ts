import { useEffect, useMemo, useRef, useState } from "react";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import type { PromptOptimizationInput, PromptOptimizationResult, PromptOptimizerProvider } from "@/lib/plugins/plugin-types";

export type PromptWriterVersion = { id: string; label: string; instruction?: string; parentId?: string; result: PromptOptimizationResult };
type History = { source: string; selectedId: string; versions: PromptWriterVersion[] };

export function parseWriterHistory(value: string | null): History | null {
    if (!value) return null;
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed.source !== "string" || typeof parsed.selectedId !== "string" || !Array.isArray(parsed.versions)) throw new Error("本地版本记录格式无效");
    if (!parsed.versions.every((item: PromptWriterVersion) => typeof item?.id === "string" && typeof item.label === "string" && typeof item.result?.optimizedPrompt === "string")) throw new Error("本地版本记录格式无效");
    return {
        source: parsed.source,
        selectedId: parsed.selectedId,
        versions: parsed.versions.slice(-20).map((item: PromptWriterVersion) => ({
            id: item.id,
            label: item.label,
            instruction: typeof item.instruction === "string" ? item.instruction : undefined,
            parentId: typeof item.parentId === "string" ? item.parentId : undefined,
            result: { optimizedPrompt: item.result.optimizedPrompt },
        })),
    };
}

export function usePromptWriter(open: boolean, historyKey: string, prompt: string, provider: PromptOptimizerProvider | null) {
    const scope = getActiveUserScope();
    // Freeze the account scope for asynchronous reads/writes, including after logout.
    const storage = useMemo(() => localForageStorageForScope(scope), [scope]);
    const key = `infinite-canvas:prompt-writer:${historyKey}`;
    const historyRef = useRef<History>({ source: prompt, selectedId: "", versions: [] });
    const epochRef = useRef(0);
    const abortRef = useRef<AbortController | null>(null);
    const writeRef = useRef<Promise<unknown>>(Promise.resolve());
    const [versions, setVersions] = useState<PromptWriterVersion[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [result, setResult] = useState<PromptOptimizationResult | null>(null);
    const [selectedPrompt, setSelectedPrompt] = useState("");
    const [draftPrompt, setDraftPrompt] = useState(prompt);
    const [submittedPrompt, setSubmittedPrompt] = useState("");
    const [streamText, setStreamText] = useState("");
    const [working, setWorking] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        const epoch = ++epochRef.current;
        abortRef.current?.abort();
        abortRef.current = null;
        if (!open) return;
        setLoading(true);
        setWorking(false);
        setError("");
        setNotice("");
        setStreamText("");
        setResult(null);
        setSelectedPrompt("");
        setSelectedId("");
        setVersions([]);
        setDraftPrompt(prompt);
        setSubmittedPrompt("");
        historyRef.current = { source: prompt, selectedId: "", versions: [] };
        const current = () => epochRef.current === epoch && getActiveUserScope() === scope;
        void (async () => {
            try {
                await writeRef.current.catch(() => {});
                const saved = parseWriterHistory(await storage.getItem(key));
                if (!current() || !saved) return;
                historyRef.current = { ...saved, source: prompt };
                setVersions(saved.versions);
                const matched = saved.versions.find((version) => version.result.optimizedPrompt === prompt.trim());
                const selected = saved.source === prompt ? saved.versions.find((version) => version.id === saved.selectedId) : matched;
                if (selected) {
                    setSelectedId(selected.id);
                    setResult(selected.result);
                    setSelectedPrompt(selected.result.optimizedPrompt);
                    setDraftPrompt("");
                }
            } catch {
                if (current()) setNotice("本地历史读取失败，本次仍可写作；原有记录未被清除。");
            } finally {
                if (current()) setLoading(false);
            }
        })();
        return () => {
            ++epochRef.current;
            abortRef.current?.abort();
            abortRef.current = null;
        };
    }, [open, key, prompt, scope, storage]);

    const persist = (history: History) => {
        const epoch = epochRef.current;
        const serialized = JSON.stringify(history);
        const write = writeRef.current.catch(() => {}).then(() => storage.setItem(key, serialized));
        writeRef.current = write;
        void write.then(
            () => {
                if (epochRef.current === epoch && getActiveUserScope() === scope) setNotice("版本仅保存在本机，最近保留 20 版。");
            },
            () => {
                if (epochRef.current === epoch && getActiveUserScope() === scope) setNotice("正文已保留在当前面板，但本地保存失败；请复制或采用，关闭页面后可能丢失。");
            },
        );
    };

    const remember = (nextResult: PromptOptimizationResult, label: string, instruction?: string) => {
        const version = { id: crypto.randomUUID(), label, instruction, parentId: historyRef.current.selectedId || undefined, result: nextResult };
        const history = { ...historyRef.current, selectedId: version.id, versions: [...historyRef.current.versions, version].slice(-20) };
        historyRef.current = history;
        setVersions(history.versions);
        setSelectedId(version.id);
        persist(history);
    };

    const saveEdited = () => {
        if (getActiveUserScope() !== scope) return;
        if (!result || !selectedPrompt.trim() || selectedPrompt.trim() === result.optimizedPrompt) return;
        const edited = { ...result, optimizedPrompt: selectedPrompt.trim() };
        remember(edited, "手工修改");
        setResult(edited);
    };

    const selectVersion = (id: string) => {
        if (working || loading) return;
        const version = historyRef.current.versions.find((item) => item.id === id);
        if (!version) return;
        saveEdited();
        setSelectedId(id);
        setResult(version.result);
        setSelectedPrompt(version.result.optimizedPrompt);
        setStreamText("");
        setError("");
        const history = { ...historyRef.current, selectedId: id };
        historyRef.current = history;
        persist(history);
    };

    const cancel = () => {
        abortRef.current?.abort();
        abortRef.current = null;
        setWorking(false);
        setNotice("已停止生成；已有版本和修改意见保留，未完成正文不自动保存为版本。");
    };

    const startDraft = () => {
        if (working || loading) return;
        saveEdited();
        setResult(null);
        setSelectedPrompt("");
        setSelectedId("");
        setDraftPrompt("");
        setSubmittedPrompt("");
        setStreamText("");
        setError("");
        historyRef.current = { ...historyRef.current, selectedId: "" };
        persist(historyRef.current);
    };

    const run = async (input: PromptOptimizationInput) => {
        if (!open || getActiveUserScope() !== scope || !provider || loading || abortRef.current || !input.prompt.trim()) return;
        saveEdited();
        const controller = new AbortController();
        const epoch = epochRef.current;
        abortRef.current = controller;
        const current = () => epochRef.current === epoch && !controller.signal.aborted && getActiveUserScope() === scope;
        setWorking(true);
        setStreamText("");
        setError("");
        setNotice("");
        setSubmittedPrompt(input.prompt);
        try {
            const nextResult = await provider.optimize(input, {
                signal: controller.signal,
                onDelta: (text) => {
                    if (current()) setStreamText(text);
                },
            });
            if (!current()) return;
            if (!nextResult.optimizedPrompt.trim()) throw new Error("模型没有返回正文，请重试");
            setResult(nextResult);
            setSelectedPrompt(nextResult.optimizedPrompt);
            setDraftPrompt("");
            setStreamText("");
            if (!input.action || input.action === "draft") remember({ optimizedPrompt: input.prompt }, "原始想法");
            remember(nextResult, input.action === "variant" ? "另写一版" : input.action === "revise" ? "按意见修改" : "首次起草", input.prompt);
        } catch (reason) {
            if (current()) setError(reason instanceof Error ? reason.message : "写作失败，请重试");
        } finally {
            if (abortRef.current === controller) {
                abortRef.current = null;
                if (epochRef.current === epoch) setWorking(false);
            }
        }
    };

    return { versions, selectedId, selectVersion, result, selectedPrompt, setSelectedPrompt, draftPrompt, setDraftPrompt, submittedPrompt, streamText, working, loading, error, notice, run, cancel, saveEdited, startDraft };
}
