import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Input, Select, Space, Table, Tabs, Tag, Typography } from "antd";
import { Database, RefreshCw, Search } from "lucide-react";
import { AdminStatTile } from "./components/admin-ui";
import { EcommerceLibraryPanel } from "./ecommerce-library-panel";
import { commerceKnowledgeDomainRows } from "./knowledge-domain-coverage";
import {
    getCommerceKnowledgeStats,
    listCommerceKnowledgeEntries,
    reviewCommerceKnowledgeEntry,
    setCommerceKnowledgeSourceEnabled,
    syncCommerceKnowledge,
    type CommerceKnowledgeEntry,
    type CommerceKnowledgePage,
    type CommerceKnowledgeStats,
} from "@/services/api/ecommerce-knowledge";

export default function EcommerceKnowledgePage() {
    const { message } = App.useApp();
    const [stats, setStats] = useState<CommerceKnowledgeStats>();
    const [data, setData] = useState<CommerceKnowledgePage>();
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState("approved");
    const [keyword, setKeyword] = useState("");
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [error, setError] = useState("");
    const [sourceSearch, setSourceSearch] = useState("");
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const [nextStats, nextPage] = await Promise.all([getCommerceKnowledgeStats(), listCommerceKnowledgeEntries(page, 20, status, keyword)]);
            setStats(nextStats);
            setData(nextPage);
            setError("");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setLoading(false);
        }
    }, [page, status, keyword]);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const visibleSources = (stats?.sources || []).filter((source) => [source.name, source.repository, source.license, source.status].some((value) => value.toLowerCase().includes(sourceSearch.trim().toLowerCase())));

    const runSync = async () => {
        setSyncing(true);
        try {
            const result = await syncCommerceKnowledge();
            message.success(`本次新增 ${result.imported} 条，重复 ${result.duplicates} 条，失败 ${result.failed.length} 个文件`);
            await refresh();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        } finally {
            setSyncing(false);
        }
    };
    const review = async (entry: CommerceKnowledgeEntry, next: "approved" | "rejected" | "pending") => {
        try {
            await reviewCommerceKnowledgeEntry(entry.id, next);
            await refresh();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        }
    };
    const toggleSource = async (id: string, enabled: boolean) => {
        try {
            await setCommerceKnowledgeSourceEnabled(id, enabled);
            await refresh();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : String(cause));
        }
    };
    return (
        <EcommerceLibraryPanel
            description="电商 Agent 策划时检索的视觉规则。来源按固定版本导入，社区文档默认待审核；商品分类来自 Shopify 官方 Release。"
            actions={
                <Space>
                    <Button icon={<RefreshCw size={14} />} onClick={() => void refresh()} loading={loading}>
                        刷新
                    </Button>
                    <Button type="primary" icon={<Database size={14} />} onClick={() => void runSync()} loading={syncing}>
                        同步固定来源
                    </Button>
                </Space>
            }
        >
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <div className="eal-stats" aria-label="知识库概况">
                <AdminStatTile label="知识条目" value={stats?.entryCount ?? "—"} detail={`来源 ${stats?.sourceCount ?? "—"} 个`} />
                <AdminStatTile label="有效" value={stats?.approvedCount ?? "—"} detail="已审核且未过期" />
                <AdminStatTile label="待审核" value={stats?.pendingCount ?? "—"} detail="社区来源默认待审核" />
                <AdminStatTile label="已拒绝 / 已过期" value={stats ? `${stats.rejectedCount} / ${stats.expiredCount}` : "—"} detail={`最近同步去重 ${stats?.lastSyncDuplicateCount ?? "—"} 条`} />
            </div>
            {stats ? (
                <div className="eal-stack">
                    <Typography.Paragraph type="secondary">
                        已覆盖分类：
                        {Object.entries(stats.categoryCoverage || {})
                            .map(([category, count]) => `${category} ${count}`)
                            .join(" · ") || "暂无"}
                        。分类数量是知识记录数，不能代表各类目视觉规则已完整覆盖。
                    </Typography.Paragraph>
                    <section aria-label="知识域覆盖">
                        <Typography.Title level={5} style={{ marginTop: 0 }}>
                            知识域
                        </Typography.Title>
                        <Typography.Paragraph type="secondary">下方数量只统计已审核且未过期的知识条目；数量不代表该知识域已完整覆盖。</Typography.Paragraph>
                        <Space wrap size={[8, 8]}>
                            {commerceKnowledgeDomainRows(stats.domainCoverage).map(({ id, label, count }) => (
                                <Tag key={id} color={count > 0 ? "blue" : "default"}>
                                    <strong>{id}</strong> {label} · {count > 0 ? `${count} 条有效知识` : "暂无有效知识"}
                                </Tag>
                            ))}
                        </Space>
                    </section>
                </div>
            ) : null}
            <Tabs
                items={[
                    {
                        key: "sources",
                        label: `知识源 · ${stats?.sourceCount ?? 0}`,
                        children: (
                            <div className="eal-stack">
                                <Input allowClear prefix={<Search size={14} />} value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="搜索知识源名称、仓库、许可或状态" style={{ maxWidth: 430, marginBottom: 14 }} />
                                <Table
                                    rowKey="id"
                                    size="small"
                                    loading={loading}
                                    dataSource={visibleSources}
                                    pagination={false}

                                    columns={[
                                        {
                                            title: "知识源",
                                            dataIndex: "name",
                                            render: (_: unknown, source) =>
                                                source.repository && source.commit ? (
                                                    <a href={`https://github.com/${source.repository}/tree/${source.commit}`} target="_blank" rel="noreferrer">
                                                        {source.name}
                                                    </a>
                                                ) : (
                                                    <span>{source.name}</span>
                                                ),
                                        },
                                        { title: "固定版本", dataIndex: "commit", render: (value: string) => value.slice(0, 12) },
                                        { title: "许可", dataIndex: "license" },
                                        { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "ready" ? "green" : value === "partial" ? "gold" : "default"}>{value}</Tag> },
                                        { title: "最后同步", dataIndex: "lastSyncedAt", render: (value?: string) => (value ? new Date(value).toLocaleString() : "未同步") },
                                        {
                                            title: "操作",
                                            key: "actions",
                                            render: (_: unknown, source) => (
                                                <Button size="small" onClick={() => void toggleSource(source.id, source.status === "disabled")}>
                                                    {source.status === "disabled" ? "启用" : "停用"}
                                                </Button>
                                            ),
                                        },
                                    ]}
                                    expandable={{ expandedRowRender: (source) => <Typography.Paragraph style={{ whiteSpace: "pre-wrap", maxWidth: 760 }}>{source.licenseText || source.errorMessage || "暂无许可证文本"}</Typography.Paragraph> }}
                                />
                            </div>
                        ),
                    },
                    {
                        key: "entries",
                        label: `知识条目 · ${stats?.entryCount ?? 0}`,
                        children: (
                            <div className="eal-stack">
                                <Space wrap>
                                    <Input.Search
                                        placeholder="搜索知识标题"
                                        allowClear
                                        onSearch={(value) => {
                                            setPage(1);
                                            setKeyword(value);
                                        }}
                                    />
                                    <Select
                                        value={status}
                                        style={{ width: 130 }}
                                        onChange={(value) => {
                                            setPage(1);
                                            setStatus(value);
                                        }}
                                        options={[
                                            { value: "pending", label: "待审核" },
                                            { value: "approved", label: "有效" },
                                            { value: "rejected", label: "已拒绝" },
                                            { value: "", label: "全部" },
                                        ]}
                                    />
                                </Space>
                                {!loading && data?.total === 0 ? <Alert type="info" showIcon message="当前筛选没有匹配条目。可切换为“有效”或“全部”，或清空搜索词查看已有知识。" /> : null}
                                <Table
                                    rowKey="id"
                                    size="small"
                                    loading={loading}
                                    dataSource={data?.entries || []}
                                    pagination={{ current: page, pageSize: 20, total: data?.total || 0, onChange: setPage }}
                                    columns={[
                                        {
                                            title: "知识",
                                            dataIndex: "title",
                                            render: (_: unknown, item) => (
                                                <div>
                                                    <strong>{item.title}</strong>
                                                    <br />
                                                    <Typography.Text type="secondary">
                                                        {item.knowledgeType} · {item.category}
                                                    </Typography.Text>
                                                </div>
                                            ),
                                        },
                                        {
                                            title: "来源",
                                            dataIndex: "sourceUrl",
                                            render: (value: string, item) => (
                                                <a href={value} target="_blank" rel="noreferrer">
                                                    {item.sourceId} · {item.license}
                                                </a>
                                            ),
                                        },
                                        { title: "状态", dataIndex: "reviewStatus", render: (value: string) => <Tag color={value === "approved" ? "green" : value === "pending" ? "gold" : "default"}>{value}</Tag> },
                                        {
                                            title: "审核",
                                            key: "actions",
                                            render: (_: unknown, item) => (
                                                <Space>
                                                    <Button size="small" onClick={() => void review(item, "approved")}>
                                                        通过
                                                    </Button>
                                                    <Button size="small" danger onClick={() => void review(item, "rejected")}>
                                                        拒绝
                                                    </Button>
                                                </Space>
                                            ),
                                        },
                                    ]}
                                    expandable={{ expandedRowRender: (item) => <Typography.Paragraph style={{ whiteSpace: "pre-wrap", maxWidth: 760 }}>{item.contentJson}</Typography.Paragraph> }}
                                />
                            </div>
                        ),
                    },
                ]}
            />
        </EcommerceLibraryPanel>
    );
}
