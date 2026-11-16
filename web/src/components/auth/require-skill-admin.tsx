import type { ReactNode } from "react";
import { RequireAuth } from "@/components/auth/require-auth";
import { WorkspaceForbiddenState } from "@/components/layout/workspace-state";
import { useSkillLibraryAccess } from "@/lib/skill-access";

export function RequireSkillAdmin({ children }: { children: ReactNode }) {
    const allowed = useSkillLibraryAccess();
    return <RequireAuth>{allowed ? children : <WorkspaceForbiddenState description="技能库仅供管理员查看和管理。" />}</RequireAuth>;
}
