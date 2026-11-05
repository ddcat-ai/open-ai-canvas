import { useMemo, useRef } from "react";

import { Select } from "@/components/ui/base/select";
import type { ArkUserSummary } from "@/services/api/ark-portraits";
import { useAdminUserOptions } from "../../components/use-admin-user-options";
import { arkUserLabel } from "./ark-admin-shared";

/** 平台素材组的授权用户：远程搜索用户，已选用户不在当前搜索结果里时保留名称。 */
export function ArkGrantUsersField({ value, onChange, known, disabled }: { value: string[]; onChange: (ids: string[]) => void; known?: ArkUserSummary[]; disabled?: boolean }) {
    const users = useAdminUserOptions(undefined);
    const labels = useRef(new Map<string, string>());
    for (const user of known || []) labels.current.set(user.id, arkUserLabel(user));
    for (const option of users.options) labels.current.set(option.value, option.label);
    const options = useMemo(() => {
        const merged = new Map(users.options.map((option) => [option.value, option]));
        for (const id of value) if (!merged.has(id)) merged.set(id, { value: id, label: labels.current.get(id) || id });
        return [...merged.values()];
    }, [users.options, value]);
    return (
        <Select
            mode="multiple"
            showSearch
            allowClear
            disabled={disabled}
            filterOption={false}
            loading={users.searching}
            onSearch={users.onSearch}
            options={options}
            value={value}
            onChange={(next) => onChange((next as string[]) || [])}
            placeholder="搜索用户名或昵称"
            ariaLabel="授权用户"
            className="w-full"
        />
    );
}
