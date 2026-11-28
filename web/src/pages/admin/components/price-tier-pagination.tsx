import { Pagination } from "antd";
import { useId, useLayoutEffect, useState } from "react";

// 一档包含多组输入，翻页时卸载控件，完整值留在各自的 Form.List 中。
const pageSize = 4;

export function usePriceTierPagination(count: number) {
    const prefix = useId();
    const [requestedPage, setPage] = useState(1);
    const [target, setTarget] = useState<number | null>(null);
    const page = Math.min(requestedPage, Math.max(1, Math.ceil(count / pageSize)));
    useLayoutEffect(() => {
        if (requestedPage !== page) setPage(page);
        if (target === null) return;
        document.getElementById(`${prefix}-tier-${target}`)?.focus();
        setTarget(null);
    }, [page, prefix, requestedPage, target]);
    const reveal = (index: number) => {
        setPage(Math.floor(index / pageSize) + 1);
        setTarget(index);
    };
    const start = (page - 1) * pageSize;
    return {
        start,
        end: start + pageSize,
        reveal,
        rowId: (index: number) => `${prefix}-tier-${index}`,
        controls: <Pagination aria-label="价格档分页" current={page} total={count} pageSize={pageSize} showSizeChanger={false} hideOnSinglePage onChange={(next) => reveal((next - 1) * pageSize)} />,
    };
}
