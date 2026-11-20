import { App, Button, Form, Image, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AdminPageFrame } from "./components/admin-shell";
import { fetchAdminOfficialAssetRecommendation, fetchAdminOfficialAssetRecommendations, reviewOfficialAssetRecommendation, type OfficialAssetRecommendation, type OfficialAssetRecommendationStatus } from "@/services/api/official-asset-recommendations";
import { ASSET_CATEGORY_OPTIONS, normalizeAssetCategory } from "@/lib/asset-category";
import { adminResourceFileUrl } from "@/services/api/admin-storage";

const statusLabel: Record<OfficialAssetRecommendationStatus, string> = { pending: "待审核", approved: "已通过", rejected: "已拒绝", changes_requested: "需补充" };
const statusColor: Record<OfficialAssetRecommendationStatus, string> = { pending: "gold", approved: "green", rejected: "red", changes_requested: "blue" };

type PublishFormValues = {
    title: string;
    description?: string;
    category: string;
    tagsText?: string;
    sourceName?: string;
    sourceUrl?: string;
    licenseNote?: string;
    usageNote?: string;
};

function parseTags(value: string | undefined) {
    return Array.from(
        new Set(
            (value || "")
                .split(/[,，\n]/)
                .map((tag) => tag.trim())
                .filter(Boolean),
        ),
    );
}

function recommendationDescription(row: OfficialAssetRecommendation) {
    const role = row.characterSnapshot?.definition?.role;
    return (row.assetDescription?.trim() || (typeof role === "string" ? role.trim() : "")).slice(0, 500);
}

const characterFields: Array<[string, string]> = [
    ["aliases", "别名"],
    ["role", "剧情身份"],
    ["appearance", "外貌特征"],
    ["physique", "体型姿态"],
    ["clothing", "服装造型"],
    ["personality", "性格气质"],
    ["props", "标志道具"],
    ["consistencyPrompt", "一致性要求"],
    ["multiViewPrompt", "多视图要求"],
    ["voiceLanguage", "语言口音"],
    ["voiceAge", "声音年龄感"],
    ["voiceTimbre", "音色气质"],
];

function CharacterDefinition({ definition }: { definition: Record<string, unknown> }) {
    const knownKeys = new Set(characterFields.map(([key]) => key));
    const fields = [
        ...characterFields,
        ...Object.keys(definition)
            .filter((key) => !knownKeys.has(key))
            .map((key): [string, string] => [key, key]),
    ];
    const rows = fields.flatMap(([key, label]) => {
        const value = definition[key];
        if (value == null || value === "") return [];
        const text = typeof value === "string" ? value.trim() : Array.isArray(value) && value.every((item) => typeof item === "string") ? value.filter(Boolean).join("、") : JSON.stringify(value, null, 2);
        return text ? [{ key, label, text }] : [];
    });
    return rows.length ? (
        <dl className="divide-y divide-border/60 border-y border-border/60">
            {rows.map(({ key, label, text }) => (
                <div key={key} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 py-3 text-sm leading-6">
                    <dt className="text-foreground/45">{label}</dt>
                    <dd className="whitespace-pre-wrap break-words text-foreground/85">{text}</dd>
                </div>
            ))}
        </dl>
    ) : (
        <Typography.Text type="secondary">没有可展示的角色设定</Typography.Text>
    );
}

function uniqueCharacterImages(images: Array<{ resourceId?: string; role?: string }>) {
    const seen = new Set<string>();
    return images.filter((image) => {
        if (!image.resourceId || seen.has(image.resourceId)) return false;
        seen.add(image.resourceId);
        return true;
    });
}

function isImageRecommendation(row: OfficialAssetRecommendation) {
    return row.assetKind?.toLowerCase() === "image" && Boolean(row.assetResourceId);
}

function isVideoRecommendation(row: OfficialAssetRecommendation) {
    return row.assetKind?.toLowerCase() === "video" && Boolean(row.assetResourceId);
}

function isEntityKind(row: OfficialAssetRecommendation) {
    const kind = row.assetKind?.toLowerCase();
    return kind === "entity" || kind === "character" || kind === "role";
}

function isEntityRecommendation(row: OfficialAssetRecommendation) {
    return isEntityKind(row) && Boolean(row.assetResourceId);
}

function recommendationKindLabel(row: OfficialAssetRecommendation) {
    const kind = row.assetKind?.toLowerCase();
    if (kind === "video") return "视频";
    if (kind === "audio") return "音频";
    if (kind === "entity" || kind === "character" || kind === "role") return "角色卡";
    if (kind === "image") return "图片";
    return "素材";
}

function EntityCardPreview({ large = false }: { large?: boolean }) {
    return (
        <div className={`flex ${large ? "min-h-24 w-full" : "h-16 w-16"} flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted text-muted-foreground`} aria-label="角色卡预览">
            <span className={large ? "text-2xl" : "text-lg"}>✦</span>
            <span className={large ? "mt-1 text-sm" : "text-[10px]"}>角色卡</span>
        </div>
    );
}

export default function OfficialAssetRecommendationsPage() {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [status, setStatus] = useState<OfficialAssetRecommendationStatus | "all">("pending");
    const [reviewing, setReviewing] = useState<{ row: OfficialAssetRecommendation; action: "reject" | "changes_requested" } | null>(null);
    const [note, setNote] = useState("");
    const [publishTarget, setPublishTarget] = useState<OfficialAssetRecommendation | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [publishForm] = Form.useForm<PublishFormValues>();
    const query = useQuery({ queryKey: ["admin-official-asset-recommendations", status], queryFn: () => fetchAdminOfficialAssetRecommendations({ status, page: 1, pageSize: 50 }) });
    const rows = query.data?.items || [];
    const review = async (row: OfficialAssetRecommendation, action: "approve" | "reject" | "changes_requested", reviewerNote = "") => {
        await reviewOfficialAssetRecommendation(row.id, { action, reviewerNote: reviewerNote.trim() || undefined });
        message.success(action === "approve" ? "已发布到官方素材库" : action === "reject" ? "已拒绝推荐" : "已退回补充");
        await client.invalidateQueries({ queryKey: ["admin-official-asset-recommendations"] });
    };
    const openPublish = async (row: OfficialAssetRecommendation) => {
        setDetailLoading(true);
        try {
            const detail = await fetchAdminOfficialAssetRecommendation(row.id);
            setPublishTarget(detail);
            row = detail;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法读取推荐详情");
            return;
        } finally {
            setDetailLoading(false);
        }
        publishForm.setFieldsValue({
            title: row.assetTitle || row.title,
            description: recommendationDescription(row),
            category: normalizeAssetCategory(row.assetCategory, "material"),
            tagsText: (row.assetTags || []).join("，"),
            sourceName: "用户推荐",
            sourceUrl: "",
            licenseNote: row.consentVersion === "commercial-use-v1" && row.consentAt ? "推荐人已授权出彩及用户使用，包括商业用途；版权归原权利人所有。" : "",
            usageNote: "",
        });
    };
    const submitPublish = async (values: PublishFormValues) => {
        if (!publishTarget) return;
        await reviewOfficialAssetRecommendation(publishTarget.id, {
            action: "approve",
            title: values.title.trim(),
            description: values.description?.trim(),
            category: values.category,
            tags: parseTags(values.tagsText),
            sourceName: values.sourceName?.trim(),
            sourceUrl: values.sourceUrl?.trim(),
            licenseNote: values.licenseNote?.trim(),
            usageNote: values.usageNote?.trim(),
        });
        message.success("已发布到官方素材库");
        setPublishTarget(null);
        await client.invalidateQueries({ queryKey: ["admin-official-asset-recommendations"] });
    };
    return (
        <AdminPageFrame title="素材推荐审核" description="审核用户推荐的图片、视频、音频和角色卡；通过后复用原资源，不复制文件。">
            <div className="mb-4 flex items-center justify-between gap-3">
                <Typography.Text type="secondary">待审核推荐会保留原素材，审核结果可追溯。</Typography.Text>
                <Select
                    value={status}
                    onChange={setStatus}
                    options={[
                        { value: "pending", label: "待审核" },
                        { value: "changes_requested", label: "需补充" },
                        { value: "approved", label: "已通过" },
                        { value: "rejected", label: "已拒绝" },
                        { value: "all", label: "全部" },
                    ]}
                />
            </div>
            <Table
                rowKey="id"
                loading={query.isLoading}
                dataSource={rows}
                pagination={false}
                columns={[
                    {
                        title: "素材",
                        render: (_: unknown, row: OfficialAssetRecommendation) => (
                            <Space align="start">
                                {row.assetPreviewUrl && isImageRecommendation(row) ? (
                                    <Image width={64} height={64} preview src={adminResourceFileUrl(row.assetResourceId || "")} style={{ objectFit: "cover", borderRadius: 8 }} />
                                ) : row.assetPreviewUrl && isVideoRecommendation(row) ? (
                                    <video src={adminResourceFileUrl(row.assetResourceId || "")} preload="metadata" muted playsInline aria-label="视频预览" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />
                                ) : row.assetPreviewUrl && isEntityRecommendation(row) ? (
                                    <Image width={64} height={64} preview src={adminResourceFileUrl(row.assetResourceId || "")} style={{ objectFit: "cover", borderRadius: 8 }} />
                                ) : isEntityKind(row) ? (
                                    <EntityCardPreview />
                                ) : (
                                    <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">{recommendationKindLabel(row)}</div>
                                )}
                                <Space direction="vertical" size={0}>
                                    <Typography.Text strong>{row.assetTitle || row.title}</Typography.Text>
                                    <Typography.Text type="secondary">
                                        {recommendationKindLabel(row)} · {row.assetId}
                                    </Typography.Text>
                                </Space>
                            </Space>
                        ),
                    },
                    { title: "推荐说明", dataIndex: "note", render: (value: string) => value || "—" },
                    { title: "状态", dataIndex: "status", render: (value: OfficialAssetRecommendationStatus) => <Tag color={statusColor[value]}>{statusLabel[value]}</Tag> },
                    { title: "提交时间", dataIndex: "createdAt", render: (value: string) => new Date(value).toLocaleString() },
                    {
                        title: "操作",
                        render: (_: unknown, row: OfficialAssetRecommendation) =>
                            row.status === "pending" || row.status === "changes_requested" ? (
                                <Space>
                                    <Button type="primary" onClick={() => openPublish(row)}>
                                        查看详情
                                    </Button>
                                    <Button
                                        onClick={() => {
                                            setReviewing({ row, action: "changes_requested" });
                                            setNote("");
                                        }}
                                    >
                                        退回补充
                                    </Button>
                                    <Button
                                        danger
                                        onClick={() => {
                                            setReviewing({ row, action: "reject" });
                                            setNote("");
                                        }}
                                    >
                                        拒绝
                                    </Button>
                                </Space>
                            ) : (
                                <Typography.Text type="secondary">已处理</Typography.Text>
                            ),
                    },
                ]}
            />
            <Modal open={Boolean(publishTarget) || detailLoading} title="查看素材推荐详情" footer={null} onCancel={() => setPublishTarget(null)} destroyOnClose confirmLoading={detailLoading}>
                {publishTarget?.assetPreviewUrl && isImageRecommendation(publishTarget) ? (
                    <div className="mb-4 flex justify-center">
                        <Image src={adminResourceFileUrl(publishTarget.assetResourceId || "")} style={{ maxHeight: 240, maxWidth: "100%", objectFit: "contain", borderRadius: 8 }} />
                    </div>
                ) : null}
                {publishTarget && isEntityKind(publishTarget) && publishTarget.characterSnapshot ? (
                    <div className="mb-4">
                        {publishTarget.characterSnapshotSource === "current" ? <Typography.Paragraph type="warning">此历史推荐没有提交快照，以下是原角色卡当前资料，可能与提交时不同。</Typography.Paragraph> : null}
                        {publishTarget.characterSnapshot.version !== undefined ? (
                            <Typography.Paragraph type="secondary">
                                提交版本：v{publishTarget.characterSnapshot.version} · 视觉状态：{publishTarget.characterSnapshot.visualStatus || "—"} · 声音状态：{publishTarget.characterSnapshot.voiceStatus || "—"}
                            </Typography.Paragraph>
                        ) : null}
                        {publishTarget.characterSnapshot.partialReasons?.length ? <Typography.Paragraph type="warning">部分资料：{publishTarget.characterSnapshot.partialReasons.join("；")}</Typography.Paragraph> : null}
                        <Typography.Title level={5}>角色图片</Typography.Title>
                        <Image.PreviewGroup>
                            <div className="flex flex-wrap gap-2">
                                {uniqueCharacterImages(publishTarget.characterSnapshot.images).map((image) => (
                                    <Image key={image.resourceId} width={120} height={120} src={adminResourceFileUrl(image.resourceId || "")} alt={image.role || "角色图片"} style={{ objectFit: "cover", borderRadius: 8 }} />
                                ))}
                            </div>
                        </Image.PreviewGroup>
                        {publishTarget.characterSnapshot.representations?.some((item) => item.failureReason) ? (
                            <Typography.Paragraph type="danger">
                                失败项：
                                {publishTarget.characterSnapshot.representations
                                    .filter((item) => item.failureReason)
                                    .map((item) => item.failureReason)
                                    .join("；")}
                            </Typography.Paragraph>
                        ) : null}
                        <Typography.Title level={5}>角色设定</Typography.Title>
                        <CharacterDefinition definition={publishTarget.characterSnapshot.definition} />
                        {publishTarget.characterSnapshot.voice ? (
                            <>
                                <Typography.Title level={5}>声音资料</Typography.Title>
                                <Typography.Paragraph>
                                    {[publishTarget.characterSnapshot.voice.profile.name, publishTarget.characterSnapshot.voice.profile.language, publishTarget.characterSnapshot.voice.profile.timbre, publishTarget.characterSnapshot.voice.instructions]
                                        .filter(Boolean)
                                        .join(" · ")}
                                </Typography.Paragraph>
                                {publishTarget.characterSnapshot.voice.profile.sampleResourceId ? <audio controls preload="metadata" src={adminResourceFileUrl(publishTarget.characterSnapshot.voice.profile.sampleResourceId)} /> : null}
                            </>
                        ) : (
                            <Typography.Text type="secondary">未绑定声音</Typography.Text>
                        )}
                    </div>
                ) : null}
                {publishTarget && isEntityKind(publishTarget) && !publishTarget.characterSnapshot ? <Typography.Paragraph type="warning">无法读取角色完整资料，请勿发布；请联系推荐人重新提交。</Typography.Paragraph> : null}
                {publishTarget?.assetPreviewUrl && isVideoRecommendation(publishTarget) ? (
                    <div className="mb-4 flex justify-center">
                        <video controls preload="metadata" src={adminResourceFileUrl(publishTarget.assetResourceId || "")} style={{ maxHeight: 320, maxWidth: "100%", borderRadius: 8 }} aria-label="审核视频预览" />
                    </div>
                ) : null}
                {publishTarget && !publishTarget.assetPreviewUrl && isEntityKind(publishTarget) ? (
                    <div className="mb-4 flex justify-center">
                        <EntityCardPreview large />
                    </div>
                ) : null}
                {publishTarget ? (
                    publishTarget.consentVersion === "commercial-use-v1" && publishTarget.consentAt ? (
                        <Typography.Paragraph>授权已确认（含商业用途） · {new Date(publishTarget.consentAt).toLocaleString()}</Typography.Paragraph>
                    ) : (
                        <Typography.Paragraph type="warning">尚未确认授权，请退回并让推荐人重新提交。</Typography.Paragraph>
                    )
                ) : null}
                <Typography.Paragraph type="secondary">确认发布后复用原素材资源，不为用户复制文件；以下信息将写入官方素材库。</Typography.Paragraph>
                <Form form={publishForm} layout="vertical" onFinish={(values) => void submitPublish(values)}>
                    <Form.Item name="title" label="名称" rules={[{ required: true, message: "请输入素材名称" }]}>
                        <Input maxLength={240} />
                    </Form.Item>
                    <Form.Item name="description" label="基本描述">
                        <Input.TextArea rows={3} maxLength={500} showCount />
                    </Form.Item>
                    <Form.Item name="category" label="分类" rules={[{ required: true }]}>
                        <Select options={ASSET_CATEGORY_OPTIONS} />
                    </Form.Item>
                    <Form.Item name="tagsText" label="标签" extra={publishTarget?.assetTags?.length ? "默认带入原素材当前标签，可修改。" : undefined}>
                        <Input placeholder="多个标签用逗号或换行分隔" maxLength={800} />
                    </Form.Item>
                    <Form.Item name="licenseNote" label="授权说明">
                        <Input.TextArea rows={2} maxLength={500} readOnly />
                    </Form.Item>
                    <details className="mb-4">
                        <summary className="cursor-pointer">更多信息</summary>
                        <div className="pt-4">
                            <Form.Item name="sourceName" label="来源名称">
                                <Input maxLength={240} />
                            </Form.Item>
                            <Form.Item name="sourceUrl" label="来源链接">
                                <Input maxLength={500} />
                            </Form.Item>
                            <Form.Item name="usageNote" label="使用说明">
                                <Input.TextArea rows={2} maxLength={500} />
                            </Form.Item>
                        </div>
                    </details>
                    <Space style={{ display: "flex", justifyContent: "flex-end" }}>
                        <Button onClick={() => setPublishTarget(null)}>取消</Button>
                        <Button type="primary" htmlType="submit" disabled={!publishTarget || publishTarget.consentVersion !== "commercial-use-v1" || !publishTarget.consentAt}>
                            确认发布
                        </Button>
                    </Space>
                </Form>
            </Modal>
            <Modal
                open={Boolean(reviewing)}
                title={reviewing?.action === "reject" ? "拒绝推荐" : "退回补充"}
                onCancel={() => setReviewing(null)}
                onOk={async () => {
                    if (!reviewing) return;
                    await review(reviewing.row, reviewing.action, note);
                    setReviewing(null);
                }}
                okText="确认"
                cancelText="取消"
            >
                <Input.TextArea value={note} maxLength={2000} showCount rows={4} placeholder="填写给推荐人的说明（选填）" onChange={(event) => setNote(event.target.value)} />
            </Modal>
        </AdminPageFrame>
    );
}
