import { useMemo, useState } from "react";
import { AutoComplete, type AutoCompleteProps } from "antd";
import { useAdminContext } from "../admin-context";

/** 单模型与批量编辑共用系统渠道的一级目录名称。 */
export function ModelDisplayNameInput({ onSearch, onFocus, onOpenChange, placeholder = "选择已有分组或输入新名称，默认为未分类", ...props }: Omit<AutoCompleteProps, "options" | "filterOption">) {
    const { references } = useAdminContext();
    const [search, setSearch] = useState("");
    const options = useMemo(() => [...new Set(["未分类", ...references.channels.flatMap((item) => item.modelDisplayNames ?? [])])].sort((a, b) => a.localeCompare(b, "zh-CN")).map((value) => ({ value })), [references.channels]);
    return (
        <AutoComplete
            {...props}
            options={options}
            filterOption={(_, option) => Boolean(option?.value.toLowerCase().includes(search.trim().toLowerCase()))}
            onSearch={(value) => {
                setSearch(value);
                onSearch?.(value);
            }}
            onFocus={(event) => {
                setSearch("");
                onFocus?.(event);
            }}
            onOpenChange={(open) => {
                if (open) setSearch("");
                onOpenChange?.(open);
            }}
            placeholder={placeholder}
            allowClear
        />
    );
}
