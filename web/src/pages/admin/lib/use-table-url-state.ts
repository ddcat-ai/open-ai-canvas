import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";

export type TableUrlState = {
    filter: string;
    role: string;
    status: string;
    page: number;
    pageSize: number;
};

function positiveInteger(value: string | null, fallback: number) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function allowedValue(value: string | null, allowed: string[], fallback: string) {
    return value && allowed.includes(value) ? value : fallback;
}

export function useTableUrlState(defaultPageSize = 20) {
    const [searchParams, setSearchParams] = useSearchParams();
    const state = useMemo<TableUrlState>(() => ({
        filter: searchParams.get("filter") || "",
        role: allowedValue(searchParams.get("role"), ["all", "admin", "user"], "all"),
        status: allowedValue(searchParams.get("status"), ["all", "active", "disabled"], "all"),
        page: positiveInteger(searchParams.get("page"), 1),
        pageSize: [20, 50, 100].includes(positiveInteger(searchParams.get("pageSize"), defaultPageSize)) ? positiveInteger(searchParams.get("pageSize"), defaultPageSize) : defaultPageSize,
    }), [defaultPageSize, searchParams]);

    const update = useCallback((patch: Partial<TableUrlState>, replace = false) => {
        const next = new URLSearchParams(searchParams);
        const merged = { ...state, ...patch };
        const defaults: TableUrlState = { filter: "", role: "all", status: "all", page: 1, pageSize: defaultPageSize };
        (Object.keys(defaults) as Array<keyof TableUrlState>).forEach((key) => {
            const value = merged[key];
            if (value === defaults[key]) next.delete(key);
            else next.set(key, String(value));
        });
        setSearchParams(next, { replace });
    }, [defaultPageSize, searchParams, setSearchParams, state]);

    return { state, update };
}
