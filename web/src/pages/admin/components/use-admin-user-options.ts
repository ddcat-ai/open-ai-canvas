import { App } from "antd";
import { useEffect, useRef, useState } from "react";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { listAdminUsers, type AdminUser } from "@/services/api/auth";

/**
 * 管理端「按用户筛选」下拉的远程搜索：已选用户不在新结果里时保留在首位，过期请求不覆盖新结果。
 */
export function useAdminUserOptions(selectedUserId: string | undefined) {
    const { message } = App.useApp();
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [search, setSearch] = useState("");
    const [searching, setSearching] = useState(false);
    const debouncedSearch = useDebouncedValue(search.trim(), 250);
    const requestRef = useRef(0);

    useEffect(() => {
        const requestId = ++requestRef.current;
        setSearching(true);
        void listAdminUsers({ keyword: debouncedSearch || undefined, page: 1, pageSize: 50 })
            .then((result) => {
                if (requestId !== requestRef.current) return;
                setUsers((current) => {
                    const selected = current.find((user) => user.id === selectedUserId);
                    if (selected && !result.users.some((user) => user.id === selected.id)) return [selected, ...result.users];
                    return result.users;
                });
            })
            .catch((error) => {
                if (requestId === requestRef.current) message.error(error instanceof Error ? error.message : "搜索用户失败");
            })
            .finally(() => {
                if (requestId === requestRef.current) setSearching(false);
            });
    }, [debouncedSearch, message, selectedUserId]);

    return {
        options: users.map((user) => ({ value: user.id, label: user.displayName ? `${user.displayName}（${user.username}）` : user.username })),
        searching,
        onSearch: setSearch,
    };
}
