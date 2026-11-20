import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Input, Progress, Select, Space, Switch, Table, Tag, Typography, Upload } from "antd";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import { AppModal } from "@/components/ui/product/app-modal";
import { EcommerceLibraryPanel } from "./ecommerce-library-panel";
import { installEcommerceSkillFile, installEcommerceSkillGitHub, renameEcommerceSkill, listEcommerceManagedSkills, setEcommerceManagedSkillEnabled, type EcommerceManagedSkill } from "@/services/api/ecommerce-skills";
import "./ecommerce-skills.css";

export default function EcommerceSkillsPage() {
    const { message } = App.useApp();
    const [skills, setSkills] = useState<EcommerceManagedSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState("");
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [group, setGroup] = useState("");
    const [status, setStatus] = useState("");
    const [installOpen, setInstallOpen] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installError, setInstallError] = useState("");
    const [progress, setProgress] = useState(0);
    const [url, setUrl] = useState("");
    const [subdir, setSubdir] = useState("");
    const [origin, setOrigin] = useState("");
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listEcommerceManagedSkills();
            setSkills([...result.skills].sort((a, b) => Number(b.origin === "user-installed") - Number(a.origin === "user-installed")));
            setError("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const filtered = useMemo(
        () =>
            skills.filter(
                (skill) =>
                    (!origin || skill.origin === origin) &&
                    (!group || skill.group === group) &&
                    (!status || skill.enabled === (status === "enabled")) &&
                    [skill.name, skill.description, skill.group, skill.sourceUrl, ...skill.terms].join(" ").toLowerCase().includes(search.trim().toLowerCase()),
            ),
        [skills, group, status, search, origin],
    );
    const install = async (file?: File) => {
        if (file && !/\.(zip|md|markdown)$/i.test(file.name)) {
            setInstallError("请选择 ZIP 或 Markdown 技能文件。");
            return;
        }
        if (file && file.size > 1024 ** 3) {
            setInstallError("文件太大，电商 Skills 最大支持 1GB，请缩小后重试。");
            return;
        }
        setInstalling(true);
        setInstallError("");
        setProgress(file ? 0 : -1);
        try {
            if (file) await installEcommerceSkillFile(file, setProgress);
            else await installEcommerceSkillGitHub(url.trim(), subdir.trim());
            await refresh();
            setInstallOpen(false);
            setUrl("");
            setSubdir("");
            message.success("Skills 安装完成，已默认启用，Agent 将自动分析并按需调用");
        } catch (cause) {
            setInstallError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setInstalling(false);
        }
    };
    const rename = async (skill: EcommerceManagedSkill, name: string) => {
        try {
            await renameEcommerceSkill(skill.id, name);
            await refresh();
            message.success("技能名称已保存");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        }
    };
    const toggle = async (skill: EcommerceManagedSkill, enabled: boolean) => {
        setSaving(skill.id);
        try {
            const result = await setEcommerceManagedSkillEnabled(skill.id, enabled);
            setSkills((current) => current.map((entry) => (entry.id === skill.id ? { ...entry, enabled: result.enabled } : entry)));
            message.success(`${skill.name}已${result.enabled ? "启用" : "关闭"}`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSaving("");
        }
    };
    return (
        <EcommerceLibraryPanel
            description="按商品、参考方式、提示词与已选风格调用适用的技能方法，并交给已配置的图片模型执行。"
            actions={
                <Space wrap>
                    <Button
                        type="primary"
                        icon={<Download size={14} />}
                        onClick={() => {
                            setInstallError("");
                            setInstallOpen(true);
                        }}
                    >
                        安装电商 Skills
                    </Button>
                    <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void refresh()}>
                        刷新
                    </Button>
                </Space>
            }
        >
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Space wrap>
                <Tag icon={<Sparkles size={12} />}>已安装 {skills.length}</Tag>
                <Typography.Text>已启用 {skills.filter((skill) => skill.enabled).length}</Typography.Text>
                <Typography.Text type="secondary">
                    GitHub 适配 {skills.filter((skill) => skill.origin === "github-adapted").length} · 原创 {skills.filter((skill) => skill.origin === "first-party").length}
                </Typography.Text>
            </Space>
            <Alert type="info" showIcon message="安装后默认启用，Agent 从全部已启用 Skills 中分析匹配，每轮按需调用最多 8 项。GitHub 安装自动跟随来源分支更新；已提交任务保留当时的技能快照。" />
            <Space wrap>
                <Input.Search allowClear placeholder="搜索技能、用途或来源" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 300 }} />
                <Select
                    aria-label="技能来源"
                    value={origin}
                    onChange={setOrigin}
                    style={{ width: 150 }}
                    options={[
                        { value: "", label: "全部来源" },
                        { value: "user-installed", label: "用户安装" },
                        { value: "github-adapted", label: "GitHub 适配" },
                        { value: "first-party", label: "原创" },
                    ]}
                />
                <Select value={group} onChange={setGroup} style={{ width: 160 }} options={[{ value: "", label: "全部用途" }, ...[...new Set(skills.map((skill) => skill.group))].map((value) => ({ value, label: value }))]} />
                <Select
                    value={status}
                    onChange={setStatus}
                    style={{ width: 140 }}
                    options={[
                        { value: "", label: "全部状态" },
                        { value: "enabled", label: "已启用" },
                        { value: "disabled", label: "已关闭" },
                    ]}
                />
            </Space>
            <Table<EcommerceManagedSkill>
                rowKey="id"
                size="small"
                loading={loading}
                dataSource={filtered}
                rowClassName={(skill) => (skill.origin === "user-installed" ? "ecommerce-skill-installed" : "")}
                pagination={{ pageSize: 15, showSizeChanger: false }}
                expandable={{ expandedRowRender: (skill) => <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>{skill.instructions}</Typography.Paragraph> }}
                columns={[
                    {
                        title: "技能与用途",
                        key: "skill",
                        render: (_, skill) => (
                            <div>
                                <Typography.Text strong editable={skill.origin === "user-installed" ? { onChange: (name) => void rename(skill, name), tooltip: "编辑技能名称", maxLength: 80 } : false}>
                                    {skill.name}
                                </Typography.Text>
                                {skill.origin === "user-installed" ? (
                                    <Tag color="cyan" icon={<Sparkles size={12} />}>
                                        用户安装
                                    </Tag>
                                ) : null}
                                <br />
                                <Typography.Text type="secondary">{skill.description}</Typography.Text>
                                <br />
                                <Space wrap size={4}>
                                    <Tag>{skill.origin === "user-installed" ? "电商自装技能" : skill.group}</Tag>
                                    {skill.types.map((type) => (
                                        <Tag key={type}>{type}</Tag>
                                    ))}
                                </Space>
                            </div>
                        ),
                    },
                    {
                        title: "来源与版本",
                        key: "source",
                        width: 230,
                        render: (_, skill) => (
                            <div>
                                {skill.origin === "user-installed" ? (
                                    <>
                                        <Typography.Text>{skill.autoUpdate ? "GitHub · 自动更新" : "本地文件 · 重新上传更新"}</Typography.Text>
                                        <br />
                                        {skill.sourceUrl ? (
                                            <a href={skill.sourceUrl} target="_blank" rel="noreferrer">
                                                查看上游
                                            </a>
                                        ) : null}
                                        <Typography.Text type="secondary">{skill.lastCheckedAt ? ` 最近检查：${skill.lastCheckedAt}` : ""}</Typography.Text>
                                        {skill.syncError ? <Alert type="warning" title="更新失败，继续使用上次版本" description={skill.syncError} /> : null}
                                    </>
                                ) : skill.origin === "github-adapted" ? (
                                    <a href={skill.sourceUrl} target="_blank" rel="noreferrer">
                                        GitHub · 固定版本
                                    </a>
                                ) : (
                                    <Typography.Text>魅夜原创</Typography.Text>
                                )}
                                <br />
                                <Typography.Text type="secondary">
                                    {skill.license ? `${skill.license} · ` : ""}v{skill.version}
                                </Typography.Text>
                                <br />
                                <Typography.Text code>{skill.sourceCommit.slice(0, 12)}</Typography.Text>
                            </div>
                        ),
                    },
                    {
                        title: "调用状态",
                        key: "enabled",
                        width: 120,
                        render: (_, skill) => (
                            <Switch checked={skill.enabled} checkedChildren="启用" unCheckedChildren="关闭" loading={saving === skill.id} disabled={loading || Boolean(saving && saving !== skill.id)} onChange={(enabled) => void toggle(skill, enabled)} />
                        ),
                    },
                ]}
            />
            <AppModal title="安装电商 Skills" open={installOpen} onCancel={() => !installing && setInstallOpen(false)} closable={!installing} maskClosable={!installing} footer={null}>
                <Space orientation="vertical" size={16} style={{ width: "100%" }}>
                    <Alert
                        type="info"
                        showIcon
                        title="支持超过 500MB 的技能包，最大 1GB"
                        description="安装后默认启用并显示发光标识。ZIP 可含素材附件，SKILL.md 与引用的策划文本合计不超过 32KB。本地文件需重新上传更新。后台安装的技能对本站电商 Agent 生效。"
                    />
                    {installError ? <Alert type="error" showIcon title={installError} /> : null}
                    <Upload
                        accept=".zip,.md,.markdown"
                        showUploadList={false}
                        disabled={installing}
                        beforeUpload={(file) => {
                            void install(file);
                            return false;
                        }}
                    >
                        <Button loading={installing}>选择 ZIP / Markdown 安装</Button>
                    </Upload>
                    {installing ? progress < 0 ? <Typography.Text role="status">正在读取 GitHub 并安装技能…</Typography.Text> : <Progress percent={progress} status="active" format={(value) => (value === 100 ? "解析中" : `${value}%`)} /> : null}
                    <label htmlFor="ecommerce-skill-url">GitHub 仓库或技能目录地址</label>
                    <Input id="ecommerce-skill-url" value={url} onChange={(event) => setUrl(event.target.value)} disabled={installing} placeholder="https://github.com/owner/repo" />
                    <label htmlFor="ecommerce-skill-subdir">技能子目录（合集仓库必填）</label>
                    <Input id="ecommerce-skill-subdir" value={subdir} onChange={(event) => setSubdir(event.target.value)} disabled={installing} placeholder="skills/product-photography" />
                    <Typography.Text type="secondary">GitHub 来源每 6 小时检查更新，跟随安装地址的分支。请使用分支地址，固定提交或标签不会持续产生新版本。更新保留自定义名称和启用状态。</Typography.Text>
                    <Button type="primary" loading={installing} disabled={!url.trim()} onClick={() => void install()}>
                        从 GitHub 安装并自动更新
                    </Button>
                </Space>
            </AppModal>
        </EcommerceLibraryPanel>
    );
}
