import { Input } from "antd";
import { Search } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import "./choice-browser.css";

export type BrowserChoice = {
    value: string;
    label: string;
    subtitle?: string;
    vendor?: string;
    searchText?: string;
    disabled?: boolean;
    details: Array<{ label: string; value: ReactNode }>;
};

/** A controlled form field: searching never changes the selected value. */
export function ChoiceBrowser({
    value,
    onChange,
    options,
    label,
    placeholder = "搜索名称、来源或请求路径",
    loading = false,
    error = "",
    disabled = false,
    id,
    ...aria
}: {
    value?: string;
    onChange?: (value: string) => void;
    options: BrowserChoice[];
    label: string;
    placeholder?: string;
    loading?: boolean;
    error?: string;
    disabled?: boolean;
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean | "true" | "false";
}) {
    const name = useId();
    const [query, setQuery] = useState("");
    const selected = options.find((option) => option.value === value);
    const normalizedQuery = query.trim().toLowerCase();
    const visible = options.filter((option) => [option.label, option.subtitle, option.vendor, option.searchText].join(" ").toLowerCase().includes(normalizedQuery));
    const unavailable = disabled || loading || Boolean(error);

    return (
        <div className="choice-browser">
            <Input id={id} {...aria} allowClear aria-label={`搜索${label}`} disabled={unavailable} prefix={<Search className="size-3.5" aria-hidden="true" />} placeholder={placeholder} value={query} onChange={(event) => setQuery(event.target.value)} />
            {loading || error || !options.length ? (
                <div className="choice-browser-state" role={error ? "alert" : "status"}>
                    {loading ? "正在读取可选项…" : error || "暂无可用选项"}
                </div>
            ) : (
                <div className="choice-browser-panels">
                    <div className="choice-browser-list" role="radiogroup" aria-label={label}>
                        {visible.map((option) => (
                            <label key={option.value} className="choice-browser-option" data-selected={option.value === value}>
                                <span className="choice-browser-main">
                                    <strong>{option.label}</strong>
                                    <span title={option.subtitle}>{option.subtitle}</span>
                                </span>
                                <span className="choice-browser-vendor" title={option.vendor}>
                                    {option.vendor}
                                </span>
                                <input type="radio" name={name} value={option.value} checked={option.value === value} disabled={unavailable || option.disabled} onChange={() => onChange?.(option.value)} />
                            </label>
                        ))}
                        {!visible.length && (
                            <div className="choice-browser-state" role="status">
                                没有匹配的选项
                            </div>
                        )}
                    </div>
                    <div className="choice-browser-detail" aria-live="polite">
                        <span>当前选择</span>
                        {selected ? (
                            <>
                                <strong>{selected.label}</strong>
                                <dl>
                                    {selected.details.map((detail) => (
                                        <div key={detail.label}>
                                            <dt>{detail.label}</dt>
                                            <dd>{detail.value}</dd>
                                        </div>
                                    ))}
                                </dl>
                            </>
                        ) : (
                            <p>{value ? `当前配置 ${value} 不在可用目录中，请重新选择。` : "选择左侧选项查看详情"}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
