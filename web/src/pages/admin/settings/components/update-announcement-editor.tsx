import { useRef, useState } from "react";
import { App, Button, Form, Input, Select } from "antd";
import { ArrowDown, ArrowUp, ImagePlus, Plus, Trash2, Upload, Video, Type } from "lucide-react";
import { Switch } from "@/pages/admin/ui/controls";
import { UpdateAnnouncementContent } from "@/components/layout/update-announcement-content";
import { moveUpdateItem, type UpdateAnnouncement, type UpdateBlock, type UpdateRelease } from "@/lib/update-announcement";
import { updateAnnouncementPreviewURL, uploadAppearanceAsset } from "@/services/api/appearance";
import "./update-announcement-editor.css";

export function UpdateAnnouncementEditor({ value, onChange, disabled, onUploading }: { value: UpdateAnnouncement; onChange: (value: UpdateAnnouncement) => void; disabled: boolean; onUploading: (value: boolean) => void }) {
    const { message } = App.useApp();
    const [uploading, setUploading] = useState("");
    const fileInput = useRef<HTMLInputElement>(null);
    const target = useRef<{ releaseId: string; blockId: string; type: "image" | "video" } | null>(null);
    const locked = disabled || Boolean(uploading);
    const change = (patch: Partial<UpdateAnnouncement>) => onChange({ ...value, ...patch });
    const changeRelease = (id: string, patch: Partial<UpdateRelease>) => {
        const before = value.releases.find((release) => release.id === id);
        change({ releases: value.releases.map((release) => (release.id === id ? { ...release, ...patch } : release)), ...(patch.version !== undefined && before?.version === value.currentVersion ? { currentVersion: patch.version } : {}) });
    };
    const changeBlock = (release: UpdateRelease, id: string, patch: Partial<UpdateBlock>) => changeRelease(release.id, { blocks: release.blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)) });
    const addBlock = (release: UpdateRelease, type: UpdateBlock["type"]) => changeRelease(release.id, { blocks: [...release.blocks, { id: crypto.randomUUID(), type, text: "", resourceId: "", caption: "", layout: "full" }] });
    async function upload(file?: File) {
        const selected = target.current;
        if (!file || !selected) return;
        const video = selected.type === "video";
        const allowed = video ? ["video/mp4", "video/webm"] : ["image/png", "image/jpeg", "image/webp"];
        const maxMB = video ? 256 : 10;
        if (!allowed.includes(file.type) || file.size <= 0 || file.size > maxMB * 1024 * 1024) {
            message.error(`请选择${video ? "MP4 / WebM 视频" : "PNG / JPEG / WebP 图片"}，最大 ${maxMB}MB`);
            return;
        }
        setUploading(selected.blockId);
        onUploading(true);
        try {
            const resource = await uploadAppearanceAsset(video ? "update-video" : "update-image", file);
            const release = value.releases.find((item) => item.id === selected.releaseId);
            if (release) changeBlock(release, selected.blockId, { resourceId: resource.id });
            message.success("媒体已上传，保存修改后随公告生效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "公告媒体上传失败");
        } finally {
            setUploading("");
            onUploading(false);
            target.current = null;
        }
    }
    return (
        <div className="admin-update-announcement-editor">
            <div className="admin-update-announcement-switch">
                <div>
                    <h3>自定义更新公告</h3>
                    <p>关闭时展示原有更新日志；开启时展示下方自定义版本与内容。修改后点击页面顶部“保存修改”生效。</p>
                </div>
                <Switch checked={value.enabled} disabled={locked} aria-label="启用自定义更新公告" onChange={(enabled) => change({ enabled })} />
            </div>
            <input
                ref={fileInput}
                type="file"
                className="hidden"
                onChange={(event) => {
                    void upload(event.target.files?.[0]);
                    event.currentTarget.value = "";
                }}
            />
            <div className="admin-update-announcement-layout">
                <div className="admin-update-announcement-fields">
                    <Form layout="vertical" disabled={locked}>
                        <Form.Item label="当前展示版本" htmlFor="update-current-version">
                            <Select
                                id="update-current-version"
                                aria-label="当前展示版本"
                                placeholder="添加公告版本后选择"
                                value={value.currentVersion || undefined}
                                options={value.releases.filter((release) => release.version.trim()).map((release) => ({ value: release.version, label: release.version }))}
                                onChange={(currentVersion) => change({ currentVersion })}
                            />
                        </Form.Item>
                    </Form>
                    {value.releases.map((release, index) => (
                        <section className="admin-update-announcement-release" key={release.id}>
                            <div className="admin-update-announcement-toolbar">
                                <strong>公告版本 {index + 1}</strong>
                                <div>
                                    <Button aria-label={`上移公告版本 ${index + 1}`} icon={<ArrowUp className="size-4" />} disabled={locked || index === 0} onClick={() => change({ releases: moveUpdateItem(value.releases, index, -1) })} />
                                    <Button
                                        aria-label={`下移公告版本 ${index + 1}`}
                                        icon={<ArrowDown className="size-4" />}
                                        disabled={locked || index === value.releases.length - 1}
                                        onClick={() => change({ releases: moveUpdateItem(value.releases, index, 1) })}
                                    />
                                    <Button
                                        aria-label={`删除公告版本 ${index + 1}`}
                                        icon={<Trash2 className="size-4" />}
                                        disabled={locked}
                                        onClick={() => {
                                            const releases = value.releases.filter((item) => item.id !== release.id);
                                            change({ releases, currentVersion: release.version === value.currentVersion ? releases[0]?.version || "" : value.currentVersion });
                                        }}
                                    />
                                </div>
                            </div>
                            <Form layout="vertical" disabled={locked}>
                                <div className="admin-update-announcement-meta">
                                    <Form.Item label="版本号" htmlFor={`update-version-${release.id}`}>
                                        <Input id={`update-version-${release.id}`} value={release.version} maxLength={40} placeholder="例如 v2.0.0" onChange={(event) => changeRelease(release.id, { version: event.target.value })} />
                                    </Form.Item>
                                    <Form.Item label="发布日期（可选）" htmlFor={`update-date-${release.id}`}>
                                        <Input id={`update-date-${release.id}`} type="date" value={release.date} onChange={(event) => changeRelease(release.id, { date: event.target.value })} />
                                    </Form.Item>
                                </div>
                                <Form.Item label="标题（可选）" htmlFor={`update-title-${release.id}`}>
                                    <Input id={`update-title-${release.id}`} value={release.title} maxLength={100} placeholder="本次更新的主题" onChange={(event) => changeRelease(release.id, { title: event.target.value })} />
                                </Form.Item>
                            </Form>
                            {release.blocks.map((block, blockIndex) => (
                                <div className="admin-update-announcement-block" key={block.id}>
                                    <div className="admin-update-announcement-toolbar">
                                        <strong>
                                            {block.type === "text" ? "文字" : block.type === "image" ? "图片" : "视频"} {blockIndex + 1}
                                        </strong>
                                        <div>
                                            <Button
                                                aria-label={`上移内容块 ${blockIndex + 1}（版本 ${index + 1}）`}
                                                icon={<ArrowUp className="size-4" />}
                                                disabled={locked || blockIndex === 0}
                                                onClick={() => changeRelease(release.id, { blocks: moveUpdateItem(release.blocks, blockIndex, -1) })}
                                            />
                                            <Button
                                                aria-label={`下移内容块 ${blockIndex + 1}（版本 ${index + 1}）`}
                                                icon={<ArrowDown className="size-4" />}
                                                disabled={locked || blockIndex === release.blocks.length - 1}
                                                onClick={() => changeRelease(release.id, { blocks: moveUpdateItem(release.blocks, blockIndex, 1) })}
                                            />
                                            <Button
                                                aria-label={`删除内容块 ${blockIndex + 1}（版本 ${index + 1}）`}
                                                icon={<Trash2 className="size-4" />}
                                                disabled={locked}
                                                onClick={() => changeRelease(release.id, { blocks: release.blocks.filter((item) => item.id !== block.id) })}
                                            />
                                        </div>
                                    </div>
                                    <Form layout="vertical" disabled={locked}>
                                        <Form.Item label="布局" htmlFor={`update-layout-${block.id}`}>
                                            <Select
                                                id={`update-layout-${block.id}`}
                                                value={block.layout}
                                                options={[
                                                    { value: "full", label: "整行" },
                                                    { value: "half", label: "半行（相邻半行内容并排）" },
                                                ]}
                                                onChange={(layout) => changeBlock(release, block.id, { layout })}
                                            />
                                        </Form.Item>
                                        {block.type === "text" ? (
                                            <Form.Item label="正文" htmlFor={`update-text-${block.id}`} extra="支持换行、列表和 Markdown 加粗。">
                                                <Input.TextArea
                                                    id={`update-text-${block.id}`}
                                                    value={block.text}
                                                    maxLength={10000}
                                                    autoSize={{ minRows: 4, maxRows: 14 }}
                                                    onChange={(event) => changeBlock(release, block.id, { text: event.target.value })}
                                                />
                                            </Form.Item>
                                        ) : (
                                            <>
                                                <Button
                                                    disabled={locked}
                                                    loading={uploading === block.id}
                                                    icon={<Upload className="size-4" />}
                                                    onClick={() => {
                                                        target.current = { releaseId: release.id, blockId: block.id, type: block.type as "image" | "video" };
                                                        if (fileInput.current) {
                                                            fileInput.current.accept = block.type === "image" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/webm";
                                                            fileInput.current.click();
                                                        }
                                                    }}
                                                >
                                                    {block.resourceId ? "更换" : "上传"}
                                                    {block.type === "image" ? "图片（最大 10MB）" : "视频（最大 256MB）"}
                                                </Button>
                                                <Form.Item label="媒体说明（可选）" htmlFor={`update-caption-${block.id}`}>
                                                    <Input id={`update-caption-${block.id}`} value={block.caption} maxLength={200} onChange={(event) => changeBlock(release, block.id, { caption: event.target.value })} />
                                                </Form.Item>
                                            </>
                                        )}
                                    </Form>
                                </div>
                            ))}
                            <div className="admin-update-announcement-add-actions">
                                {(
                                    [
                                        ["text", "添加文字", Type],
                                        ["image", "添加图片", ImagePlus],
                                        ["video", "添加视频", Video],
                                    ] as const
                                ).map(([type, label, Icon]) => (
                                    <Button key={type} disabled={locked || release.blocks.length >= 50} icon={<Icon className="size-4" />} onClick={() => addBlock(release, type)}>
                                        {label}
                                    </Button>
                                ))}
                            </div>
                        </section>
                    ))}
                    <Button
                        disabled={locked || value.releases.length >= 30}
                        icon={<Plus className="size-4" />}
                        onClick={() => change({ releases: [...value.releases, { id: crypto.randomUUID(), version: "", title: "", date: "", blocks: [{ id: crypto.randomUUID(), type: "text", text: "", resourceId: "", caption: "", layout: "full" }] }] })}
                    >
                        添加公告版本
                    </Button>
                </div>
                <aside className="admin-update-announcement-preview" aria-label="更新公告实时预览">
                    <div className="admin-update-announcement-preview-heading">
                        <strong>更新公告 · {value.currentVersion || "待填写版本"}</strong>
                        <span>实时预览 · 保存后生效</span>
                    </div>
                    <UpdateAnnouncementContent value={value} mediaURL={(block) => (block.resourceId ? updateAnnouncementPreviewURL(block.resourceId) : "")} />
                </aside>
            </div>
        </div>
    );
}
