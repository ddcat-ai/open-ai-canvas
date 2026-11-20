import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { Navigate, useNavigate, useParams } from "react-router";

import { WorkspaceErrorState, WorkspaceForbiddenState, WorkspaceLoadingState } from "@/components/layout/workspace-state";
import { getSkill } from "@/services/api/skills";
import { useUserStore } from "@/stores/use-user-store";

const AuthorWorkbench = lazy(() => import("./workbench"));

/** 权限确认前只加载技能元信息；普通详情浏览不下载文件 IDE。写权限仍由服务端校验。 */
export default function SkillWorkbenchRoute() {
    const { skillId = "" } = useParams();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const detail = useQuery({ queryKey: ["skill-author-access", user?.id, skillId], queryFn: () => getSkill(skillId), enabled: Boolean(user?.id && skillId), staleTime: 0 });
    if (detail.isPending) return <WorkspaceLoadingState label="正在读取技能" />;
    if (detail.isError) return <WorkspaceErrorState description={detail.error.message} onRetry={() => void detail.refetch()} />;
    if (user?.role === "admin" && !detail.data.skill.isOwner) return <Navigate to={`/admin/skills/${encodeURIComponent(skillId)}/edit`} replace />;
    if (!detail.data.skill.isOwner) return <WorkspaceForbiddenState description="文件工作台仅供技能作者使用。你仍可在技能详情中浏览文件和使用技能。" action={<Button onClick={() => navigate("/skills")}>返回技能库</Button>} />;
    return (
        <Suspense fallback={<WorkspaceLoadingState label="正在打开技能工作台" />}>
            <AuthorWorkbench />
        </Suspense>
    );
}
