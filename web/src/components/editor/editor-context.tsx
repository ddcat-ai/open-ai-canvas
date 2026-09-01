// 编辑器 store 的 React 上下文：宿主（editor 视图）创建 store 实例并提供给
// 各插槽面板消费。插槽契约（EditorSlotRenderContext）保持纯 UI，不承载 store 类型；
// 能力经上下文注入，插件从上下文中取命令/撤销/保存入口。

import { createContext, useContext } from "react";
import type { StoreApi, UseBoundStore } from "zustand";

import type { EditorStore } from "@/stores/editor/editor-store";

type EditorStoreHook = UseBoundStore<StoreApi<EditorStore>>;

const EditorStoreContext = createContext<EditorStoreHook | null>(null);

export function EditorStoreProvider({ store, children }: { store: EditorStoreHook; children: React.ReactNode }) {
    return <EditorStoreContext.Provider value={store}>{children}</EditorStoreContext.Provider>;
}

export function useEditorStoreContext(): EditorStore {
    const store = useContext(EditorStoreContext);
    if (!store) throw new Error("useEditorStoreContext must be used within <EditorStoreProvider>");
    return store();
}
