import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { WorkspaceForbiddenState } from "@/components/layout/workspace-state";
import { useSkillAdministrationAccess } from "@/lib/skill-access";

export function RequireSkillAdmin({ children }: { children: ReactNode }) {
    const allowed = useSkillAdministrationAccess();
    return <RequireAuth>{allowed ? children : <WorkspaceForbiddenState description="只有管理员可以上传和管理技能。" />}</RequireAuth>;
}
