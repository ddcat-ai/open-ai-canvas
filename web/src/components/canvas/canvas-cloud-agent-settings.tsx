import { useEffect, useState, type ReactNode } from "react";
import { Button, Checkbox, Input } from "antd";
import { ArrowLeft, BookMarked, Check, ChevronRight, Cpu, Gauge, LockKeyhole, PlugZap, Search, ShieldCheck, Sparkles, Wrench } from "lucide-react";

import { ModelPicker } from "@/components/model-picker";
import type { CanvasTheme } from "@/lib/canvas-theme";
import AgentMemoryPane from "@/pages/settings/agent-memory-pane";
import type { AgentPermissionMode, AgentProfileLayer, AgentProfileScope, AgentProfileView, AgentReasoningMode } from "@/services/api/agent";
import type { Skill } from "@/services/api/skills";
import type { AiConfig } from "@/stores/use-config-store";

export type AgentContextKey = "canvas" | "resources" | "generation_history" | "skills" | "project";
type SettingsSection = "home" | "profile" | "memories" | "skills" | "mcp" | "context" | "budget";

type AgentSettingsProps = {
    theme: CanvasTheme;
    config: AiConfig;
    selectedModel: string;
    permissionMode: AgentPermissionMode;
    reasoningMode: AgentReasoningMode;
    onReasoningModeChange: (value: AgentReasoningMode) => void;
    profileView: AgentProfileView | null;
    profileLoading: boolean;
    profileSaving: boolean;
    profileError?: string;
    projectId?: string;
    canvasId: string;
    onReloadProfile: () => Promise<void>;
    onSaveProfile: (input: { scope: AgentProfileScope; projectId?: string; canvasId?: string; content: string; revision: number }) => Promise<AgentProfileView>;
    contextScope: AgentContextKey[];
    nodeCount: number;
    installedSkills: Skill[];
    marketSkills: Skill[];
    selectedSkillIds: string[];
    skillSearch: string;
    skillsLoading: boolean;
    skillHasMore: boolean;
    maxCredits: string;
    maxGenerationTasks: string;
    maxVideoSeconds: string;
    onBack: () => void;
    onModelChange: (model: string) => void;
    onPermissionChange: (mode: AgentPermissionMode) => void;
    onContextToggle: (value: AgentContextKey) => void;
    onSkillSearch: (value: string) => void;
    onSkillToggle: (skillId: string) => void;
    onSkillInstall: (skill: Skill) => Promise<void>;
    onLoadMoreSkills: () => Promise<void>;
    onMaxCreditsChange: (value: string) => void;
    onMaxGenerationTasksChange: (value: string) => void;
    onMaxVideoSecondsChange: (value: string) => void;
};

const permissionOptions: Array<{ value: AgentPermissionMode; label: string; description: string; icon: typeof ShieldCheck; color: string }> = [
    { value: "read_only", label: "只读", description: "只分析和建议", icon: LockKeyhole, color: "#4f7cff" },
    { value: "request_approval", label: "请求审批", description: "写入和生成前确认", icon: ShieldCheck, color: "#b58336" },
    { value: "auto", label: "自动执行", description: "预算内执行已授权工具", icon: Sparkles, color: "#429477" },
];

const contextOptions: Array<{ value: AgentContextKey; label: string; description: string }> = [
    { value: "canvas", label: "已保存画布摘要", description: "最多 80 个节点的标题与文本片段，不含媒体正文或未同步修改" },
];

const reasoningOptions: Array<{ value: AgentReasoningMode; label: string; description: string }> = [
    { value: "off", label: "关闭", description: "直接执行" },
    { value: "auto", label: "自动", description: "按任务决定" },
    { value: "deep", label: "深入", description: "复杂任务优先规划" },
];

export function CanvasCloudAgentSettings(props: AgentSettingsProps) {
    const [section, setSection] = useState<SettingsSection>("home");
    const [skillTab, setSkillTab] = useState<"installed" | "market">("installed");
    const { theme } = props;
    const title = section === "home" ? "Agent 设置" : sectionTitle(section);
    const goHome = () => setSection("home");

    return (
        <div className="canvas-agent-settings flex min-h-0 min-w-0 flex-1 flex-col" style={{ background: theme.node.panel }}>
            <header data-agent-drag-handle className="agent-panel-header flex shrink-0 items-center gap-2">
                <Button type="text" shape="circle" icon={<ArrowLeft className="size-4" />} onClick={section === "home" ? props.onBack : goHome} aria-label={section === "home" ? "返回对话" : "返回设置"} />
                <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{title}</div><div className="mt-0.5 text-[11px] opacity-40">{section === "home" ? "只影响下一次新运行" : sectionSubtitle(section)}</div></div>
                {section !== "home" ? <span className="rounded-full px-2 py-1 text-[10px] opacity-50" style={{ background: theme.node.fill }}>{section === "skills" ? `${props.selectedSkillIds.length} 已启用` : "当前 Agent"}</span> : null}
            </header>

            {section === "home" ? <SettingsHome props={props} theme={theme} onOpen={setSection} /> : null}
            {section === "profile" ? <ProfileWorkspace props={props} theme={theme} /> : null}
            {section === "memories" ? <MemoriesWorkspace /> : null}
            {section === "skills" ? <SkillsWorkspace props={props} theme={theme} tab={skillTab} onTabChange={setSkillTab} /> : null}
            {section === "mcp" ? <McpWorkspace theme={theme} /> : null}
            {section === "context" ? <ContextWorkspace props={props} theme={theme} /> : null}
            {section === "budget" ? <BudgetWorkspace props={props} theme={theme} /> : null}
        </div>
    );
}

function SettingsHome({ props, theme, onOpen }: { props: AgentSettingsProps; theme: CanvasTheme; onOpen: (section: SettingsSection) => void }) {
    return (
        <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
            <section>
                <SettingLabel label="推理模式" hint="新运行生效" />
                <div className="grid grid-cols-3 gap-2">{reasoningOptions.map((option) => <button key={option.value} type="button" aria-pressed={props.reasoningMode === option.value} onClick={() => props.onReasoningModeChange(option.value)} className="rounded-xl p-3 text-left" style={{ background: props.reasoningMode === option.value ? theme.toolbar.itemHover : theme.node.fill, border: `1px solid ${props.reasoningMode === option.value ? theme.accent.primary : 'transparent'}` }}><div className="text-xs font-semibold">{option.label}</div><div className="mt-1 text-[10px] opacity-50">{option.description}</div></button>)}</div>
                <p className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>推理只用于目标拆解、缺口判断和下一步工具选择，不会把内部思考过程展示给用户。</p>
            </section>
            <section>
                <SettingLabel label="对话模型" hint="新运行生效" />
                <div className="min-w-0 rounded-xl px-2 py-1.5" style={{ background: theme.node.fill }}>
                    <ModelPicker config={props.config} value={props.selectedModel} capability="text" onChange={props.onModelChange} variant="creation" fullWidth showSelectedPrice showOptionPrices placeholder="选择文本模型" className="!border-0 !bg-transparent !shadow-none" popoverClassName="agent-model-picker-popover" />
                </div>
            </section>
            <section>
                <SettingLabel label="执行权限" hint="新运行生效" />
                <div className="canvas-agent-permissions">
                    {permissionOptions.map((option) => {
                        const Icon = option.icon;
                        const active = option.value === props.permissionMode;
                        return (
                            <button key={option.value} type="button" className="flex min-w-0 flex-col gap-2 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30" style={{ background: theme.node.fill, color: theme.node.text, boxShadow: active ? `inset 0 0 0 1px ${theme.node.muted}` : "none" }} onClick={() => props.onPermissionChange(option.value)} aria-pressed={active}>
                                <span className="flex w-full items-center gap-1.5 text-xs font-medium"><Icon className="size-3.5 shrink-0" style={{ color: option.color }} /><span>{option.label}</span>{active ? <Check className="ml-auto size-3 shrink-0" /> : null}</span>
                                <span className="text-[11px] leading-4" style={{ color: theme.node.muted }}>{option.description}</span>
                            </button>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>默认逐项审批。自动模式可修改已授权的画布内容；图片、视频始终先创建草稿，再经独立审批才提交生成任务。</p>
            </section>
            <section>
                <SettingLabel label="能力与范围" />
                <div className="space-y-1">
                    <SettingRow theme={theme} icon={<Cpu className="size-4" />} title="上下文" summary={`${props.nodeCount} 个节点 · ${props.contextScope.length} 个范围`} onClick={() => onOpen("context")} />
                    <SettingRow theme={theme} icon={<Sparkles className="size-4" />} title="长期偏好" summary={profileSummary(props.profileView)} onClick={() => onOpen("profile")} />
                    <SettingRow theme={theme} icon={<BookMarked className="size-4" />} title="个人记忆" summary="批准、添加、导出导入；只影响你的会话" onClick={() => onOpen("memories")} />
                    <SettingRow theme={theme} icon={<Sparkles className="size-4" />} title="Skills · 用户技能库" summary={`${props.installedSkills.length} 个已安装 · 本轮启用 ${props.selectedSkillIds.length} 个`} onClick={() => onOpen("skills")} />
                    <SettingRow theme={theme} icon={<Wrench className="size-4" />} title="工具与连接" summary="画布、技能参考文件、生成任务" onClick={() => onOpen("mcp")} />
                    <SettingRow theme={theme} icon={<Gauge className="size-4" />} title="预算" summary={`每轮最多 ${props.maxCredits || "未设置"} 积分 · 固定计价模型`} onClick={() => onOpen("budget")} />
                </div>
            </section>
        </div>
    );
}

function MemoriesWorkspace() {
    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <AgentMemoryPane compact />
        </div>
    );
}

function SkillsWorkspace({ props, theme, tab, onTabChange }: { props: AgentSettingsProps; theme: CanvasTheme; tab: "installed" | "market"; onTabChange: (tab: "installed" | "market") => void }) {
    const query = props.skillSearch.trim().toLocaleLowerCase();
    const source = tab === "installed" ? props.installedSkills.filter((skill) => `${skill.skillName} ${skill.description || ""}`.toLocaleLowerCase().includes(query)) : props.marketSkills;
    const allVisibleSelected = tab === "installed" && source.length > 0 && source.every((skill) => props.selectedSkillIds.includes(skill.skillId));
    const toggleAll = () => source.forEach((skill) => { const selected = props.selectedSkillIds.includes(skill.skillId); if (tab === "installed" && selected === allVisibleSelected) props.onSkillToggle(skill.skillId); });
    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 px-4 pt-4">
                <div className="flex gap-1 rounded-xl p-1" style={{ background: theme.node.fill }}>
                    <TabButton theme={theme} active={tab === "installed"} label={`已安装 ${props.installedSkills.length}`} onClick={() => onTabChange("installed")} />
                    <TabButton theme={theme} active={tab === "market"} label="Skill 市场" onClick={() => onTabChange("market")} />
                </div>
                <Input prefix={<Search className="size-4" style={{ color: theme.node.muted }} />} value={props.skillSearch} onChange={(event) => props.onSkillSearch(event.target.value)} placeholder={tab === "market" ? "搜索 Skill 市场" : "筛选已安装 Skill"} aria-label="搜索 Skills" className="mt-3 !h-10 !rounded-xl" />
                <div className="mt-4 flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                    <span>{tab === "market" ? "发现适合当前创作的技能" : `${source.length} 个匹配的 Skill`}</span>
                    {tab === "installed" && source.length > 0 ? <button type="button" className="shrink-0 rounded px-1 py-1 focus-visible:outline focus-visible:outline-2" onClick={toggleAll}>{allVisibleSelected ? "取消全选" : "全选当前"}</button> : null}
                </div>
            </div>
            <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 min-w-0 flex-1 space-y-1 overflow-y-auto p-4 pt-2">
                {props.skillsLoading && !source.length ? <div className="py-8 text-center text-xs" style={{ color: theme.node.muted }}>正在读取技能…</div> : null}
                {source.map((skill) => <SkillRow key={skill.skillId} skill={skill} theme={theme} selected={props.selectedSkillIds.includes(skill.skillId)} installed={skill.isAdded} selectable={tab === "installed"} onToggle={() => props.onSkillToggle(skill.skillId)} onInstall={() => void props.onSkillInstall(skill)} />)}
                {!props.skillsLoading && !source.length ? <div className="py-10 text-center text-xs" style={{ color: theme.node.muted }}>没有匹配结果，试试其他关键词</div> : null}
                {tab === "market" && props.skillHasMore ? <button type="button" className="my-3 w-full rounded-xl py-2 text-xs" style={{ background: theme.node.fill, color: theme.node.text }} onClick={() => void props.onLoadMoreSkills()} disabled={props.skillsLoading}>{props.skillsLoading ? "加载中…" : "加载更多"}</button> : null}
            </div>
        </div>
    );
}

type ProfileDraft = Pick<AgentProfileLayer, "content" | "revision" | "hash"> & { dirty: boolean };

function ProfileWorkspace({ props, theme }: { props: AgentSettingsProps; theme: CanvasTheme }) {
    const [scope, setScope] = useState<AgentProfileScope>("user");
    const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
    const [error, setError] = useState("");
    const layer = profileLayer(props.profileView, scope, props.projectId, props.canvasId);
    const draftKey = profileDraftKey(scope, props.projectId, props.canvasId);
    const serverDraft: ProfileDraft = { content: layer.content, revision: layer.revision, hash: layer.hash, dirty: false };
    const draft = drafts[draftKey] || serverDraft;
    const profileUnavailable = props.profileLoading || !props.profileView || Boolean(props.profileError);

    useEffect(() => {
        setDrafts((current) => {
            const existing = current[draftKey];
            if (existing?.dirty) return current;
            if (existing && existing.revision === layer.revision && existing.hash === layer.hash && existing.content === layer.content) return current;
            return { ...current, [draftKey]: { content: layer.content, revision: layer.revision, hash: layer.hash, dirty: false } };
        });
        setError("");
    }, [draftKey, layer.content, layer.hash, layer.revision]);

    const updateDraft = (content: string) => {
        setDrafts((current) => {
            const base = current[draftKey] || serverDraft;
            return { ...current, [draftKey]: { ...base, content, dirty: true } };
        });
    };

    const save = async () => {
        setError("");
        try {
            const result = await props.onSaveProfile({
                scope,
                projectId: scope === "project" ? props.projectId : undefined,
                canvasId: scope === "canvas" ? props.canvasId : undefined,
                content: draft.content,
                revision: draft.revision,
            });
            const savedLayer = profileLayer(result, scope, props.projectId, props.canvasId);
            setDrafts((current) => ({
                ...current,
                [draftKey]: { content: savedLayer.content, revision: savedLayer.revision, hash: savedLayer.hash, dirty: false },
            }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        }
    };

    const disabled = profileUnavailable || props.profileSaving || (scope === "project" && !props.projectId);
    return (
        <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="rounded-xl p-4" style={{ background: theme.node.fill }}>
                <div className="text-sm font-semibold">长期偏好文档</div>
                <p className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>这里定义 Agent 的长期工作习惯、语气和输出结构。它不会增加工具、节点、预算或审批权限；安全契约始终由服务端代码控制。</p>
            </div>
            <div className="mt-4 flex gap-1 rounded-xl p-1" style={{ background: theme.node.fill }}>
                <TabButton theme={theme} active={scope === "user"} label="用户" onClick={() => setScope("user")} />
                <TabButton theme={theme} active={scope === "project"} label="项目" onClick={() => setScope("project")} />
                <TabButton theme={theme} active={scope === "canvas"} label="画布" onClick={() => setScope("canvas")} />
            </div>
            {scope === "project" && !props.projectId ? <p className="mt-3 text-xs leading-5" style={{ color: theme.node.muted }}>当前画布尚未关联项目，项目偏好暂不可用。</p> : null}
            {props.profileLoading ? <p className="mt-4 text-xs" style={{ color: theme.node.muted }}>正在读取偏好快照…</p> : null}
            {props.profileError ? <ProfileError message={props.profileError} onRetry={props.onReloadProfile} theme={theme} /> : null}
            <label className="mt-4 block">
                <span className="flex items-center justify-between text-xs font-semibold"><span>{scopeLabel(scope)}</span><span className="text-[10px] font-normal opacity-40">修订 {draft.revision}{draft.dirty ? " · 未保存" : ""}</span></span>
                <Input.TextArea value={draft.content} onChange={(event) => updateDraft(event.target.value)} disabled={disabled} maxLength={12000} showCount autoSize={{ minRows: 10, maxRows: 20 }} placeholder="例如：每次先给结论，再列出将改动的镜头；提示词同时给中文和英文。" className="mt-2 !rounded-xl" style={{ background: theme.node.fill }} />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3">
                <span className="text-[10px] leading-4 opacity-45">保存后只影响下一次新运行。正在运行的 Agent 会固定原快照。</span>
                <Button type="primary" onClick={() => void save()} loading={props.profileSaving} disabled={disabled || !draft.dirty}>保存</Button>
            </div>
            {error ? <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "#d66b6b1f", color: "#d66b6b" }}>{error}</div> : null}
        </div>
    );
}

function profileDraftKey(scope: AgentProfileScope, projectId: string | undefined, canvasId: string) {
    if (scope === "project") return `project:${projectId || "unbound"}`;
    if (scope === "canvas") return `canvas:${canvasId}`;
    return "user";
}

function profileLayer(view: AgentProfileView | null, scope: AgentProfileScope, projectId: string | undefined, canvasId: string): AgentProfileLayer {
    return view?.layers.find((item) => item.scope === scope) || { scope, projectId: scope === "project" ? projectId : undefined, canvasId: scope === "canvas" ? canvasId : undefined, content: "", revision: 0, hash: "" };
}

function profileSummary(view: AgentProfileView | null) {
    const count = view?.layers.filter((layer) => layer.content.trim()).length || 0;
    return count ? `${count} 层已配置 · 仅影响行为偏好` : "未配置 · 仅影响行为偏好";
}

function scopeLabel(scope: AgentProfileScope) { return scope === "user" ? "用户偏好" : scope === "project" ? "项目偏好" : "当前画布偏好"; }

function ProfileError({ message, onRetry, theme }: { message: string; onRetry: () => Promise<void>; theme: CanvasTheme }) {
    return <div className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: "#d6a24a1f", color: theme.node.text }}><div>{message}</div><button type="button" className="mt-2 underline" onClick={() => void onRetry()}>重新读取</button></div>;
}

function SkillRow({ skill, theme, selected, installed, selectable, onToggle, onInstall }: { skill: Skill; theme: CanvasTheme; selected: boolean; installed: boolean; selectable: boolean; onToggle: () => void; onInstall: () => void }) {
    return (
        <div className="canvas-agent-skill-row flex min-w-0 items-start gap-3 rounded-xl p-3 transition-colors">
            {selectable ? <Checkbox className="mt-0.5 shrink-0" checked={selected} onChange={onToggle} aria-label={`启用 ${skill.skillName}`} /> : <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.node.fill, color: theme.node.muted }}><Sparkles className="size-4" /></span>}
            <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2"><span className="min-w-0 flex-1 break-words text-[13px] font-medium [overflow-wrap:anywhere]">{skill.skillName}</span>{skill.version ? <span className="shrink-0 text-[10px]" style={{ color: theme.node.muted }}>v{skill.version}</span> : null}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 [overflow-wrap:anywhere]" style={{ color: theme.node.muted }} title={skill.description || undefined}>{skill.description || "暂无技能说明"}</p>
            </div>
            {!selectable ? <Button size="small" type="text" className="!shrink-0 !px-2" disabled={installed} onClick={onInstall}>{installed ? "已安装" : "添加"}</Button> : null}
        </div>
    );
}

function McpWorkspace({ theme }: { theme: CanvasTheme }) {
    return (
        <div className="canvas-agent-settings-scroll thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
            <div className="rounded-xl p-4" style={{ background: theme.node.fill }}>
                <div className="flex items-center gap-2 text-sm font-medium"><PlugZap className="size-4 shrink-0" />服务端内置工具</div>
                <p className="mt-2 text-xs leading-5" style={{ color: theme.node.muted }}>按本轮权限开放，实际能力在发送前向后端确认。Skills 提供操作知识，不会提升工具权限。</p>
            </div>
            <section>
                <SettingLabel label="工具范围" />
                {["已保存画布读取", "技能参考文件（固定版本）", "文本 / Markdown 节点写入", "系统模型媒体生成与任务查询"].map((tool) => <div key={tool} className="flex items-center gap-3 py-3 text-xs"><Wrench className="size-4 shrink-0" style={{ color: theme.node.muted }} /><span className="flex-1">{tool}</span><span style={{ color: theme.node.muted }}>受权限约束</span></div>)}
            </section>
            <p className="text-xs leading-5" style={{ color: theme.node.muted }}>自定义 MCP 暂未开放。实际工具权限、密钥和调用配额需由 Agent 后端校验，不能在浏览器中假设已启用。</p>
        </div>
    );
}

function ContextWorkspace({ props, theme }: { props: AgentSettingsProps; theme: CanvasTheme }) {
    return <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5"><div className="rounded-xl p-4" style={{ background: theme.node.fill }}><div className="text-sm font-semibold">Agent 可以读取什么</div><div className="mt-1 text-[11px] opacity-45">只影响本次新运行的上下文范围</div></div><div className="mt-4 space-y-1">{contextOptions.map((option) => { const active = props.contextScope.includes(option.value); return <button key={option.value} type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left" style={{ background: active ? theme.accent.primarySoft : theme.node.fill }} onClick={() => props.onContextToggle(option.value)} aria-pressed={active}><span className="grid size-5 shrink-0 place-items-center rounded" style={{ background: active ? theme.accent.primary : theme.node.panel, color: active ? theme.accent.onPrimary : theme.node.muted }}>{active ? <Check className="size-3" /> : null}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{option.label}</span><span className="mt-0.5 block text-[10px] opacity-45">{option.description}</span></span></button>; })}</div></div>;
}

function BudgetWorkspace({ props, theme }: { props: AgentSettingsProps; theme: CanvasTheme }) {
    return <div className="thin-scrollbar min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"><div className="rounded-xl p-4" style={{ background: theme.node.fill }}><div className="text-sm font-semibold">本轮累计预算</div><p className="mt-2 text-xs opacity-60">积分预算用于费用保护；生成任务和视频秒数填 0 表示不设该项上限。模型循环由预算和运行状态控制，不再用固定次数截断。</p></div><BudgetInput label="积分上限" hint="必填且大于 0；所有步骤累计" value={props.maxCredits} onChange={props.onMaxCreditsChange} theme={theme} /><BudgetInput label="生成任务上限" hint="0 表示不限；只读模式不执行生成" value={props.maxGenerationTasks} onChange={props.onMaxGenerationTasksChange} theme={theme} /><BudgetInput label="视频秒数上限" hint="0 表示不限；按请求时长累计" value={props.maxVideoSeconds} onChange={props.onMaxVideoSecondsChange} theme={theme} /></div>;
}

function SettingRow({ theme, icon, title, summary, onClick }: { theme: CanvasTheme; icon: ReactNode; title: string; summary: string; onClick: () => void }) { return <button type="button" className="canvas-agent-setting-row flex w-full min-w-0 items-center gap-3 rounded-xl p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2" onClick={onClick}><span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.node.fill, color: theme.node.muted }}>{icon}</span><span className="min-w-0 flex-1"><span className="block text-[13px] font-medium">{title}</span><span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>{summary}</span></span><ChevronRight className="size-4 shrink-0" style={{ color: theme.node.muted }} /></button>; }
function TabButton({ active, label, onClick, theme }: { active: boolean; label: string; onClick: () => void; theme: CanvasTheme }) { return <button type="button" aria-pressed={active} className="min-w-0 flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2" style={{ background: active ? theme.toolbar.itemHover : "transparent", color: active ? theme.node.text : theme.node.muted }} onClick={onClick}>{label}</button>; }
function SettingLabel({ label, hint }: { label: string; hint?: string }) { return <div className="mb-2 flex items-center justify-between text-xs font-semibold"><span>{label}</span>{hint ? <span className="text-[10px] font-normal opacity-40">{hint}</span> : null}</div>; }
function BudgetInput({ label, hint, value, onChange, theme }: { label: string; hint: string; value: string; onChange: (value: string) => void; theme: CanvasTheme }) { return <label className="block"><span className="flex items-center justify-between text-xs font-medium"><span>{label}</span><span className="text-[10px] opacity-40">{hint}</span></span><Input size="large" value={value} onChange={(event) => onChange(event.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className="mt-2 !rounded-lg" style={{ background: theme.node.fill }} /></label>; }
function sectionTitle(section: SettingsSection) { return section === "profile" ? "长期偏好" : section === "memories" ? "个人记忆" : section === "skills" ? "Skills" : section === "mcp" ? "MCP 与工具" : section === "context" ? "上下文" : "预算"; }
function sectionSubtitle(section: SettingsSection) { return section === "profile" ? "用户、项目和画布的长期行为偏好" : section === "memories" ? "只属于你，批准后才会注入会话" : section === "skills" ? "搜索、安装并选择本轮技能" : section === "mcp" ? "云端工具与连接状态" : section === "context" ? "控制 Agent 能读取的范围" : "控制本轮积分与生成消耗"; }

export function agentPermissionLabel(mode: AgentPermissionMode) { return permissionOptions.find((option) => option.value === mode)?.label || "请求审批"; }
export function agentPermissionVisual(mode: AgentPermissionMode) { const option = permissionOptions.find((item) => item.value === mode) || permissionOptions[0]; return { color: option.color, soft: `${option.color}1f`, icon: option.icon }; }
export function agentPermissionMenuItems(mode: AgentPermissionMode, onChange: (mode: AgentPermissionMode) => void) { return permissionOptions.map((option) => ({ key: option.value, label: <span>{option.label}</span>, icon: mode === option.value ? <Check className="size-3.5" style={{ color: option.color }} /> : <option.icon className="size-3.5" style={{ color: option.color }} />, onClick: () => onChange(option.value) })); }
