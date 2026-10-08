import { useEffect, useState } from "react";
import { Alert, Button, Select, Space } from "antd";
import { getActiveUserScope } from "@/lib/user-scope";
import { getSkillCuration, type SkillCuration } from "@/services/api/skill-curation";
import type { Skill } from "@/services/api/skills";
import { Film, ShoppingBag, Megaphone, Landmark, Palette, Users, Wrench, Shapes } from "lucide-react";

export const curationIconKeys = ["shapes", "film", "shopping-bag", "megaphone", "landmark", "palette", "users", "wrench"];
export const curationIconLabels: Record<string, string> = { shapes: "默认", film: "影视", "shopping-bag": "购物袋", megaphone: "喇叭", landmark: "地标", palette: "调色盘", users: "社群", wrench: "工具" };
export function curationIcon(key?: string) {
    return ({ film: Film, "shopping-bag": ShoppingBag, megaphone: Megaphone, landmark: Landmark, palette: Palette, users: Users, wrench: Wrench } as Record<string, typeof Shapes>)[key || ""] || Shapes;
}
export function effectiveCurationRoot(skill: Skill, data: SkillCuration) {
    const id = (!skill.isPrivate && data.rootAssignments?.find((item) => item.skillId === skill.skillId)?.rootId) || skill.tag;
    return data.roots?.some((root) => root.id === id && root.enabled) ? id : "__unassigned__";
}
export function groupCuratedSkills(skills: Skill[], data: SkillCuration) {
    return (data.roots || []).map((root) => ({ value: root.id, label: root.name, skills: skills.filter((skill) => effectiveCurationRoot(skill, data) === root.id) })).filter((group) => group.skills.length);
}

export function curationQuery(data: SkillCuration | null, value: string) {
    if (!data?.enabled || !value) return {};
    if (value.startsWith("root:")) return { platformRootId: value.slice(5) };
    return value === "__uncategorized__" ? { platformUncategorized: true } : { platformCategoryId: value };
}

export function useSkillCuration(active = true) {
    const scope = getActiveUserScope();
    const [result, setResult] = useState<{ scope: string; data: SkillCuration } | null>(null);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        setError("");
        getSkillCuration().then((data) => { if (!cancelled) setResult({ scope, data }); }).catch(() => { if (!cancelled) { setResult(null); setError("分类暂不可用，请重试"); } });
        const refresh = () => setReload((value) => value + 1);
        window.addEventListener("focus", refresh);
        window.addEventListener("canvas-skills-changed", refresh);
        return () => { cancelled = true; window.removeEventListener("focus", refresh); window.removeEventListener("canvas-skills-changed", refresh); };
    }, [active, scope, reload]);
    return { curation: result?.scope === scope ? result.data : null, error, retry: () => setReload((value) => value + 1) };
}

export function matchesCuration(skill: Skill, data: SkillCuration | null, category: string) {
    if (!data?.enabled || !category) return true;
    if (category.startsWith("root:")) return effectiveCurationRoot(skill, data) === category.slice(5);
    const ids = data.assignments.filter((item) => item.skillId === skill.skillId).map((item) => item.categoryId);
    return category === "__uncategorized__" ? ids.length === 0 : ids.includes(category);
}

export function SkillCurationBrowser({ data, value, onChange, error, retry }: { data: SkillCuration | null; value: string; onChange: (value: string) => void; error: string; retry: () => void }) {
    useEffect(() => {
        const valid = value.startsWith("root:") ? data?.roots?.some((root) => root.id === value.slice(5)) : data?.categories.some((item) => item.id === value);
        if ((!data?.enabled || (value && value !== "__uncategorized__" && !valid)) && value) onChange("");
    }, [data, value, onChange]);
    if (error) return <Alert type="warning" title={error} action={<Button onClick={retry}>重试</Button>} />;
    if (!data?.enabled) return null;
    return (
        <div className="skill-curation-browser">
            <span className="skill-curation-browser-label">平台分类</span>
            <Select
                aria-label="平台分类"
                className="skill-curation-browser-select"
                value={value}
                onChange={onChange}
                popupMatchSelectWidth={false}
                options={[
                    { value: "", label: "全部分类" },
                    { value: "__uncategorized__", label: "未细分" },
                    ...(data.roots || []).map((root) => {
                        const Icon = curationIcon(root.iconKey);
                        return { value: `root:${root.id}`, label: <Space><Icon size={16} />{root.name}</Space> };
                    }),
                    ...data.categories.map((item) => ({ value: item.id, label: `${data.roots?.find((root) => root.id === item.rootTag)?.name || "分类"} / ${item.name}` })),
                ]}
            />
        </div>
    );
}
