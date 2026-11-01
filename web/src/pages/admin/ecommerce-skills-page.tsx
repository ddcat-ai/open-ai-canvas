import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Input, Select, Space, Switch, Table, Tag, Typography } from "antd";
import { RefreshCw, Sparkles } from "lucide-react";
import { AdminPageFrame } from "./components/admin-shell";
import { listEcommerceManagedSkills, setEcommerceManagedSkillEnabled, type EcommerceManagedSkill } from "@/services/api/ecommerce-skills";

export default function EcommerceSkillsPage() {
    const { message } = App.useApp();
    const [skills, setSkills] = useState<EcommerceManagedSkill[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState("");
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [group, setGroup] = useState("");
    const [status, setStatus] = useState("");
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const result = await listEcommerceManagedSkills();
            setSkills(result.skills);
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
                    (!group || skill.group === group) && (!status || skill.enabled === (status === "enabled")) && [skill.name, skill.description, skill.group, skill.sourceUrl, ...skill.terms].join(" ").toLowerCase().includes(search.trim().toLowerCase()),
            ),
        [skills, group, status, search],
    );
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
        <AdminPageFrame
            title="电商 Skills"
            description="按商品、参考方式、提示词与已选风格调用适用的技能方法，并交给已配置的图片模型执行。"
            actions={
                <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => void refresh()}>
                    刷新
                </Button>
            }
            scroll
        >
            {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
            <Space wrap style={{ marginBottom: 16 }}>
                <Tag icon={<Sparkles size={12} />}>已安装 {skills.length}</Tag>
                <Typography.Text>已启用 {skills.filter((skill) => skill.enabled).length}</Typography.Text>
                <Typography.Text type="secondary">
                    GitHub 适配 {skills.filter((skill) => skill.origin === "github-adapted").length} · 原创 {skills.filter((skill) => skill.origin === "first-party").length}
                </Typography.Text>
            </Space>
            <Alert type="info" showIcon message="新技能默认启用，Agent 每轮按需选择最多 8 项；关闭后不再进入新的策划和关联知识检索。已提交任务保留当时的技能快照。" style={{ marginBottom: 20 }} />
            <Space wrap style={{ marginBottom: 16 }}>
                <Input.Search allowClear placeholder="搜索技能、用途或来源" value={search} onChange={(event) => setSearch(event.target.value)} style={{ width: 300 }} />
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
                pagination={{ pageSize: 15, showSizeChanger: false }}
                expandable={{ expandedRowRender: (skill) => <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>{skill.instructions}</Typography.Paragraph> }}
                columns={[
                    {
                        title: "技能与用途",
                        key: "skill",
                        render: (_, skill) => (
                            <div>
                                <Typography.Text strong>{skill.name}</Typography.Text>
                                <br />
                                <Typography.Text type="secondary">{skill.description}</Typography.Text>
                                <br />
                                <Space wrap size={4}>
                                    <Tag>{skill.group}</Tag>
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
                                {skill.origin === "github-adapted" ? (
                                    <a href={skill.sourceUrl} target="_blank" rel="noreferrer">
                                        GitHub · 固定版本
                                    </a>
                                ) : (
                                    <Typography.Text>魅夜原创</Typography.Text>
                                )}
                                <br />
                                <Typography.Text type="secondary">
                                    {skill.license} · v{skill.version}
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
        </AdminPageFrame>
    );
}
