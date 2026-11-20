import { useEffect, useMemo, useState } from "react";
import { useSkillLibraryAccess } from "@/lib/skill-access";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";

import { listAddedSkills, type Skill } from "@/services/api/skills";
import { SKILL_RUNTIME_PROFILES, type SkillRuntimeProfile } from "@/services/skill-runtime";
import { Select } from "@/components/ui/base/select";

export function useSkillRuntimeCatalog() {
    const allowed = useSkillLibraryAccess();
    const userId = useUserStore((state) => state.user?.id);
    const [ownerId, setOwnerId] = useState<string>();
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        setSkills([]);
        setOwnerId(userId);
        setLoading(allowed);
        if (!allowed) return;
        let cancelled = false;
        listAddedSkills()
            .then((result) => {
                if (!cancelled) setSkills(result.skills.filter((skill) => skill.isAdded));
            })
            .catch(() => {
                if (!cancelled) setSkills([]);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [allowed, userId]);

    return { skills: allowed && ownerId === userId ? skills : [], loading: allowed && loading };
}

export function SkillRuntimePicker({
    skills,
    loading,
    value,
    onChange,
    placeholder,
    profile = "canvas",
}: {
    skills: Skill[];
    loading?: boolean;
    value: string[];
    onChange: (skillIds: string[]) => void;
    placeholder?: string;
    profile?: SkillRuntimeProfile;
}) {
    const { t } = useTranslation();
    const allowed = useSkillLibraryAccess();
    const hydrated = useUserStore((state) => state.hydrated);
    useEffect(() => {
        if (hydrated && !allowed && value.length) onChange([]);
    }, [allowed, hydrated, onChange, value]);
    const options = useMemo(() => skills.map((skill) => ({ value: skill.skillId, label: skill.skillName, title: skill.description })), [skills]);
    const maxSkills = SKILL_RUNTIME_PROFILES[profile].maxSkills;

    if (!allowed) return null;
    return (
        <Select
            className="w-full"
            style={{ width: "100%" }}
            mode="multiple"
            allowClear
            showSearch
            maxCount={maxSkills || undefined}
            maxTagCount="responsive"
            loading={loading}
            value={value}
            placeholder={placeholder ?? t("library.skills.runtime.placeholder")}
            optionFilterProp="label"
            options={options}
            onChange={onChange}
            notFoundContent={loading ? t("library.skills.runtime.loading") : t("library.skills.runtime.empty")}
            aria-label={t("library.skills.runtime.ariaLabel")}
        />
    );
}
