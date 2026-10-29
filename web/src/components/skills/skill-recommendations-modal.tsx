import { App, Button } from "antd";
import { Check, Film, Landmark, LoaderCircle, Megaphone, Palette, Plus, Shapes, ShoppingBag, Users, Wrench, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { AppModal } from "@/components/ui/product/app-modal";
import { cn } from "@/lib/utils";
import { installSkillRecommendations, listSkillRecommendations, type SkillRecommendationIndustry, type SkillRecommendationList } from "@/services/api/skills";

const INDUSTRY_ICONS: Record<string, LucideIcon> = { shapes: Shapes, film: Film, "shopping-bag": ShoppingBag, megaphone: Megaphone, landmark: Landmark, palette: Palette, users: Users, wrench: Wrench };

type SkillRecommendationsModalProps = {
    open: boolean;
    onClose: () => void;
    /** 本次实际新装的技能 ID；调用方据此刷新自己的技能列表。 */
    onInstalled?: (skillIds: string[]) => void;
};

/** 把新装结果合进推荐列表，避免每次安装后整表重读。 */
function markInstalled(list: SkillRecommendationList, installed: string[]): SkillRecommendationList {
    if (!installed.length) return list;
    const ids = new Set(installed);
    return {
        installedTotal: list.installedTotal + installed.length,
        industries: list.industries.map((industry) => {
            const skills = industry.skills.map((skill) => (ids.has(skill.skillId) ? { ...skill, isAdded: true } : skill));
            return { ...industry, skills, installedCount: skills.filter((skill) => skill.isAdded).length };
        }),
    };
}

/**
 * 按行业推荐内置技能。只在用户点击时安装；装好的技能默认允许 Agent 按任务自动选用，
 * 用户可在技能设置里改成只在点名或固定时使用。
 */
export function SkillRecommendationsModal({ open, onClose, onInstalled }: SkillRecommendationsModalProps) {
    const { message } = App.useApp();
    const [data, setData] = useState<SkillRecommendationList | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [industryId, setIndustryId] = useState("");
    // 正在安装的目标：单个技能为 skillId，整组为 all:<industryId>；同一时间只允许一个安装请求。
    const [installing, setInstalling] = useState("");

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true);
        setError("");
        listSkillRecommendations(controller.signal)
            .then((result) => {
                if (controller.signal.aborted) return;
                setData(result);
                setIndustryId((current) => (result.industries.some((industry) => industry.industryId === current) ? current : result.industries[0]?.industryId || ""));
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "推荐技能读取失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [open, reloadKey]);

    const industry = data?.industries.find((item) => item.industryId === industryId) || data?.industries[0];

    const install = async (target: SkillRecommendationIndustry, skillIds: string[]) => {
        if (installing) return;
        setInstalling(skillIds.length === 1 ? skillIds[0] : `all:${target.industryId}`);
        try {
            const result = await installSkillRecommendations(target.industryId, skillIds);
            setData((current) => (current ? markInstalled(current, result.installed) : current));
            if (result.installed.length) message.success(`已安装 ${result.installed.length} 个技能，Agent 会按任务自动选用`);
            else message.info("这些技能已经在你的技能库里");
            onInstalled?.(result.installed);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "安装推荐技能失败");
        } finally {
            setInstalling("");
        }
    };

    const pendingIds = industry ? industry.skills.filter((skill) => !skill.isAdded).map((skill) => skill.skillId) : [];

    return (
        <AppModal open={open} width={760} title="按行业推荐技能" className="library-modal skill-recommendations-modal" footer={null} onCancel={onClose} mask={{ closable: !installing }}>
            <p className="mb-4 text-sm leading-6 text-foreground/55">选一个最接近你工作的行业，装上常用技能。装好后 Agent 会在任务需要时自己查找并使用，不用每次手动选择。</p>
            {loading && !data ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground" role="status">
                    <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    正在读取推荐技能…
                </div>
            ) : null}
            {error && !data ? <WorkspaceErrorState compact title="推荐技能读取失败" description={error} onRetry={() => setReloadKey((value) => value + 1)} /> : null}
            {data && !data.industries.length ? <p className="py-12 text-center text-sm text-muted-foreground">暂时没有可推荐的技能。</p> : null}
            {data && industry ? (
                <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex flex-wrap gap-2" role="group" aria-label="选择行业">
                        {data.industries.map((item) => {
                            const Icon = INDUSTRY_ICONS[item.icon] || Shapes;
                            const active = item.industryId === industry.industryId;
                            return (
                                <button
                                    key={item.industryId}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setIndustryId(item.industryId)}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        active ? "border-foreground/40 bg-surface-hover text-foreground" : "border-border text-foreground/65 hover:bg-surface-hover",
                                    )}
                                >
                                    <Icon className="size-4" aria-hidden="true" />
                                    {item.name}
                                    <span className="text-xs text-muted-foreground">
                                        {item.installedCount}/{item.skills.length}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 text-sm leading-6 text-foreground/65">{industry.description}</p>
                        <Button type="primary" icon={<Plus className="size-4" />} disabled={!pendingIds.length || Boolean(installing)} loading={installing === `all:${industry.industryId}`} onClick={() => void install(industry, [])}>
                            {pendingIds.length ? `全部安装（${pendingIds.length}）` : "已全部安装"}
                        </Button>
                    </div>
                    <ul className="thin-scrollbar max-h-[52vh] space-y-2 overflow-y-auto pr-1" aria-label={`${industry.name}推荐技能`}>
                        {industry.skills.map((skill) => (
                            <li key={skill.skillId} className="flex min-w-0 items-start gap-3 rounded-xl border border-border px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-medium [overflow-wrap:anywhere]">{skill.skillName}</div>
                                    <p className="mt-1 text-xs leading-5 text-foreground/65">{skill.reason}</p>
                                    {skill.description ? (
                                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]" title={skill.description}>
                                            {skill.description}
                                        </p>
                                    ) : null}
                                </div>
                                {skill.isAdded ? (
                                    <span className="inline-flex shrink-0 items-center gap-1 py-1 text-xs text-muted-foreground">
                                        <Check className="size-3.5" aria-hidden="true" />
                                        已安装
                                    </span>
                                ) : (
                                    <Button
                                        size="small"
                                        icon={<Plus className="size-3.5" />}
                                        disabled={Boolean(installing)}
                                        loading={installing === skill.skillId}
                                        onClick={() => void install(industry, [skill.skillId])}
                                        aria-label={`安装技能 ${skill.skillName}`}
                                    >
                                        安装
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="text-xs leading-5 text-muted-foreground">不想让某个技能被自动使用，可以在 Agent 设置的 Skills 里把它改成「仅手动」。</p>
                </div>
            ) : null}
        </AppModal>
    );
}
