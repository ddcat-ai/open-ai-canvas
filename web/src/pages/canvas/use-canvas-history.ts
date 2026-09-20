import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ContextMenuState } from "@/types/canvas";
import { collaborationValueEqual, mergeCollaborationValue } from "@/lib/canvas/canvas-collaboration-rebase";

export type CanvasHistorySnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    canvasAppearance: CanvasAppearance;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

type EntityChange<T> = {
    id: string;
    before?: T;
    after?: T;
};

type EntityPatch<T> = {
    changes: EntityChange<T>[];
    beforeOrder?: string[];
    afterOrder?: string[];
};

type ValuePatch<T> = {
    before: T;
    after: T;
};

type CanvasHistoryPatch = {
    nodes?: EntityPatch<CanvasNodeData>;
    connections?: EntityPatch<CanvasConnection>;
    chatSessions?: EntityPatch<CanvasAssistantSession>;
    activeChatId?: ValuePatch<string | null>;
    canvasAppearance?: ValuePatch<CanvasAppearance>;
    backgroundMode?: ValuePatch<CanvasBackgroundMode>;
    showImageInfo?: ValuePatch<boolean>;
};

type UseCanvasHistoryOptions = CanvasHistorySnapshot & {
    projectLoaded: boolean;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveChatId: Dispatch<SetStateAction<string | null>>;
    applyCanvasAppearance: (appearance: CanvasAppearance) => void;
    setBackgroundMode: Dispatch<SetStateAction<CanvasBackgroundMode>>;
    setShowImageInfo: Dispatch<SetStateAction<boolean>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

export function useCanvasHistory({
    projectLoaded,
    nodes,
    connections,
    chatSessions,
    activeChatId,
    canvasAppearance,
    backgroundMode,
    showImageInfo,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
    applyCanvasAppearance,
    setBackgroundMode,
    setShowImageInfo,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
}: UseCanvasHistoryOptions) {
    const historyRef = useRef<{ past: CanvasHistoryPatch[]; future: CanvasHistoryPatch[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistorySnapshot | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

    const createHistorySnapshot = useCallback(
        (): CanvasHistorySnapshot => ({ nodes, connections, chatSessions, activeChatId, canvasAppearance, backgroundMode, showImageInfo }),
        [activeChatId, backgroundMode, canvasAppearance, chatSessions, connections, nodes, showImageInfo],
    );

    const clearCommitTimer = useCallback(() => {
        if (!historyCommitTimerRef.current) return;
        clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = null;
    }, []);

    const resetHistory = useCallback((snapshot: CanvasHistorySnapshot) => {
        clearCommitTimer();
        if (applyTimerRef.current) {
            clearTimeout(applyTimerRef.current);
            applyTimerRef.current = null;
        }
        historyRef.current = { past: [], future: [] };
        lastHistoryRef.current = snapshot;
        applyingHistoryRef.current = false;
        historyPausedRef.current = false;
        setHistoryState({ canUndo: false, canRedo: false });
    }, [clearCommitTimer]);

    const applyHistorySnapshot = useCallback((snapshot: CanvasHistorySnapshot) => {
        clearCommitTimer();
        applyingHistoryRef.current = true;
        lastHistoryRef.current = snapshot;
        setNodes(snapshot.nodes);
        setConnections(snapshot.connections);
        setChatSessions(snapshot.chatSessions);
        setActiveChatId(snapshot.activeChatId);
        applyCanvasAppearance(snapshot.canvasAppearance);
        setBackgroundMode(snapshot.backgroundMode);
        setShowImageInfo(snapshot.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
        applyTimerRef.current = setTimeout(() => {
            applyingHistoryRef.current = false;
            applyTimerRef.current = null;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, [applyCanvasAppearance, clearCommitTimer, setActiveChatId, setBackgroundMode, setChatSessions, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setShowImageInfo]);

    const undoCanvas = useCallback(() => {
        clearCommitTimer();
        const current = createHistorySnapshot();
        const pending = lastHistoryRef.current && createCanvasHistoryPatch(lastHistoryRef.current, current);
        if (pending) historyRef.current.past.push(pending);
        let patch;
        while ((patch = historyRef.current.past.pop())) {
            const next = applyCanvasHistoryPatch(current, patch, "before");
            const actual = createCanvasHistoryPatch(next, current);
            if (!actual) continue;
            historyRef.current.future.push(actual);
            applyHistorySnapshot(next);
            return;
        }
        setHistoryState({ canUndo: false, canRedo: historyRef.current.future.length > 0 });
    }, [applyHistorySnapshot, clearCommitTimer, createHistorySnapshot]);

    const redoCanvas = useCallback(() => {
        const current = createHistorySnapshot();
        let patch;
        while ((patch = historyRef.current.future.pop())) {
            const next = applyCanvasHistoryPatch(current, patch, "after");
            const actual = createCanvasHistoryPatch(current, next);
            if (!actual) continue;
            historyRef.current.past.push(actual);
            applyHistorySnapshot(next);
            return;
        }
        setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: false });
    }, [applyHistorySnapshot, createHistorySnapshot]);

    const getHistoryCleanupContext = useCallback(() => ({ history: historyRef.current, lastHistory: lastHistoryRef.current }), []);

    const adoptRemoteHistory = useCallback((before: CanvasHistorySnapshot, next: CanvasHistorySnapshot) => {
        clearCommitTimer();
        // Keep local intent. Conditional inverse fields are evaluated against
        // the latest content at undo time, so a remote position change does
        // not discard an unrelated prompt edit in the same history entry.
        const localPatch = lastHistoryRef.current && createCanvasHistoryPatch(lastHistoryRef.current, before);
        if (localPatch) historyRef.current.past.push(localPatch);
        reconcileHistoryLifecycles([...historyRef.current.past, ...historyRef.current.future], before.nodes, next.nodes);
        historyRef.current.past = historyRef.current.past.slice(-50);
        lastHistoryRef.current = next;
        setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
    }, [clearCommitTimer]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistorySnapshot();
        const previous = lastHistoryRef.current;
        if (!previous || snapshotsShareReferences(previous, next)) return;

        clearCommitTimer();
        historyCommitTimerRef.current = setTimeout(() => {
            const current = createHistorySnapshot();
            const last = lastHistoryRef.current;
            if (!last) return;
            const patch = createCanvasHistoryPatch(last, current);
            historyCommitTimerRef.current = null;
            lastHistoryRef.current = current;
            if (!patch) return;
            historyRef.current.past = [...historyRef.current.past.slice(-49), patch];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
        }, 180);

        return clearCommitTimer;
    }, [clearCommitTimer, createHistorySnapshot, projectLoaded]);

    useEffect(() => () => {
        clearCommitTimer();
        if (applyTimerRef.current) clearTimeout(applyTimerRef.current);
    }, [clearCommitTimer]);

    return { adoptRemoteHistory, getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas };
}

function snapshotsShareReferences(before: CanvasHistorySnapshot, after: CanvasHistorySnapshot) {
    return before.nodes === after.nodes
        && before.connections === after.connections
        && before.chatSessions === after.chatSessions
        && before.activeChatId === after.activeChatId
        && before.canvasAppearance === after.canvasAppearance
        && before.backgroundMode === after.backgroundMode
        && before.showImageInfo === after.showImageInfo;
}

export function createCanvasHistoryPatch(before: CanvasHistorySnapshot, after: CanvasHistorySnapshot): CanvasHistoryPatch | null {
    const patch: CanvasHistoryPatch = {};
    patch.nodes = createEntityPatch(before.nodes, after.nodes);
    patch.connections = createEntityPatch(before.connections, after.connections);
    patch.chatSessions = createEntityPatch(before.chatSessions, after.chatSessions);
    if (before.activeChatId !== after.activeChatId) patch.activeChatId = { before: before.activeChatId, after: after.activeChatId };
    if (before.canvasAppearance !== after.canvasAppearance) patch.canvasAppearance = { before: before.canvasAppearance, after: after.canvasAppearance };
    if (before.backgroundMode !== after.backgroundMode) patch.backgroundMode = { before: before.backgroundMode, after: after.backgroundMode };
    if (before.showImageInfo !== after.showImageInfo) patch.showImageInfo = { before: before.showImageInfo, after: after.showImageInfo };
    return Object.values(patch).some(Boolean) ? patch : null;
}

function createEntityPatch<T extends { id: string }>(before: T[], after: T[]): EntityPatch<T> | undefined {
    const beforeById = new Map(before.map((item) => [item.id, item]));
    const afterById = new Map(after.map((item) => [item.id, item]));
    const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
    const changes: EntityChange<T>[] = [];
    ids.forEach((id) => {
        const beforeItem = beforeById.get(id);
        const afterItem = afterById.get(id);
        if (!collaborationValueEqual(beforeItem, afterItem)) changes.push({ id, before: beforeItem, after: afterItem });
    });

    const beforeOrder = before.map((item) => item.id);
    const afterOrder = after.map((item) => item.id);
    const orderChanged = beforeOrder.length !== afterOrder.length || beforeOrder.some((id, index) => id !== afterOrder[index]);
    if (!changes.length && !orderChanged) return undefined;
    return {
        changes,
        beforeOrder: orderChanged ? beforeOrder : undefined,
        afterOrder: orderChanged ? afterOrder : undefined,
    };
}

export function applyCanvasHistoryPatch(snapshot: CanvasHistorySnapshot, patch: CanvasHistoryPatch, side: "before" | "after"): CanvasHistorySnapshot {
    const opposite = side === "before" ? "after" : "before";
    let nodes = patch.nodes ? applyEntityPatch(snapshot.nodes, patch.nodes, side, true) : snapshot.nodes;
    // Undoing a node creation must not remove relations another member added.
    const knownEdges = new Set(patch.connections?.changes.filter((c) => c[opposite]).map((c) => c.id) || []);
    const retained = new Set(nodes.map((n) => n.id));
    for (const node of snapshot.nodes) {
        if (!retained.has(node.id) && snapshot.connections.some((edge) => (edge.fromNodeId === node.id || edge.toNodeId === node.id) && !knownEdges.has(edge.id))) nodes = [...nodes, node];
    }
    const ids = new Set(nodes.map((node) => node.id));
    const connections = (patch.connections ? applyEntityPatch(snapshot.connections, patch.connections, side) : snapshot.connections).filter((edge) => ids.has(edge.fromNodeId) && ids.has(edge.toNodeId));
    const value = <K extends "activeChatId" | "canvasAppearance" | "backgroundMode" | "showImageInfo">(key: K): CanvasHistorySnapshot[K] => {
        const change = patch[key];
        return change && collaborationValueEqual(snapshot[key], change[opposite]) ? change[side] as CanvasHistorySnapshot[K] : snapshot[key];
    };
    return {
        nodes,
        connections,
        chatSessions: patch.chatSessions ? applyEntityPatch(snapshot.chatSessions, patch.chatSessions, side) : snapshot.chatSessions,
        activeChatId: value("activeChatId"),
        canvasAppearance: value("canvasAppearance"),
        backgroundMode: value("backgroundMode"),
        showImageInfo: value("showImageInfo"),
    };
}

function applyEntityPatch<T extends { id: string }>(current: T[], patch: EntityPatch<T>, side: "before" | "after", node = false) {
    const byId = new Map(current.map((item) => [item.id, item]));
    patch.changes.forEach((change) => {
        const value = change[side];
        const expected = change[side === "before" ? "after" : "before"];
        const latest = byId.get(change.id);
        if (node && expected && latest && incarnation(expected) !== incarnation(latest)) return;
        if (expected && value && latest) {
            const merged = { ...latest } as Record<string, unknown>;
            for (const key of new Set([...Object.keys(expected), ...Object.keys(value)])) {
                if (["id", "createdAt", "updatedAt"].includes(key)) continue;
                merged[key] = mergeCollaborationValue((expected as Record<string, unknown>)[key], (value as Record<string, unknown>)[key], (latest as Record<string, unknown>)[key], key, key === "metadata", ({ latest }) => latest);
            }
            byId.set(change.id, merged as T);
        } else if (collaborationValueEqual(expected, latest)) {
            if (value) {
                const restored = structuredClone(value);
                const metadata = (restored as unknown as CanvasNodeData).metadata;
                if (node && typeof metadata?.collaborationIncarnation === "number") {
                    (restored as unknown as CanvasNodeData).metadata = { ...metadata, collaborationRestoreIncarnation: metadata.collaborationIncarnation };
                }
                byId.set(change.id, restored);
            } else byId.delete(change.id);
        }
    });

    // 成员增删时按补丁记录恢复精确顺序；仅内容变化时保留当前顺序，避免无意义数组抖动。
    const order = side === "before" ? patch.beforeOrder : patch.afterOrder;
    const ids = [...new Set([...(order || current.map((item) => item.id)), ...byId.keys()])];
    return ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

function incarnation(value: unknown) {
    return (value as CanvasNodeData)?.metadata?.collaborationIncarnation ?? 1;
}

export function reconcileHistoryLifecycles(patches: CanvasHistoryPatch[], before: CanvasNodeData[], next: CanvasNodeData[]) {
    for (const node of next) {
        const prior = before.find((item) => item.id === node.id);
        const expected = prior?.metadata?.collaborationRestoreIncarnation;
        const initial = prior && !prior.metadata?.collaborationIncarnation && incarnation(node) === 1;
        if (!initial && !(typeof expected === "number" && (incarnation(node) === expected || incarnation(node) === expected + 1))) continue;
        for (const patch of patches) for (const change of patch.nodes?.changes || []) {
            if (change.id !== node.id) continue;
            for (const side of ["before", "after"] as const) {
                const value = change[side];
                if (!value) continue;
                const metadata = { ...value.metadata, collaborationIncarnation: incarnation(node) };
                delete (metadata as Record<string, unknown>).collaborationRestoreIncarnation;
                change[side] = { ...value, metadata };
            }
        }
    }
}
