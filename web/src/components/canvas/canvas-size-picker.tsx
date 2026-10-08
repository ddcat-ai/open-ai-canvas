import { useRef, useState } from "react";
import { Select } from "@/components/ui/base/select";

type CanvasSizePickerProps = { value: string; className?: string; onChange: (value: string) => void };
const presets = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"];

export function CanvasSizePicker({ value, className, onChange }: CanvasSizePickerProps) {
    const [query, setQuery] = useState("");
    const [expanded, setExpanded] = useState(false);
    const draft = useRef("");
    const options = [...new Set([...presets, value, query.trim()].filter(Boolean))].map((option) => ({ label: option, value: option }));
    const commit = (text: string) => {
        const next = text.trim();
        draft.current = "";
        setQuery("");
        setExpanded(false);
        if (next && next !== value) onChange(next);
    };
    return (
        <div className={className} data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
            <Select
                ariaLabel="生成比例"
                className="canvas-compact-control canvas-control-select h-full w-full"
                placeholder="比例"
                showSearch
                value={value || undefined}
                options={options}
                searchValue={query}
                open={expanded}
                popupMatchSelectWidth={false}
                onSearch={(text) => {
                    draft.current = text;
                    setQuery(text);
                }}
                onOpenChange={setExpanded}
                onChange={commit}
                onBlur={() => {
                    if (draft.current.trim()) commit(draft.current);
                    else setExpanded(false);
                }}
                onInputKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter" && draft.current.trim()) {
                        event.preventDefault();
                        commit(draft.current);
                    }
                    if (event.key === "Escape") {
                        draft.current = "";
                        setQuery("");
                        setExpanded(false);
                    }
                }}
                popupRender={(menu) => (
                    <div onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
                        {menu}
                    </div>
                )}
            />
        </div>
    );
}
