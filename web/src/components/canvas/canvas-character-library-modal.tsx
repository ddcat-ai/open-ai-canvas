import { App, Button, Input } from "antd";
import { Image as ImageIcon, Plus, Search, UserRound, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { PaginationBar } from "@/components/layout/workspace-page";
import { type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { projectCharacterToInsertPayload } from "@/components/canvas/canvas-project-asset-modal";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { createCharacter, listCharacters, type ProjectAsset } from "@/services/api/projects";

const CHARACTER_PAGE_SIZE = 12;

export function CanvasCharacterLibraryModal({
    open,
    imageResourceId,
    audioResourceId,
    imageTitle,
    audioTitle,
    onClose,
    onInsert,
}: {
    open: boolean;
    imageResourceId?: string;
    audioResourceId?: string;
    imageTitle?: string;
    audioTitle?: string;
    onClose: () => void;
    onInsert: (payloads: InsertAssetPayload[]) => Promise<void> | void;
}) {
    const { message } = App.useApp();
    const [name, setName] = useState("");
    const [creating, setCreating] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(CHARACTER_PAGE_SIZE);
    const [keyword, setKeyword] = useState("");
    const debouncedKeyword = useDebouncedValue(keyword.trim(), 250);
    useEffect(() => {
        setPage(1);
    }, [debouncedKeyword, pageSize]);
    useEffect(() => {
        if (!open) return;
        setPage(1);
        setKeyword("");
        setName("");
    }, [open]);
    const charactersQuery = useQuery({
        queryKey: ["characters", "library", page, pageSize, debouncedKeyword],
        queryFn: () => listCharacters({ page, pageSize, query: debouncedKeyword || undefined }),
        enabled: open,
        placeholderData: keepPreviousData,
    });
    const characters = charactersQuery.data?.characters || [];
    const total = charactersQuery.data?.total || 0;
    const canPack = Boolean(imageResourceId);

    const insertCharacter = async (asset: ProjectAsset) => {
        await onInsert([projectCharacterToInsertPayload(asset)]);
        onClose();
    };

    const createAndInsert = async () => {
        const title = name.trim() || imageTitle || "未命名角色";
        setCreating(true);
        try {
            const created = await createCharacter({
                name: title,
                imageResourceId,
                audioResourceId,
                voiceName: audioTitle,
            });
            await insertCharacter(created.asset);
            setName("");
            message.success(canPack ? "已把图片和音频打包成角色卡" : "角色卡已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "角色卡创建失败");
        } finally {
            setCreating(false);
        }
    };

    return (
        <AppModal open={open} title="角色卡" okButtonProps={{ style: { display: "none" } }} cancelText="关闭" onCancel={onClose} destroyOnHidden width={720}>
            <div className="space-y-4">
                <div className="rounded-md border border-border bg-foreground/[.03] p-3">
                    <div className="text-sm font-medium">新建角色卡</div>
                    <p className="mt-1 text-xs text-foreground/55">
                        {canPack
                            ? `将使用当前图片${imageTitle ? `「${imageTitle}」` : ""}${audioResourceId ? `和音频${audioTitle ? `「${audioTitle}」` : ""}` : ""}打包。`
                            : "也可以先建一张空角色卡，之后再绑定形象和声音。选中一张图片，可同时选一段音频后再打开这里打包。"}
                    </p>
                    <div className="mt-3 flex gap-2">
                        <Input value={name} placeholder="角色名称" maxLength={80} onChange={(event) => setName(event.target.value)} onPressEnter={() => void createAndInsert()} />
                        <Button type="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => void createAndInsert()}>
                            {canPack ? "打包创建" : "创建"}
                        </Button>
                    </div>
                </div>
                <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-foreground/55">已有角色卡</div>
                        <Input allowClear value={keyword} prefix={<Search className="size-3.5 text-foreground/40" />} placeholder="搜索角色名称" className="max-w-56" onChange={(event) => setKeyword(event.target.value)} />
                    </div>
                    {charactersQuery.isLoading ? <p className="text-sm text-foreground/45">正在读取角色卡</p> : null}
                    {!charactersQuery.isLoading && !characters.length ? <p className="text-sm text-foreground/45">{debouncedKeyword ? "没有匹配的角色卡" : "还没有角色卡。创建后即可连接到视频、音频和 Agent。"}</p> : null}
                    <div className="grid grid-cols-2 gap-2">
                        {characters.map((item) => (
                            <button key={item.asset.id} type="button" className="flex min-h-16 items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-foreground/[.04]" onClick={() => void insertCharacter(item.asset)}>
                                <span className="grid size-10 shrink-0 place-items-center rounded bg-foreground/[.06]">
                                    <UserRound className="size-4" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{item.asset.title}</span>
                                    <span className="mt-1 flex gap-2 text-[11px] text-foreground/50">
                                        <span className="inline-flex items-center gap-1">
                                            <ImageIcon className="size-3" />
                                            {item.character.visualStatus === "ready" ? "形象就绪" : "形象待完善"}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <Volume2 className="size-3" />
                                            {item.character.voiceStatus === "ready" ? "声音已绑定" : "声音未绑定"}
                                        </span>
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                    <PaginationBar
                        current={page}
                        pageSize={pageSize}
                        total={total}
                        pageSizeOptions={[12, 24, 48]}
                        itemLabel="张"
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                </div>
            </div>
        </AppModal>
    );
}
