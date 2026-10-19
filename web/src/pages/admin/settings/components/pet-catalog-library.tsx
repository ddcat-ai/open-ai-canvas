import { useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Input, Pagination, Select } from "antd";
import { Check, Plus, Search, Upload } from "lucide-react";
import { PetThumbnail } from "@/components/canvas/pet-thumbnail";
import { filterPetCatalog, PET_CATALOG_LIMIT, PET_CATALOG_PAGE_SIZE, spriteImportID } from "@/lib/canvas/pet-catalog";
import { uploadSpritePet, type PetAppearance } from "@/services/api/appearance";

export function PetCatalogLibrary({
    catalog,
    selectedId,
    defaultId,
    disabled,
    onSelect,
    onChange,
    onUploading,
}: {
    catalog: PetAppearance[];
    selectedId: string;
    defaultId?: string;
    disabled: boolean;
    onSelect: (id: string) => void;
    onChange: (catalog: PetAppearance[]) => void;
    onUploading: (busy: boolean) => void;
}) {
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [query, setQuery] = useState(""),
        [status, setStatus] = useState("all"),
        [page, setPage] = useState(1);
    const [publish, setPublish] = useState(true),
        [progress, setProgress] = useState(""),
        [failures, setFailures] = useState<string[]>([]);
    const busy = Boolean(progress),
        filtered = filterPetCatalog(catalog, query, status);
    const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / PET_CATALOG_PAGE_SIZE)));
    const resetFilter = () => {
        setQuery("");
        setStatus("all");
        setPage(1);
    };
    async function importFiles(files: File[]) {
        if (!files.length || busy) return;
        if (files.length + catalog.length > PET_CATALOG_LIMIT) {
            message.error(`形象库最多 ${PET_CATALOG_LIMIT} 个，还可导入 ${PET_CATALOG_LIMIT - catalog.length} 个`);
            return;
        }
        if (files.some((file) => !file.name.toLowerCase().endsWith(".zip") || file.size > 16 * 1024 * 1024)) {
            message.error("请选择每个不超过 16 MiB 的精灵 ZIP");
            return;
        }
        onUploading(true);
        setFailures([]);
        const next = [...catalog],
            added: PetAppearance[] = [],
            errors: string[] = [];
        let duplicates = 0;
        try {
            for (const [index, file] of files.entries()) {
                setProgress(`正在导入 ${index + 1}/${files.length}`);
                try {
                    const id = await spriteImportID(file);
                    if (next.some((pet) => pet.id === id)) {
                        duplicates++;
                        continue;
                    }
                    const imported = await uploadSpritePet(file);
                    if (next.some((pet) => pet.spriteResourceId === imported.resourceId)) {
                        duplicates++;
                        continue;
                    }
                    const pet: PetAppearance = {
                        id,
                        name: imported.config.displayName.slice(0, 40),
                        published: publish,
                        avatarType: "sprite",
                        avatarHeight: 208,
                        spriteResourceId: imported.resourceId,
                        sprite: imported.config,
                        live2dResourceId: "",
                        live2dEntry: "",
                    };
                    next.push(pet);
                    added.push(pet);
                } catch (cause) {
                    errors.push(`${file.name}：${cause instanceof Error ? cause.message : "导入失败"}`);
                }
            }
            if (added.length) {
                onChange(next);
                resetFilter();
                onSelect(added[0].id);
                message.success(`已导入 ${added.length} 个形象${duplicates ? `，跳过 ${duplicates} 个重复形象` : ""}，保存后生效`);
            } else if (!errors.length) message.info("所选形象已在库中");
            setFailures(errors);
        } finally {
            setProgress("");
            onUploading(false);
        }
    }
    return (
        <section className="pet-library" aria-label="后台宠物形象库">
            <div className="pet-library-heading">
                <div>
                    <h3>
                        形象库{" "}
                        <span>
                            {catalog.length}/{PET_CATALOG_LIMIT}
                        </span>
                    </h3>
                    <p>选择形象进行预览和编辑，保存后生效。</p>
                </div>
                <div className="pet-library-tools">
                    <Button
                        icon={<Plus size={16} aria-hidden />}
                        disabled={disabled || busy || catalog.length >= PET_CATALOG_LIMIT}
                        onClick={() => {
                            const pet: PetAppearance = { id: crypto.randomUUID(), name: "新形象", published: false, avatarType: "orb", avatarHeight: 220, spriteResourceId: "", live2dResourceId: "", live2dEntry: "" };
                            onChange([...catalog, pet]);
                            resetFilter();
                            onSelect(pet.id);
                        }}
                    >
                        添加形象
                    </Button>
                    <Button type="primary" icon={<Upload size={16} aria-hidden />} loading={busy} disabled={disabled || catalog.length >= PET_CATALOG_LIMIT} onClick={() => input.current?.click()}>
                        批量导入 ZIP
                    </Button>
                </div>
            </div>
            <input
                ref={input}
                type="file"
                multiple
                accept=".zip,application/zip"
                className="hidden"
                onChange={(event) => {
                    const files = Array.from(event.target.files || []);
                    event.currentTarget.value = "";
                    void importFiles(files);
                }}
            />
            <div className="pet-library-filter">
                <Input
                    aria-label="搜索形象"
                    placeholder="搜索形象"
                    prefix={<Search size={16} aria-hidden />}
                    allowClear
                    value={query}
                    disabled={busy}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setPage(1);
                    }}
                />
                <Select
                    aria-label="形象发布状态"
                    value={status}
                    disabled={busy}
                    onChange={(value) => {
                        setStatus(value);
                        setPage(1);
                    }}
                    options={[
                        { value: "all", label: "全部状态" },
                        { value: "published", label: "已发布" },
                        { value: "draft", label: "未发布" },
                    ]}
                />
                <Checkbox checked={publish} disabled={disabled || busy} onChange={(e) => setPublish(e.target.checked)}>
                    导入后发布
                </Checkbox>
            </div>
            {busy ? (
                <div role="status" className="pet-library-progress">
                    {progress}
                </div>
            ) : null}
            {failures.length ? (
                <Alert
                    type="warning"
                    showIcon
                    title={`${failures.length} 个文件未导入，已成功的形象仍可保存`}
                    description={
                        <details>
                            <summary>查看详情</summary>
                            <ul>
                                {failures.map((text) => (
                                    <li key={text}>{text}</li>
                                ))}
                            </ul>
                        </details>
                    }
                />
            ) : null}
            <div className="pet-library-grid">
                {filtered.slice((currentPage - 1) * PET_CATALOG_PAGE_SIZE, currentPage * PET_CATALOG_PAGE_SIZE).map((pet) => (
                    <button key={pet.id} type="button" className="pet-admin-choice" aria-label={`编辑${pet.name}`} title={pet.name} aria-pressed={selectedId === pet.id} disabled={disabled || busy} onClick={() => onSelect(pet.id)}>
                        <PetThumbnail pet={pet} preview />
                        <span>{pet.name}</span>
                        <small>{pet.id === defaultId ? "系统默认" : pet.published ? "已发布" : "未发布"}</small>
                        {selectedId === pet.id ? <Check className="pet-library-selected" size={14} aria-hidden /> : null}
                    </button>
                ))}
            </div>
            {!filtered.length ? <p className="pet-library-empty">没有找到形象，试试其他名称或筛选条件。</p> : null}
            <div className="pet-library-pagination">
                <span>共 {filtered.length} 个</span>
                <Pagination size="small" current={currentPage} pageSize={PET_CATALOG_PAGE_SIZE} total={filtered.length} showSizeChanger={false} hideOnSinglePage onChange={setPage} disabled={busy} />
            </div>
        </section>
    );
}
