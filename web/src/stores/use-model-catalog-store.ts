import { create } from "zustand";

// 仅保留当前会话的读取状态；模型数据仍由 config store 管理。
export const useModelCatalogStore = create<{ status: "idle" | "loading" | "ready" | "error" }>(() => ({ status: "idle" }));
