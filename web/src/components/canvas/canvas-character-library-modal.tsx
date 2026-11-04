import { App, Button, Input } from "antd";
import { Image as ImageIcon, Plus, Search, UserRound, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
    const { t } = useTranslation();
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
        const title = name.trim() || imageTitle || t("canvasA.characterNode.unnamed");
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
            message.success(canPack ? t("canvasA.characterLibrary.packed") : t("canvasA.characterLibrary.created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvasA.characterLibrary.createFailed"));
        } finally {
            setCreating(false);
        }
    };

    return (
        <AppModal open={open} title={t("canvasA.characterNode.card")} okButtonProps={{ style: { display: "none" } }} cancelText={t("common.close")} onCancel={onClose} destroyOnHidden width={720}>
            <div className="space-y-4">
                <div className="rounded-md border border-border bg-foreground/[.03] p-3">
                    <div className="text-sm font-medium">{t("canvasA.characterLibrary.newCard")}</div>
                    <p className="mt-1 text-xs text-foreground/55">
                        {canPack
                            ? t(audioResourceId ? "canvasA.characterLibrary.packImageAudio" : "canvasA.characterLibrary.packImage", {
                                  image: imageTitle ? t("canvasA.characterLibrary.quotedTitle", { title: imageTitle }) : "",
                                  audio: audioTitle ? t("canvasA.characterLibrary.quotedTitle", { title: audioTitle }) : "",
                              })
                            : t("canvasA.characterLibrary.emptyHint")}
                    </p>
                    <div className="mt-3 flex gap-2">
                        <Input value={name} placeholder={t("canvasA.characterLibrary.namePlaceholder")} maxLength={80} onChange={(event) => setName(event.target.value)} onPressEnter={() => void createAndInsert()} />
                        <Button type="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => void createAndInsert()}>
                            {canPack ? t("canvasA.characterLibrary.packCreate") : t("canvasA.characterLibrary.create")}
                        </Button>
                    </div>
                </div>
                <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs font-medium text-foreground/55">{t("canvasA.characterLibrary.existing")}</div>
                        <Input
                            allowClear
                            value={keyword}
                            prefix={<Search className="size-3.5 text-foreground/40" />}
                            placeholder={t("canvasA.characterLibrary.searchPlaceholder")}
                            className="max-w-56"
                            onChange={(event) => setKeyword(event.target.value)}
                        />
                    </div>
                    {charactersQuery.isLoading ? <p className="text-sm text-foreground/45">{t("canvasA.characterLibrary.loading")}</p> : null}
                    {!charactersQuery.isLoading && !characters.length ? <p className="text-sm text-foreground/45">{debouncedKeyword ? t("canvasA.characterLibrary.noMatch") : t("canvasA.characterLibrary.empty")}</p> : null}
                    <div className="grid grid-cols-2 gap-2">
                        {characters.map((item) => (
                            <button key={item.asset.id} type="button" className="flex min-h-16 items-center gap-3 rounded-md border border-border px-3 py-2 text-left hover:bg-foreground/[.04]" onClick={() => void insertCharacter(item.asset)}>
                                <span className="grid size-10 shrink-0 place-items-center rounded bg-foreground/[.06]">
                                    <UserRound className="size-4" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-sm font-medium">{item.asset.title}</span>
                                    <span className="mt-1 flex gap-2 text-[var(--fs-label)] text-foreground/50">
                                        <span className="inline-flex items-center gap-1">
                                            <ImageIcon className="size-3" />
                                            {item.character.visualStatus === "ready" ? t("canvasA.characterLibrary.visualReady") : t("canvasA.characterNode.visualPending")}
                                        </span>
                                        <span className="inline-flex items-center gap-1">
                                            <Volume2 className="size-3" />
                                            {item.character.voiceStatus === "ready" ? t("canvasA.characterLibrary.voiceBound") : t("canvasA.characterNode.voiceUnbound")}
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
                        itemLabel={t("canvasA.characterLibrary.pageItem")}
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
