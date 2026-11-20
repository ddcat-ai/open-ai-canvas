import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Check, RefreshCw, X } from "lucide-react";
import { useState } from "react";

import { approveAdminArkAssets, arkPortraitAssetFileUrl, listAdminArkReviews, rejectAdminArkAssets, type AdminArkReviewResult, type ArkPortraitAsset } from "@/services/api/ark-portraits";
import { AdminBatchBar, AdminDataTable, AdminRowActions, AdminTableEmpty, PaginationBar } from "../../components/admin-ui";
import { AdminSegmented } from "../../ui/controls";
import { AdminModal } from "../../ui/overlays";
import { ARK_KIND_LABEL, arkUserLabel, formatArkAdminDate } from "./ark-admin-shared";
import { adminArkGroupsQueryKey } from "./ark-admin-groups-tab";

type ReviewStatus = "pending_review" | "rejected";

/** 用户上传审核：通过后才提交方舟（CreateAsset）；提交失败的保留待审核并逐条提示原因。 */
export function ArkAdminReviewsTab() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [status, setStatus] = useState<ReviewStatus>("pending_review");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [selected, setSelected] = useState<string[]>([]);
    const [rejecting, setRejecting] = useState<string[] | null>(null);
    const [reason, setReason] = useState("");
    const [working, setWorking] = useState(false);
    const query = useQuery({
        queryKey: ["admin-ark-reviews", status, page, pageSize],
        queryFn: ({ signal }) => listAdminArkReviews({ status, page, pageSize }, signal),
        placeholderData: keepPreviousData,
    });
    const data = query.data;

    const refresh = () => {
        void queryClient.invalidateQueries({ queryKey: ["admin-ark-reviews"] });
        void queryClient.invalidateQueries({ queryKey: adminArkGroupsQueryKey });
    };

    const report = (verb: string, result: AdminArkReviewResult) => {
        if (result.succeeded.length) message.success(`已${verb} ${result.succeeded.length} 份素材`);
        if (result.failed.length) {
            modal.warning({
                title: `${result.failed.length} 份素材${verb}失败`,
                content: (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                        {result.failed.map((item) => (
                            <li key={item.id}>
                                {data?.items.find((asset) => asset.id === item.id)?.name || item.id}：{item.error}
                            </li>
                        ))}
                    </ul>
                ),
            });
        }
        setSelected((current) => current.filter((id) => !result.succeeded.includes(id)));
        refresh();
    };

    const approve = async (ids: string[]) => {
        if (!ids.length) return;
        setWorking(true);
        try {
            report("通过", await approveAdminArkAssets(ids));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "审核失败");
        } finally {
            setWorking(false);
        }
    };

    const reject = async () => {
        if (!rejecting?.length) return;
        if (!reason.trim()) {
            message.warning("请填写驳回原因，用户会在素材组里看到");
            return;
        }
        setWorking(true);
        try {
            report("驳回", await rejectAdminArkAssets(rejecting, reason.trim()));
            setRejecting(null);
            setReason("");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "驳回失败");
        } finally {
            setWorking(false);
        }
    };

    const columns: ColumnsType<ArkPortraitAsset> = [
        {
            title: "素材",
            key: "asset",
            render: (_, asset) => (
                <div className="flex min-w-0 items-center gap-3">
                    <a href={arkPortraitAssetFileUrl(asset.id)} target="_blank" rel="noopener noreferrer" className="admin-ark-review-thumb" aria-label={`查看原图 ${asset.name}`}>
                        <img src={arkPortraitAssetFileUrl(asset.id)} alt="" loading="lazy" decoding="async" />
                    </a>
                    <div className="min-w-0">
                        <div className="truncate font-medium" title={asset.name}>
                            {asset.name}
                        </div>
                        <div className="text-xs opacity-60">{asset.width && asset.height ? `${asset.width}×${asset.height}` : "尺寸未知"}</div>
                    </div>
                </div>
            ),
        },
        { title: "素材组", key: "group", width: 200, render: (_, asset) => (asset.group ? `${ARK_KIND_LABEL[asset.group.kind]} · ${asset.group.name}` : "-") },
        { title: "上传者", key: "uploader", width: 180, render: (_, asset) => arkUserLabel(asset.uploader) },
        { title: "上传时间", key: "createdAt", width: 150, render: (_, asset) => formatArkAdminDate(asset.createdAt, true) },
        ...(status === "rejected" ? [{ title: "驳回原因", key: "error", render: (_: unknown, asset: ArkPortraitAsset) => asset.error || "-" }] : []),
        ...(status === "pending_review"
            ? [
                  {
                      title: "操作",
                      key: "actions",
                      width: 150,
                      render: (_: unknown, asset: ArkPortraitAsset) => (
                          <AdminRowActions
                              primary={{ label: "通过", icon: <Check className="size-3.5" />, disabled: working, onClick: () => approve([asset.id]) }}
                              actions={[{ key: "reject", label: "驳回", icon: <X className="size-3.5" />, danger: true, disabled: working, onClick: () => setRejecting([asset.id]) }]}
                          />
                      ),
                  },
              ]
            : []),
    ];

    return (
        <div className="admin-settings-stack">
            <AdminDataTable<ArkPortraitAsset>
                toolbar={
                    <AdminSegmented<ReviewStatus>
                        ariaLabel="审核状态"
                        value={status}
                        onChange={(value) => {
                            setStatus(value);
                            setPage(1);
                            setSelected([]);
                        }}
                        options={[
                            { value: "pending_review", label: "待审核" },
                            { value: "rejected", label: "已驳回" },
                        ]}
                    />
                }
                trailing={
                    <Button icon={<RefreshCw className="size-4" />} loading={query.isFetching} onClick={refresh}>
                        刷新
                    </Button>
                }
                batchActions={
                    status === "pending_review" ? (
                        <AdminBatchBar count={selected.length} onClear={() => setSelected([])}>
                            <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={working} onClick={() => void approve(selected)}>
                                通过并提交方舟
                            </Button>
                            <Button size="small" danger icon={<X className="size-3.5" />} disabled={working} onClick={() => setRejecting(selected)}>
                                驳回
                            </Button>
                        </AdminBatchBar>
                    ) : null
                }
                table={{
                    rowKey: "id",
                    columns,
                    dataSource: data?.items || [],
                    loading: query.isLoading,
                    pagination: false,
                    size: "middle",
                    rowSelection: status === "pending_review" ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)) } : undefined,
                }}
                empty={<AdminTableEmpty title={status === "pending_review" ? "没有待审核的上传" : "没有已驳回的上传"} description={status === "pending_review" ? "用户向自建素材组上传的图片需要审核时会出现在这里，通过后才提交方舟。" : undefined} />}
                footer={
                    data && (data.total > pageSize || page > 1) ? (
                        <PaginationBar
                            current={page}
                            pageSize={pageSize}
                            total={data.total}
                            onChange={(nextPage, nextSize) => {
                                setPage(nextSize !== pageSize ? 1 : nextPage);
                                setPageSize(nextSize);
                            }}
                            itemLabel="份"
                        />
                    ) : null
                }
            />
            <AdminModal
                open={Boolean(rejecting)}
                title={`驳回 ${rejecting?.length || 0} 份素材`}
                okText="驳回"
                okButtonProps={{ danger: true }}
                cancelText="取消"
                confirmLoading={working}
                onCancel={() => {
                    if (!working) setRejecting(null);
                }}
                onOk={() => void reject()}
            >
                <Input.TextArea autoFocus value={reason} maxLength={200} autoSize={{ minRows: 3, maxRows: 6 }} placeholder="例如：照片不是正面清晰照 / 含其他人物" onChange={(event) => setReason(event.target.value)} />
            </AdminModal>
        </div>
    );
}
