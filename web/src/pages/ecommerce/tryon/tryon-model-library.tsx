import { Button, Input } from "antd";
import { Check, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { EmptyState } from "@/components/ui/product/empty-state";

import { commerceModelCatalog, type CommerceModelProfile } from "../model-catalog";

const thumb = (id: string, _view: "front" | "face") => commerceModelCatalog.find((item) => item.id === id)?.image || "";

type Filter = { gender: "all" | CommerceModelProfile["gender"]; age: "all" | CommerceModelProfile["age"]; country: string };

/** 内置真人模特库：中国、美国、印度、日本、欧洲的成人、银发与儿童模特；悬浮显示特写，选中后放进模特位。 */
export function TryOnModelLibrary({ open, room, selected, onClose, onPick }: { open: boolean; room: number; selected: string[]; onClose: () => void; onPick: (profile: CommerceModelProfile) => Promise<void> }) {
    const [filter, setFilter] = useState<Filter>({ gender: "all", age: "all", country: "all" });
    const [adding, setAdding] = useState("");
    const [query, setQuery] = useState("");
    const people = useMemo(() => commerceModelCatalog.filter((item) => item.kind === "person"), []);
    const countries = useMemo(() => [...new Set(people.map((item) => item.country))], [people]);
    const visible = people.filter(
        (item) =>
            (filter.gender === "all" || item.gender === filter.gender) &&
            (filter.age === "all" || item.age === filter.age) &&
            (filter.country === "all" || item.country === filter.country) &&
            `${item.name} ${item.description} ${item.country}`.includes(query.trim()),
    );
    const chip = <K extends keyof Filter>(key: K, value: Filter[K], label: string) => (
        <button key={`${key}-${value}`} type="button" className="ecs-chip" aria-pressed={filter[key] === value} onClick={() => setFilter((current) => ({ ...current, [key]: value }))}>
            {label}
        </button>
    );
    return (
        <AppModal open={open} title="真人模特库" footer={<Button onClick={onClose}>完成</Button>} width="min(880px, calc(100vw - 32px))" onCancel={onClose} centered className="ect-library-modal">
            <p className="ect-library-hint">每位模特是一张多视角角色卡（正面、侧面、斜侧与特写），只用于锁定长相和身材；成片只出现这一位模特。{room > 1 ? `还可以选 ${room} 位。` : ""}</p>
            <Input value={query} onChange={(event) => setQuery(event.target.value)} allowClear prefix={<Search size={16} />} aria-label="搜索模特" placeholder="搜索模特、国家或气质" />
            <div className="ect-library-filters">
                <div role="group" aria-label="性别">
                    {chip("gender", "all", "不限性别")}
                    {chip("gender", "female", "女")}
                    {chip("gender", "male", "男")}
                </div>
                <div role="group" aria-label="年龄">
                    {chip("age", "all", "不限年龄")}
                    {chip("age", "adult", "成人")}
                    {chip("age", "mature", "银发")}
                    {chip("age", "child", "儿童")}
                </div>
                <div role="group" aria-label="国家和地区">
                    {chip("country", "all", "全部市场")}
                    {countries.map((country) => chip("country", country, country))}
                </div>
            </div>
            <div className="ect-library-grid">
                {!visible.length ? <EmptyState title="没有找到匹配模特" description="试试其他国家、年龄或关键词。" /> : null}
                {visible.map((item, index) => {
                    const picked = selected.includes(item.id);
                    return (
                        <article key={item.id} className={`ect-library-card${picked ? " is-picked" : ""}`} style={{ animationDelay: `${index * 35}ms` }}>
                            <div className="ect-library-media">
                                <img className="is-front" src={thumb(item.id, "front")} alt={`${item.name}正面全身`} loading="lazy" decoding="async" />
                                <img className="is-face" src={thumb(item.id, "face")} alt={`${item.name}面部特写`} loading="lazy" decoding="async" />
                                {picked ? (
                                    <span className="ect-library-check">
                                        <Check size={14} />
                                    </span>
                                ) : null}
                            </div>
                            <strong>{item.name}</strong>
                            <small>{item.description}</small>
                            <Button
                                size="small"
                                type={picked ? "default" : "primary"}
                                icon={picked ? <Check size={13} /> : <Plus size={13} />}
                                loading={adding === item.id}
                                disabled={picked || Boolean(adding) || room <= 0}
                                onClick={() => {
                                    setAdding(item.id);
                                    void onPick(item).finally(() => setAdding(""));
                                }}
                            >
                                {picked ? "已选用" : "选用"}
                            </Button>
                        </article>
                    );
                })}
            </div>
        </AppModal>
    );
}
