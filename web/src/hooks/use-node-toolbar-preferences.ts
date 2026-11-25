import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNodeToolbarPreferences, isNodeToolbarNodeType, resetNodeToolbarPreference, saveNodeToolbarPreference, type NodeToolbarPreferences } from "@/services/api/node-toolbar-preferences";
import { useUserStore } from "@/stores/use-user-store";

export function useNodeToolbarPreferences(nodeType: string | undefined) {
    const userId = useUserStore((state) => state.user?.id) || "";
    const queryClient = useQueryClient();
    const queryKey = ["node-toolbar-preferences", userId];
    const canEdit = Boolean(userId) && isNodeToolbarNodeType(nodeType);
    const query = useQuery({
        queryKey,
        queryFn: ({ signal }) => getNodeToolbarPreferences(signal),
        enabled: canEdit,
        staleTime: 30_000,
    });

    return {
        userId,
        canEdit,
        pinnedEntryIds: isNodeToolbarNodeType(nodeType) ? query.data?.preferences[nodeType] : undefined,
        loading: canEdit && query.isPending,
        error: query.error,
        reload: () => query.refetch(),
        save: async (pinnedEntryIds: string[] | null) => {
            if (!userId || useUserStore.getState().user?.id !== userId || !isNodeToolbarNodeType(nodeType)) throw new Error("请登录后重新打开工具栏设置");
            if (pinnedEntryIds === null) await resetNodeToolbarPreference(nodeType);
            else await saveNodeToolbarPreference(nodeType, pinnedEntryIds);
            if (useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新打开工具栏设置");
            const saved = await getNodeToolbarPreferences();
            if (useUserStore.getState().user?.id !== userId) throw new Error("账号已切换，请重新打开工具栏设置");
            queryClient.setQueryData<{ preferences: NodeToolbarPreferences }>(queryKey, saved);
        },
    };
}
