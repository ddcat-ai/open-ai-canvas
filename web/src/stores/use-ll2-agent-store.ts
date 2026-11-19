import { create } from "zustand";

/**
 * 画布 Agent 面板的全局状态：首页「文本 / Agent」入口、工作台宫格与画布内浮动按钮共用。
 * pendingPrompt 让首页文本框写的话可以带进面板并自动发送，不用来回复制。
 */
export const useLL2AgentStore = create<{
    open: boolean;
    pendingPrompt: string;
    setOpen: (open: boolean) => void;
    toggle: () => void;
    /** 打开面板并（可选）带一段待发送文本；pendingPrompt 由面板消费后清空。 */
    openWith: (prompt?: string) => void;
    consumePending: () => string;
}>((set, get) => ({
    open: false,
    pendingPrompt: "",
    setOpen: (open) => set({ open }),
    toggle: () => set((state) => ({ open: !state.open })),
    openWith: (prompt = "") => set({ open: true, pendingPrompt: prompt.trim() }),
    consumePending: () => {
        const prompt = get().pendingPrompt;
        if (prompt) set({ pendingPrompt: "" });
        return prompt;
    },
}));
