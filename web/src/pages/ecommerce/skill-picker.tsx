import { App, Button, Checkbox, Input, Modal, Segmented } from "antd";
import { BookOpen, RefreshCw, Search, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { addSkill, installSkillUpload, listAddedSkills, listSkills, type Skill } from "@/services/api/skills";
import { curationQuery, matchesCuration, useSkillCuration } from "@/components/skills/skill-curation-browser";
import { fallbackSkillCategories } from "@/pages/skills/skill-catalog";
import { getActiveUserScope } from "@/lib/user-scope";

type Props = { selected: string[]; onChange: (ids: string[]) => void; disabled?: boolean };

export function EcommerceSkillPicker({ selected, onChange, disabled }: Props) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<"mine" | "public">("mine");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("");
    const { curation, error: curationError, retry: retryCuration } = useSkillCuration(open);
    const [installed, setInstalled] = useState<Skill[]>([]);
    const [market, setMarket] = useState<Skill[]>([]);
    const [offset, setOffset] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [loading, setLoading] = useState(false);
    const [installing, setInstalling] = useState("");
    const [uploading, setUploading] = useState(false);
    const fileInput = useRef<HTMLInputElement>(null);
    const uploadLock = useRef(false);
    const selection = useRef(selected);
    selection.current = selected;
    const ownerScope = useRef(getActiveUserScope());
    const mounted = useRef(false);
    const isCurrent = useCallback(() => mounted.current && getActiveUserScope() === ownerScope.current, []);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    const refresh = useCallback(async () => {
        if (!isCurrent()) return;
        const result = await listAddedSkills();
        if (!isCurrent()) return;
        setInstalled(result.skills.filter((skill) => skill.isAdded));
    }, [isCurrent]);
    useEffect(() => {
        if (!open) return;
        void refresh().catch((cause) => {
            if (isCurrent()) message.error(cause instanceof Error ? cause.message : "技能库加载失败");
        });
    }, [open, refresh, isCurrent]);
    useEffect(() => {
        if (!open || tab !== "public") return;
        let active = true;
        setLoading(true);
        const timer = window.setTimeout(() => {
            if (!isCurrent()) return;
            void listSkills({ scope: "public", search: query.trim(), pageSize: 30, page: 1, ...(curation?.enabled ? curationQuery(curation, category) : category ? { tag: category } : {}) })
                .then((result) => {
                    if (!active || !isCurrent()) return;
                    setMarket(result.skills);
                    setOffset(result.nextOffset);
                    setHasMore(result.hasMore);
                })
                .catch((cause) => {
                    if (active && isCurrent()) message.error(cause instanceof Error ? cause.message : "公开技能加载失败");
                })
                .finally(() => {
                    if (active && isCurrent()) setLoading(false);
                });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [open, tab, query, category, curation, isCurrent]);
    const filtered =
        tab === "mine"
            ? installed.filter((skill) => `${skill.skillName} ${skill.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (curation?.enabled ? matchesCuration(skill, curation, category) : !category || skill.tag === category))
            : market;
    const categories = !curation
        ? []
        : curation.enabled
          ? (curation.roots || [])
                .filter((root) => root.enabled)
                .flatMap((root) => [{ id: `root:${root.id}`, name: root.name, child: false }, ...curation.categories.filter((item) => item.enabled && item.rootTag === root.id).map((item) => ({ id: item.id, name: item.name, child: true }))])
          : fallbackSkillCategories.map((item) => ({ id: item.value, name: item.label, child: false }));
    const toggle = (id: string) => {
        const current = selection.current;
        if (current.includes(id)) onChange(current.filter((value) => value !== id));
        else if (current.length < 8) onChange([...current, id]);
        else message.warning("每轮最多选择 8 个 Skills");
    };
    const install = async (skill: Skill) => {
        if (!isCurrent()) return;
        setInstalling(skill.skillId);
        try {
            await addSkill(skill.skillId);
            if (!isCurrent()) return;
            await refresh();
            if (!isCurrent()) return;
            toggle(skill.skillId);
            message.success(`已加入并选择 ${skill.skillName}`);
        } catch (cause) {
            if (isCurrent()) message.error(cause instanceof Error ? cause.message : "安装技能失败");
        } finally {
            if (isCurrent()) setInstalling("");
        }
    };
    const loadMore = async () => {
        if (!isCurrent()) return;
        setLoading(true);
        try {
            const result = await listSkills({ scope: "public", search: query.trim(), pageSize: 30, page: Math.floor(offset / 30) + 1, ...(curation?.enabled ? curationQuery(curation, category) : category ? { tag: category } : {}) });
            if (!isCurrent()) return;
            setMarket((current) => [...current, ...result.skills.filter((skill) => !current.some((item) => item.skillId === skill.skillId))]);
            setOffset(result.nextOffset);
            setHasMore(result.hasMore);
        } catch (cause) {
            if (isCurrent()) message.error(cause instanceof Error ? cause.message : "加载更多技能失败");
        } finally {
            if (isCurrent()) setLoading(false);
        }
    };
    const upload = async (file: File) => {
        if (uploadLock.current || disabled || !isCurrent()) return;
        if (!/\.(md|markdown|zip)$/i.test(file.name)) {
            message.error("请上传 Markdown 文件或 ZIP 技能包");
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            message.error("技能文件不能超过 20 MB");
            return;
        }
        if (selection.current.length >= 8) {
            message.warning("每轮最多选择 8 个 Skills，请先取消一个");
            return;
        }
        uploadLock.current = true;
        setUploading(true);
        try {
            const { skill } = await installSkillUpload({ file, sourceType: /\.zip$/i.test(file.name) ? "zip" : "markdown", tag: "others", isPrivate: true });
            // Only attach completion to the project/account that started this upload.
            if (!isCurrent()) return;
            const canSelect = selection.current.includes(skill.skillId) || selection.current.length < 8;
            if (!selection.current.includes(skill.skillId) && canSelect) onChange([...selection.current, skill.skillId]);
            setInstalled((current) => [skill, ...current.filter((item) => item.skillId !== skill.skillId)]);
            setTab("mine");
            setQuery("");
            setCategory("");
            message.success(canSelect ? "Skill 已上传并加入本轮策划" : "Skill 已保存到个人库，本轮已选满，请取消一个后再选择");
        } catch (cause) {
            if (isCurrent()) message.error(cause instanceof Error ? cause.message : "技能上传失败");
        } finally {
            uploadLock.current = false;
            if (isCurrent()) setUploading(false);
        }
    };
    return (
        <div className="ecommerce-field">
            <span>Skills · 策划方法</span>
            <Button block icon={<BookOpen size={15} />} disabled={disabled} onClick={() => setOpen(true)}>
                {selected.length ? `已选择 ${selected.length} 个 Skills` : "选择 Skills"}
            </Button>
            <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,.zip"
                hidden
                aria-label="上传策划 Skill 文件"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void upload(file);
                }}
            />
            <Button block icon={<Upload size={15} />} disabled={disabled || selected.length >= 8} loading={uploading} onClick={() => fileInput.current?.click()}>
                上传 Skills
            </Button>
            <small className="ecommerce-model-note">支持 Markdown / ZIP，保存到个人技能库。Agent 读取所选技能后策划，生成前可逐张修改文案与提示词。</small>
            {selected.length ? <small className="ecommerce-model-note">策划将按所选技能编写图片方案与提示词；修改后需重新策划。</small> : null}
            <Modal title="选择策划 Skills" open={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>完成</Button>} width={780} destroyOnHidden>
                <div className="ecommerce-skill-controls">
                    <Segmented
                        value={tab}
                        options={[
                            { label: `我的技能 (${installed.length})`, value: "mine" },
                            { label: "公开技能", value: "public" },
                        ]}
                        onChange={(value) => {
                            setTab(value as "mine" | "public");
                            setQuery("");
                        }}
                    />
                    <Button aria-label="刷新已安装 Skills" icon={<RefreshCw size={14} />} onClick={() => void refresh()} />
                </div>
                <Input
                    prefix={<Search size={15} />}
                    aria-label="搜索 Skills"
                    placeholder="搜索技能名称或说明"
                    value={query}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        if (event.target.value) setCategory("");
                    }}
                />
                {curationError ? (
                    <Button type="link" onClick={retryCuration}>
                        分类加载失败，重试
                    </Button>
                ) : null}
                <div className="ecommerce-skill-browser">
                    <nav className="ecommerce-skill-categories" aria-label="技能分类">
                        <strong>技能分类</strong>
                        <button type="button" aria-pressed={!category} onClick={() => setCategory("")}>
                            全部技能
                        </button>
                        {categories.map((item) => (
                            <button
                                type="button"
                                className={item.child ? "is-child" : undefined}
                                key={item.id}
                                aria-pressed={category === item.id}
                                onClick={() => {
                                    setCategory(item.id);
                                    setQuery("");
                                }}
                            >
                                {item.name}
                            </button>
                        ))}
                    </nav>
                    <div className="ecommerce-skill-list">
                        {tab === "mine"
                            ? selected
                                  .filter((id) => !installed.some((skill) => skill.skillId === id))
                                  .map((id) => (
                                      <div className="ecommerce-skill-row" key={id}>
                                          <div>
                                              <strong>已失效的 Skill</strong>
                                              <small>该技能已移除或不可用，请取消选择。</small>
                                          </div>
                                          <Button size="small" onClick={() => toggle(id)}>
                                              移除
                                          </Button>
                                      </div>
                                  ))
                            : null}
                        {filtered.map((skill) => (
                            <div className="ecommerce-skill-row" key={skill.skillId}>
                                <div>
                                    <strong>{skill.skillName}</strong>
                                    <small>{skill.description || "暂无说明"}</small>
                                </div>
                                {installed.some((item) => item.skillId === skill.skillId) ? (
                                    <Checkbox checked={selected.includes(skill.skillId)} disabled={!selected.includes(skill.skillId) && selected.length >= 8} onChange={() => toggle(skill.skillId)}>
                                        使用
                                    </Checkbox>
                                ) : (
                                    <Button size="small" loading={installing === skill.skillId} disabled={selected.length >= 8} onClick={() => void install(skill)}>
                                        加入并使用
                                    </Button>
                                )}
                            </div>
                        ))}
                        {!filtered.length && !loading ? <p className="ecommerce-skill-empty">{tab === "mine" ? "技能库暂无匹配项，可从公开技能中加入。" : "没有匹配的公开技能。"}</p> : null}
                    </div>
                </div>
                {tab === "public" && hasMore ? (
                    <Button block loading={loading} onClick={() => void loadMore()}>
                        加载更多
                    </Button>
                ) : null}
                <p className="ecommerce-skill-count">本轮使用 {selected.length} / 8 个 Skills</p>
            </Modal>
        </div>
    );
}
