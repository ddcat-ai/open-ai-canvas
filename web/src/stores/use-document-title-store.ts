import { create } from "zustand";

type DocumentTitleStore = {
    pageTitle: string;
    attentionCount: number;
    attentionLabel: string;
    setPageTitle: (pageTitle: string) => void;
    setAttention: (count: number, label: string) => void;
};

/** 标签页标题的页面部分与后台提醒；标题本身由 use-appearance-store 统一写入。 */
export const useDocumentTitleStore = create<DocumentTitleStore>((set) => ({
    pageTitle: "",
    attentionCount: 0,
    attentionLabel: "",
    setPageTitle: (pageTitle) => set((state) => (state.pageTitle === pageTitle ? state : { pageTitle })),
    setAttention: (count, label) => set({ attentionCount: Math.max(0, count), attentionLabel: count > 0 ? label : "" }),
}));
