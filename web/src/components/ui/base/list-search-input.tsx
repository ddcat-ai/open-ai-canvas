import { Input, type InputProps } from "antd";
import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "./list-search-input.css";

type ListSearchInputProps = Omit<InputProps, "value" | "defaultValue" | "onChange" | "onCompositionStart" | "onCompositionEnd"> & { value?: string; onValueChange: (value: string) => void };

export function ListSearchInput({ value = "", onValueChange, onKeyDown, allowClear = true, prefix, className, ...props }: ListSearchInputProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(value);
    const composing = useRef(false);
    const lastCommit = useRef(value);
    useEffect(() => {
        if (!composing.current) {
            lastCommit.current = value;
            setDraft(value);
        }
    }, [value]);

    const commit = (next: string) => {
        setDraft(next);
        if (composing.current || next === lastCommit.current) return;
        lastCommit.current = next;
        onValueChange(next);
    };

    return (
        <Input
            {...props}
            value={draft}
            className={cn("list-search-field", className)}
            allowClear={
                allowClear === true
                    ? {
                          clearIcon: (
                              <span className="inline-flex" title={t("account.layout.list.clearSearch")}>
                                  <X className="size-3.5" aria-hidden />
                                  <span className="sr-only">{t("account.layout.list.clearSearch")}</span>
                              </span>
                          ),
                      }
                    : allowClear
            }
            prefix={prefix ?? <Search className="size-4" aria-hidden />}
            onCompositionStart={() => {
                composing.current = true;
            }}
            onCompositionEnd={(event) => {
                composing.current = false;
                commit(event.currentTarget.value);
            }}
            onChange={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
                onKeyDown?.(event);
                if (event.defaultPrevented || event.key !== "Escape" || !draft || !allowClear || props.readOnly || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                event.preventDefault();
                event.stopPropagation();
                commit("");
            }}
        />
    );
}
