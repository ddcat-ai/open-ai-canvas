import { create } from "zustand";
import { persist } from "zustand/middleware";

type NotificationPreferencesStore = {
    /** 生成完成时弹出带动效的通知，后台时在标签页上提醒。 */
    generationNotice: boolean;
    /** 生成完成时播放提示音；总开关关闭时不生效。 */
    generationSound: boolean;
    setGenerationNotice: (enabled: boolean) => void;
    setGenerationSound: (enabled: boolean) => void;
};

/** 本设备偏好（与主题、界面语言一致）：同一账号在办公室静音、在家开声音互不影响。默认全部开启。 */
export const useNotificationPreferencesStore = create<NotificationPreferencesStore>()(
    persist(
        (set) => ({
            generationNotice: true,
            generationSound: true,
            setGenerationNotice: (generationNotice) => set({ generationNotice }),
            setGenerationSound: (generationSound) => set({ generationSound }),
        }),
        {
            name: "yingce:notification_preferences",
            partialize: (state) => ({ generationNotice: state.generationNotice, generationSound: state.generationSound }),
            merge: (persisted, current) => {
                const stored = (persisted || {}) as Partial<NotificationPreferencesStore>;
                return { ...current, generationNotice: stored.generationNotice !== false, generationSound: stored.generationSound !== false };
            },
        },
    ),
);
