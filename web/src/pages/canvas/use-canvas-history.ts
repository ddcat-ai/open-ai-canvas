import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ContextMenuState } from "@/types/canvas";

export type CanvasHistorySnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
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
    backgroundMode?: ValuePatch<CanvasBackgroundMode>;
    showImageInfo?: ValuePatch<boolean>;
};

type UseCanvasHistoryOptions = CanvasHistorySnapshot & {
    projectLoaded: boolean;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setChatSessions: Dispatch<SetStateAction<CanvasAssistantSession[]>>;
    setActiveChatId: Dispatch<SetStateAction<string | null>>;
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
    backgroundMode,
    showImageInfo,
    setNodes,
    setConnections,
    setChatSessions,
    setActiveChatId,
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
        (): CanvasHistorySnapshot => ({ nodes, connections, chatSessions, activeChatId, backgroundMode, showImageInfo }),
        [activeChatId, backgroundMode, chatSessions, connections, nodes, showImageInfo],
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
    }, [clearCommitTimer, setActiveChatId, setBackgroundMode, setChatSessions, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setShowImageInfo]);

    const undoCanvas = useCallback(() => {
        const patch = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!patch || !current) return;
        historyRef.current.future.push(patch);
        applyHistorySnapshot(applyCanvasHistoryPatch(current, patch, "before"));
    }, [applyHistorySnapshot]);

    const redoCanvas = useCallback(() => {
        const patch = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!patch || !current) return;
        historyRef.current.past.push(patch);
        applyHistorySnapshot(applyCanvasHistoryPatch(current, patch, "after"));
    }, [applyHistorySnapshot]);

    const getHistoryCleanupContext = useCallback(() => ({ history: historyRef.current, lastHistory: lastHistoryRef.current }), []);

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

    return { getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas };
}

function snapshotsShareReferences(before: CanvasHistorySnapshot, after: CanvasHistorySnapshot) {
    return before.nodes === after.nodes
        && before.connections === after.connections
        && before.chatSessions === after.chatSessions
        && before.activeChatId === after.activeChatId
        && before.backgroundMode === after.backgroundMode
        && before.showImageInfo === after.showImageInfo;
}

function createCanvasHistoryPatch(before: CanvasHistorySnapshot, after: CanvasHistorySnapshot): CanvasHistoryPatch | null {
    const patch: CanvasHistoryPatch = {};
    patch.nodes = createEntityPatch(before.nodes, after.nodes);
    patch.connections = createEntityPatch(before.connections, after.connections);
    patch.chatSessions = createEntityPatch(before.chatSessions, after.chatSessions);
    if (before.activeChatId !== after.activeChatId) patch.activeChatId = { before: before.activeChatId, after: after.activeChatId };
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
        if (beforeItem !== afterItem) changes.push({ id, before: beforeItem, after: afterItem });
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

function applyCanvasHistoryPatch(snapshot: CanvasHistorySnapshot, patch: CanvasHistoryPatch, side: "before" | "after"): CanvasHistorySnapshot {
    return {
        nodes: patch.nodes ? applyEntityPatch(snapshot.nodes, patch.nodes, side) : snapshot.nodes,
        connections: patch.connections ? applyEntityPatch(snapshot.connections, patch.connections, side) : snapshot.connections,
        chatSessions: patch.chatSessions ? applyEntityPatch(snapshot.chatSessions, patch.chatSessions, side) : snapshot.chatSessions,
        activeChatId: patch.activeChatId ? patch.activeChatId[side] : snapshot.activeChatId,
        backgroundMode: patch.backgroundMode ? patch.backgroundMode[side] : snapshot.backgroundMode,
        showImageInfo: patch.showImageInfo ? patch.showImageInfo[side] : snapshot.showImageInfo,
    };
}

function applyEntityPatch<T extends { id: string }>(current: T[], patch: EntityPatch<T>, side: "before" | "after") {
    const byId = new Map(current.map((item) => [item.id, item]));
    patch.changes.forEach((change) => {
        const value = change[side];
        if (value) byId.set(change.id, value);
        else byId.delete(change.id);
    });

    // 成员增删时按补丁记录恢复精确顺序；仅内容变化时保留当前顺序，避免无意义数组抖动。
    const order = side === "before" ? patch.beforeOrder : patch.afterOrder;
    if (!order) return current.map((item) => byId.get(item.id)).filter((item): item is T => Boolean(item));
    return order.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}
