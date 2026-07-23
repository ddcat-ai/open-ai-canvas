import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Modal, Select, Table, Tag } from "antd";
import { FolderKanban, Plus } from "lucide-react";
import { useNavigate } from "react-router";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { createProject, listProjects, type ProjectSummary } from "@/services/api/projects";

type ProjectForm = { name: string; aspectRatio: string; sourceType: string };

export default function ProjectsPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const query = useQuery({ queryKey: ["projects"], queryFn: listProjects });
    const mutation = useMutation({
        mutationFn: createProject,
        onSuccess: ({ project }) => {
            setOpen(false);
            void queryClient.invalidateQueries({ queryKey: ["projects"] });
            navigate(`/projects/${project.id}`);
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "项目创建失败"),
    });
    const rows = useMemo(() => query.data?.projects || [], [query.data]);

    return (
        <WorkspacePage>
            <PageHeader
                title="项目中心"
                description="从项目视角管理章节、画布和制作进度；不属于项目的创作仍可在游离画布中继续。"
                actions={<Button type="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>创建短剧项目</Button>}
            />
            {query.isError ? <Alert className="mt-4" type="error" showIcon message={query.error instanceof Error ? query.error.message : "项目列表加载失败"} /> : null}
            <div className="mt-2 overflow-hidden rounded-lg border border-border bg-background">
                <Table<ProjectSummary>
                    rowKey={(row) => row.project.id}
                    loading={query.isLoading}
                    dataSource={rows}
                    pagination={false}
                    locale={{ emptyText: "还没有项目，先创建一个短剧项目" }}
                    onRow={(row) => ({ onClick: () => navigate(`/projects/${row.project.id}`), className: "cursor-pointer" })}
                    columns={[
                        { title: "项目名称", key: "name", render: (_, row) => <div className="flex items-center gap-2"><FolderKanban className="size-4 text-foreground/45" /><span className="font-medium">{row.project.name}</span></div> },
                        { title: "章节进度", key: "units", render: (_, row) => `${row.completedUnitCount}/${row.unitCount || 0}` },
                        { title: "画布", dataIndex: "canvasCount", key: "canvasCount", render: (value: number) => `${value} 个` },
                        { title: "类型", key: "type", render: (_, row) => <Tag>{row.project.type === "short-drama" ? "短剧" : row.project.type}</Tag> },
                        { title: "最近更新", key: "updatedAt", render: (_, row) => formatTime(row.project.updatedAt) },
                    ]}
                />
            </div>
            <Modal title="创建短剧项目" open={open} footer={null} destroyOnClose onCancel={() => setOpen(false)}>
                <Form<ProjectForm> layout="vertical" className="mt-4" initialValues={{ aspectRatio: "9:16", sourceType: "blank" }} onFinish={(values) => mutation.mutate({ ...values, type: "short-drama" })}>
                    <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请输入项目名称" }]}><Input autoFocus placeholder="例如：长安夜行" /></Form.Item>
                    <div className="grid grid-cols-2 gap-3">
                        <Form.Item name="aspectRatio" label="默认画幅"><Select options={[{ label: "9:16 竖屏", value: "9:16" }, { label: "16:9 横屏", value: "16:9" }, { label: "1:1 方形", value: "1:1" }]} /></Form.Item>
                        <Form.Item name="sourceType" label="内容来源"><Select options={[{ label: "空白开始", value: "blank" }, { label: "导入小说", value: "novel" }, { label: "粘贴文本", value: "text" }]} /></Form.Item>
                    </div>
                    <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit" loading={mutation.isPending}>创建项目</Button></div>
                </Form>
            </Modal>
        </WorkspacePage>
    );
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
