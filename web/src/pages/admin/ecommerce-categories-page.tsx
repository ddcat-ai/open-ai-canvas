import { useEffect, useState } from "react";
import { Alert, Breadcrumb, Button, Input, Space, Table, Tag, Typography } from "antd";
import { FolderTree, RefreshCw } from "lucide-react";
import { EcommerceLibraryPanel } from "./ecommerce-library-panel";
import { getIndustryCategories, type IndustryCategoryPage, type IndustryCategoryMatch } from "@/services/api/ecommerce-categories";

export default function EcommerceCategoriesPage() {
    const [data, setData] = useState<IndustryCategoryPage>();
    const [parent, setParent] = useState("");
    const [query, setQuery] = useState("");
    const [searchText, setSearchText] = useState("");
    const [page, setPage] = useState(1);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    useEffect(() => {
        let active = true;
        setLoading(true);
        void getIndustryCategories(parent, query, page)
            .then((next) => {
                if (active) {
                    setData(next);
                    setError("");
                }
            })
            .catch((cause: unknown) => {
                if (active) setError(cause instanceof Error ? cause.message : String(cause));
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [parent, query, page, refresh]);
    const open = (id: string) => {
        setParent(id);
        setQuery("");
        setSearchText("");
        setPage(1);
    };
    const source = data?.coverage.source;
    const lineage = (data?.lineage ?? []).slice().reverse();
    return (
        <EcommerceLibraryPanel
            description="按完整中英文分类路径定位商品，再选择最近的适用方法与行业 Skills。"
            actions={
                <Button icon={<RefreshCw size={14} />} loading={loading} onClick={() => setRefresh((value) => value + 1)}>
                    刷新
                </Button>
            }
        >
            {error ? <Alert type="error" showIcon message={error} /> : null}
            <Space wrap size={16}>
                <Typography.Text>
                    <strong>{source?.roots ?? "—"}</strong> 个顶级行业
                </Typography.Text>
                <Typography.Text>
                    <strong>{source?.nodes.toLocaleString() ?? "—"}</strong> 个分类节点
                </Typography.Text>
                <Typography.Text>
                    <strong>{source?.leaves.toLocaleString() ?? "—"}</strong> 个叶级子品类
                </Typography.Text>
                <Typography.Text>
                    知识索引 <strong>{data?.coverage.indexedNodes.toLocaleString() ?? "—"}</strong> 条
                </Typography.Text>
                {source ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                        Shopify {source.version} · MIT
                    </a>
                ) : null}
            </Space>
            <Alert
                type="info"
                showIcon
                message="分类目录与专属创作方法分别统计。子品类优先使用最近上级的方法；继承覆盖不代表每个叶级品类都已单独生成验收。"
                description={data ? `${data.coverage.industryMethods} 套行业方法、${data.coverage.specializedAncestors} 个细分方法祖先；开关在“电商 Skills”中管理。` : undefined}
            />
            <Space wrap>
                <Input.Search
                    placeholder="搜索中文、英文品类或分类 ID"
                    allowClear
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    onSearch={(value) => {
                        setQuery(value);
                        setParent("");
                        setPage(1);
                    }}
                    style={{ width: 360 }}
                />
                <Button icon={<FolderTree size={14} />} onClick={() => open("")}>
                    全部行业
                </Button>
            </Space>
            <Breadcrumb
                items={[
                    {
                        title: (
                            <Button type="link" size="small" onClick={() => open("")}>
                                全部行业
                            </Button>
                        ),
                    },
                    ...lineage.map((node) => ({
                        title: (
                            <Button type="link" size="small" onClick={() => open(node.id)}>
                                {node.name}
                            </Button>
                        ),
                    })),
                ]}
            />
            <Table<IndustryCategoryMatch>
                rowKey={(entry) => entry.node.id}
                size="small"
                loading={loading}
                dataSource={data?.nodes ?? []}
                pagination={{ current: page, pageSize: 40, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
                expandable={{
                    expandedRowRender: ({ node, playbook }) => (
                        <Space direction="vertical">
                            <Typography.Text>分类 ID：{node.id}</Typography.Text>
                            <Typography.Text>场景：{playbook.scene}</Typography.Text>
                            <Typography.Text>观察重点：{playbook.focus}</Typography.Text>
                            <Typography.Text>字体：{playbook.typography}</Typography.Text>
                            <Typography.Text>排版：{playbook.layout}</Typography.Text>
                            <Typography.Text>叙事：{playbook.story}</Typography.Text>
                        </Space>
                    ),
                }}
                columns={[
                    {
                        title: "行业 / 品类 / 子品类",
                        key: "node",
                        render: (_, { node }) => (
                            <div>
                                {node.children > 0 ? (
                                    <Button type="link" size="small" onClick={() => open(node.id)}>
                                        {node.name}
                                    </Button>
                                ) : (
                                    <Typography.Text strong>{node.name}</Typography.Text>
                                )}
                                <br />
                                <Typography.Text type="secondary">{node.path}</Typography.Text>
                                <br />
                                <Typography.Text type="secondary">{node.pathEn}</Typography.Text>
                            </div>
                        ),
                    },
                    {
                        title: "下级分类",
                        width: 140,
                        key: "children",
                        render: (_, { node }) => (
                            <span>
                                {node.children} 个直接下级
                                <br />
                                <Typography.Text type="secondary">共 {node.descendants} 个后代</Typography.Text>
                            </span>
                        ),
                    },
                    {
                        title: "创作方法",
                        width: 210,
                        key: "scope",
                        render: (_, entry) => (
                            <div>
                                <Tag color={entry.methodScope === "specific" ? "blue" : "default"}>{entry.methodScope === "specific" ? "本级方法" : "继承上级方法"}</Tag>
                                <br />
                                <Typography.Text type="secondary">方法祖先：{entry.methodAncestorId}</Typography.Text>
                            </div>
                        ),
                    },
                ]}
            />
        </EcommerceLibraryPanel>
    );
}
