import { useEffect, useMemo, useState } from "react";
import { Select } from "antd";

import { listAddedSkills, type Skill } from "@/services/api/skills";
import { SKILL_RUNTIME_PROFILES, type SkillRuntimeProfile } from "@/services/skill-runtime";

export function useSkillRuntimeCatalog() {
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        listAddedSkills()
            .then((result) => {
                if (!cancelled) setSkills(result.skills.filter((skill) => skill.is_added));
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
    }, []);

    return { skills, loading };
}

export function SkillRuntimePicker({ skills, loading, value, onChange, placeholder = "选择本次生成使用的技能", profile = "canvas" }: { skills: Skill[]; loading?: boolean; value: string[]; onChange: (skillIds: string[]) => void; placeholder?: string; profile?: SkillRuntimeProfile }) {
    const options = useMemo(
        () => skills.map((skill) => ({ value: skill.skill_id, label: skill.skill_name, title: skill.description })),
        [skills],
    );
    const maxSkills = SKILL_RUNTIME_PROFILES[profile].maxSkills;

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
            placeholder={placeholder}
            optionFilterProp="label"
            options={options}
            onChange={onChange}
            notFoundContent={loading ? "正在读取技能库" : "暂无已加入的技能"}
            aria-label="本次生成使用的技能"
        />
    );
}
