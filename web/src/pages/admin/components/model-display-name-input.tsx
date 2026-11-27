import { useMemo, useState } from "react";
import { AutoComplete, type AutoCompleteProps } from "antd";
import { useAdminContext } from "../admin-context";
import { useConfigStore } from "@/stores/use-config-store";
import { displayGroupComparator } from "@/lib/model-display-order";

/** 单模型与批量编辑共用系统渠道的一级目录名称。 */
export function ModelDisplayNameInput({ onSearch, onFocus, onOpenChange, placeholder = "选择已有分组或输入新名称，默认为未分类", ...props }: Omit<AutoCompleteProps, "options" | "filterOption">) {
    const { references } = useAdminContext();
    const [search, setSearch] = useState("");
    const order = useConfigStore((state) => state.config.displayGroupOrder);
    const options = useMemo(() => [...new Set([...(order ?? []), "未分类", ...references.channels.flatMap((item) => item.modelDisplayNames ?? [])])]
        .sort(displayGroupComparator(order ?? [])).map((value) => ({ value })), [order, references.channels]);
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
