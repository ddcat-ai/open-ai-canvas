import { App, Modal } from "antd";
import { Images, MoreHorizontal, Trash2 } from "lucide-react";
import { HistoryIcon } from "@/components/ui/ecommerce-icons";
import { useEffect, useRef, useState } from "react";
import { deleteEcommerceProjects, listEcommerceProjectPage, projectDraft, type EcommerceProject } from "@/services/api/ecommerce";
import { resourceStorageKey } from "@/services/api/resources";
import { CachedResourceImage } from "@/components/cached-resource-image";

function historyGroup(date: string) {
    const value = new Date(date);
    if (Number.isNaN(value.getTime())) return "更早";
    const today = new Date();
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const updated = new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    if (updated === day) return "今天";
    if (updated === day - 86_400_000) return "昨天";
    return "更早";
}

export function CompactEcommerceHistory({
    open,
    activeId,
    disabled,
    onClose,
    onOpen,
    onDeleted,
    onShowAll,
}: {
    open: boolean;
    activeId?: string;
    disabled: boolean;
    onClose: () => void;
    onOpen: (project: EcommerceProject) => void;
    onDeleted: (ids: string[], all: boolean) => void;
    onShowAll: () => void;
}) {
    const { message } = App.useApp();
    const root = useRef<HTMLDivElement>(null);
    const [projects, setProjects] = useState<EcommerceProject[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [menuId, setMenuId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<EcommerceProject | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        if (!open) {
            setMenuId(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError("");
        void listEcommerceProjectPage(1, 20)
            .then((result) => {
                if (!cancelled) {
                    setProjects(result.projects || []);
                    setTotal(result.total || 0);
                }
            })
            .catch((cause) => {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "历史记录加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, revision]);
    useEffect(() => {
        if (!open) return;
        const dismiss = (event: PointerEvent) => {
            if (!deleteTarget && !root.current?.contains(event.target as Node) && !(event.target as Element).closest?.("[data-commerce-history-trigger]")) onClose();
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !deleteTarget) onClose();
        };
        document.addEventListener("pointerdown", dismiss);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("pointerdown", dismiss);
            document.removeEventListener("keydown", escape);
        };
    }, [open, deleteTarget, onClose]);

    const remove = async () => {
        if (!deleteTarget || deleting) return;
        setDeleting(true);
        try {
            await deleteEcommerceProjects({ ids: [deleteTarget.id], expectedTotal: 1 });
            onDeleted([deleteTarget.id], false);
            setDeleteTarget(null);
            setMenuId(null);
            setRevision((value) => value + 1);
            message.success("项目已删除");
        } catch (cause) {
            setDeleteTarget(null);
            setRevision((value) => value + 1);
            message.error(cause instanceof Error ? cause.message : "删除失败，请重试");
        } finally {
            setDeleting(false);
        }
    };
    if (!open) return null;
    let previousGroup = "";
    return (
        <div className="commerce-compact-history" ref={root} role="dialog" aria-label="历史记录">
            <div className="commerce-compact-history-heading">
                <HistoryIcon size={15} />
                <strong>历史记录</strong>
                <span>{total ? `${total} 个项目` : ""}</span>
            </div>
            <div className="commerce-compact-history-list" data-canvas-wheel-scroll>
                {loading ? (
                    <p role="status">正在加载历史记录…</p>
                ) : error ? (
                    <p role="alert">
                        {error}
                        <button type="button" onClick={() => setRevision((value) => value + 1)}>
                            重试
                        </button>
                    </p>
                ) : projects.length ? (
                    projects.map((project) => {
                        const group = historyGroup(project.updatedAt);
                        const showGroup = group !== previousGroup;
                        previousGroup = group;
                        const draft = projectDraft(project);
                        const title = project.name?.trim() || draft.productName?.trim() || "未命名商品";
                        const cover = draft.references.find((ref) => ref.role === "primary" && ref.resourceId);
                        return (
                            <div className="commerce-compact-history-entry" key={project.id}>
                                {showGroup ? <div className="commerce-compact-history-date">{group}</div> : null}
                                <div className={`commerce-compact-history-row${project.id === activeId ? " is-current" : ""}`}>
                                    <button type="button" className="commerce-compact-history-open" disabled={disabled} onClick={() => onOpen(project)} aria-label={`打开项目：${title}`}>
                                        <span className="commerce-compact-history-cover">
                                            {cover ? (
                                                <CachedResourceImage storageKey={resourceStorageKey(cover.resourceId)} alt="" loading="lazy" decoding="async" fallback={<Images size={18} />} loadingFallback={<Images size={18} />} />
                                            ) : (
                                                <Images size={18} />
                                            )}
                                        </span>
                                        <span title={title}>{title}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="commerce-compact-history-more"
                                        disabled={disabled}
                                        aria-label={`${title}的更多操作`}
                                        aria-expanded={menuId === project.id}
                                        onClick={() => setMenuId((value) => (value === project.id ? null : project.id))}
                                    >
                                        <MoreHorizontal size={17} />
                                    </button>
                                    {menuId === project.id ? (
                                        <button
                                            type="button"
                                            className="commerce-compact-history-delete"
                                            onClick={() => {
                                                setDeleteTarget(project);
                                                setMenuId(null);
                                            }}
                                        >
                                            <Trash2 size={13} />
                                            删除
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <p>暂无历史项目，开始创作后会显示在这里。</p>
                )}
            </div>
            {total > 20 ? (
                <button type="button" className="commerce-compact-history-all" onClick={onShowAll}>
                    查看全部 {total} 个项目
                </button>
            ) : null}
            <Modal
                title="删除这个项目？"
                open={Boolean(deleteTarget)}
                centered
                okText="确认删除"
                okButtonProps={{ danger: true, loading: deleting }}
                cancelText="取消"
                onOk={() => void remove()}
                onCancel={() => {
                    if (!deleting) setDeleteTarget(null);
                }}
            >
                <p>将删除「{deleteTarget?.name?.trim() || "未命名商品"}」。删除后项目无法恢复，已生成的图片仍保留在资产库。</p>
            </Modal>
        </div>
    );
}
