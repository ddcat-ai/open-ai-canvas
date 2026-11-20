import { App, Button, Select } from "antd";
import { Network } from "lucide-react";
import { useEffect, useState } from "react";

import { getSystemUpdateStatus, saveSystemUpdateSources, testSystemUpdateSources, type SystemUpdateSources, type SystemUpdateStatus } from "@/services/api/system-update";
import { SettingsSectionCard } from "../../components/admin-ui";
import "./system-update-sources.css";

export function SystemUpdateSourcesPanel({
    status,
    busy,
    onStatusChange,
    onDirtyChange,
    onBusyChange,
}: {
    status: SystemUpdateStatus | null;
    busy: boolean;
    onStatusChange: (status: SystemUpdateStatus) => void;
    onDirtyChange: (dirty: boolean) => void;
    onBusyChange: (busy: boolean) => void;
}) {
    const { message } = App.useApp();
    const [draft, setDraft] = useState<SystemUpdateSources>({ githubSource: "direct", imageSource: "ghcr" });
    const [pending, setPending] = useState<"save" | "test" | null>(null);
    const saved = status?.sources;
    const dirty = Boolean(saved && (draft.githubSource !== saved.githubSource || draft.imageSource !== saved.imageSource));
    const probe = status?.sourceProbe;
    const probing = probe?.status === "running";
    const disabled = busy || pending !== null || !saved || !status?.connected;
    const preset = draft.githubSource === "direct" && draft.imageSource === "ghcr" ? "direct" : draft.githubSource === "gh_proxy" && draft.imageSource === "nju" ? "mirror" : "mixed";

    useEffect(() => {
        if (saved) setDraft({ githubSource: saved.githubSource, imageSource: saved.imageSource });
    }, [saved?.githubSource, saved?.imageSource]);

    useEffect(() => {
        onDirtyChange(dirty);
    }, [dirty, onDirtyChange]);

    const submit = async (action: "save" | "test") => {
        setPending(action);
        onBusyChange(true);
        try {
            const next = action === "save" ? await saveSystemUpdateSources(draft) : await testSystemUpdateSources();
            onStatusChange(next);
            message.success(action === "save" ? "更新来源已保存，请重新检查版本" : "服务器正在检测更新来源");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新来源操作失败");
            try {
                onStatusChange(await getSystemUpdateStatus());
            } catch {
                /* 页面保留草稿，等待下次读取真实状态。 */
            }
        } finally {
            setPending(null);
            onBusyChange(false);
        }
    };

    return (
        <SettingsSectionCard
            layout="stacked"
            icon={<Network className="size-4" />}
            title="更新来源"
            description="选择版本、更新文件和容器镜像的来源。连接检测由运行服务器执行。"
            status={{ label: !saved ? "不可用" : dirty ? "尚未保存" : probing ? "正在检测" : "已保存", color: !saved || dirty ? "warning" : probing ? "blue" : "default" }}
            footer={
                <>
                    <span className="admin-update-sources-note">{dirty ? "先保存来源，再测试连接或检查更新。" : "更新任务开始后会固定本次来源。"}</span>
                    <div className="admin-update-sources-actions">
                        <Button disabled={disabled || dirty} loading={pending === "test" || probing} onClick={() => void submit("test")}>
                            测试连通性
                        </Button>
                        <Button type="primary" disabled={disabled || !dirty} loading={pending === "save"} onClick={() => void submit("save")}>
                            保存来源
                        </Button>
                    </div>
                </>
            }
        >
            <div className="admin-update-sources-body">
                {!saved ? <p className="admin-update-sources-note">当前更新器未提供来源配置。</p> : null}
                <div className="admin-update-sources-presets" role="group" aria-label="更新来源预设">
                    <button type="button" aria-pressed={preset === "direct"} disabled={disabled} onClick={() => setDraft({ githubSource: "direct", imageSource: "ghcr" })}>
                        <strong>官方直连</strong>
                        <span>GitHub + GHCR</span>
                    </button>
                    <button type="button" aria-pressed={preset === "mirror"} disabled={disabled} onClick={() => setDraft({ githubSource: "gh_proxy", imageSource: "nju" })}>
                        <strong>镜像加速</strong>
                        <span>GH-Proxy + 南京大学镜像源</span>
                    </button>
                </div>
                <dl className="admin-update-sources-routes">
                    <dt>版本与更新文件</dt>
                    <dd>{draft.githubSource === "gh_proxy" ? "gh-proxy.com → GitHub API / Release / Raw" : "GitHub API / Release / Raw"}</dd>
                    <dt>容器镜像</dt>
                    <dd>{draft.imageSource === "nju" ? "ghcr.nju.edu.cn" : "ghcr.io"} / Backend · Web · Agent</dd>
                </dl>
                <details className="admin-update-sources-advanced">
                    <summary>分别设置 GitHub 与容器镜像来源{preset === "mixed" ? " · 当前为混合配置" : ""}</summary>
                    <div className="admin-update-sources-fields">
                        <label>
                            <span>GitHub 资源</span>
                            <Select
                                aria-label="GitHub 资源来源"
                                value={draft.githubSource}
                                disabled={disabled}
                                options={[
                                    { value: "direct", label: "GitHub 官方直连" },
                                    { value: "gh_proxy", label: "GH-Proxy · gh-proxy.com" },
                                ]}
                                onChange={(githubSource: SystemUpdateSources["githubSource"]) => setDraft((value) => ({ ...value, githubSource }))}
                            />
                        </label>
                        <label>
                            <span>容器镜像</span>
                            <Select
                                aria-label="容器镜像来源"
                                value={draft.imageSource}
                                disabled={disabled}
                                options={[
                                    { value: "ghcr", label: "GHCR · ghcr.io" },
                                    { value: "nju", label: "南京大学 · ghcr.nju.edu.cn" },
                                ]}
                                onChange={(imageSource: SystemUpdateSources["imageSource"]) => setDraft((value) => ({ ...value, imageSource }))}
                            />
                        </label>
                    </div>
                </details>
                <div className="admin-update-sources-results" aria-live="polite">
                    {probe ? (
                        <>
                            <p className="admin-update-sources-note">
                                {probing ? "正在检测" : probe.status === "succeeded" ? "检测通过" : "检测未通过"}
                                {probe.targetVersion ? ` · ${probe.targetVersion}` : ""} · {new Date(probe.startedAt).toLocaleString("zh-CN", { hour12: false })}
                            </p>
                            <ul>
                                {probe.checks.map((check) => (
                                    <li key={check.key}>
                                        <div>
                                            <strong>{check.label}</strong>
                                            <span>{check.status === "passed" ? "通过" : check.status === "failed" ? "失败" : "待检测"}</span>
                                        </div>
                                        <p>{check.detail || "等待执行"}</p>
                                    </li>
                                ))}
                            </ul>
                            <p className="admin-update-sources-note">镜像清单检测通过后，完整镜像和更新器仍会在正式更新前下载并校验。</p>
                        </>
                    ) : (
                        <p className="admin-update-sources-note">尚未检测服务器到所选来源的连接。</p>
                    )}
                </div>
            </div>
        </SettingsSectionCard>
    );
}
