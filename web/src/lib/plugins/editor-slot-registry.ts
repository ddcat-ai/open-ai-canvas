import { useEffect, useReducer } from "react";

import type { EditorSlotKind } from "./plugin-types";

export type EditorSlotRenderer = (context: { pluginId: string }) => React.ReactNode;

export type EditorSlotRegistration = {
    id: number;
    pluginId: string;
    slot: EditorSlotKind;
    priority: number;
    order: number;
    render: EditorSlotRenderer;
};

export type RegisterEditorSlotInput = {
    pluginId: string;
    slot: EditorSlotKind;
    priority?: number;
    render: EditorSlotRenderer;
};

let nextOrder = 0;
let nextId = 0;
const registrations: EditorSlotRegistration[] = [];
const listeners = new Set<() => void>();

function emitChange(): void {
    for (const listener of listeners) listener();
}

/** 订阅插槽注册表变化（插件启停时 UI 刷新）。返回取消订阅函数。 */
export function subscribeEditorSlots(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** React hook：订阅插槽变化并返回当前插槽贡献。 */
export function useEditorSlots(slot: EditorSlotKind): EditorSlotRegistration[] {
    const [, force] = useReducer((x: number) => x + 1, 0);
    useEffect(() => subscribeEditorSlots(force), []);
    return getEditorSlots(slot);
}

/** 注册一个编辑器插槽贡献。同 pluginId + slot 重复注册会覆盖旧项（幂等，兼容 HMR 重载）。返回的卸载函数只卸载自己注册的实例。 */
export function registerEditorSlot(input: RegisterEditorSlotInput): () => void {
    unregisterEditorSlot(input.pluginId, input.slot);
    const id = nextId++;
    registrations.push({
        id,
        pluginId: input.pluginId,
        slot: input.slot,
        priority: input.priority ?? 0,
        order: nextOrder++,
        render: input.render,
    });
    return () => {
        unregisterById(id);
        emitChange();
    };
}

function unregisterById(id: number): void {
    const index = registrations.findIndex((r) => r.id === id);
    if (index >= 0) registrations.splice(index, 1);
}

export function unregisterEditorSlot(pluginId: string, slot: EditorSlotKind): void {
    const index = registrations.findIndex((r) => r.pluginId === pluginId && r.slot === slot);
    if (index >= 0) {
        registrations.splice(index, 1);
        emitChange();
    }
}

/** 卸载某插件的全部编辑器插槽贡献（插件卸载时调用）。 */
export function unregisterPluginSlots(pluginId: string): void {
    let changed = false;
    for (let i = registrations.length - 1; i >= 0; i--) {
        if (registrations[i].pluginId === pluginId) {
            registrations.splice(i, 1);
            changed = true;
        }
    }
    if (changed) emitChange();
}

/** 取某插槽的全部贡献，按 priority 降序、注册序升序稳定排列。 */
export function getEditorSlots(slot: EditorSlotKind): EditorSlotRegistration[] {
    return registrations
        .filter((r) => r.slot === slot)
        .sort((a, b) => b.priority - a.priority || a.order - b.order);
}
