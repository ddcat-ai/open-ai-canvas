import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CharacterDressingPanel } from "../src/components/canvas/character-dressing-panel";
import { getActiveUserScope } from "../src/lib/user-scope";
import { useUserStore } from "../src/stores/use-user-store";
import type { GenerationTask } from "../src/services/api/task-center";
import type { ProjectCharacterDetail } from "../src/services/api/projects";

test("任务详情已完成时，梳妆台历史使用相同状态和结果，不再显示旧的生成中", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const scope = getActiveUserScope();
    const userId = useUserStore.getState().user?.id;
    const pending = { id: "history-task", status: "running", createdAt: "2026-11-27T07:00:00Z" } as GenerationTask;
    const completed = { ...pending, status: "succeeded", resultState: "READY", resultJson: JSON.stringify({ images: [{ storageKey: "resource:output" }] }) } as GenerationTask;
    const detail = { asset: { id: "person", title: "人物" }, character: { versionId: "v1", definition: {}, representations: [] } } as unknown as ProjectCharacterDetail;
    client.setQueryData(["character-dressing-history", scope, "person"], { pages: [[pending]], pageParams: [undefined] });
    client.setQueryData(["character-dressing-task", scope, userId, pending.id], completed);
    try {
        const html = renderToStaticMarkup(
            <QueryClientProvider client={client}>
                <App>
                    <CharacterDressingPanel detail={detail} outfit={{ id: "default", name: "默认造型", resourceId: "base" }} nodeId="node" onSaved={() => {}} onRefresh={() => {}} />
                </App>
            </QueryClientProvider>,
        );
        const historyCard = html.match(/class="character-dressing__history-item"[\s\S]*?<\/button>/)?.[0];
        expect(historyCard).toBeDefined();
        expect(historyCard).toContain("已完成");
        expect(historyCard).not.toContain("生成中");
        expect(html).toContain("新造型已就绪");
    } finally {
        client.clear();
    }
});
