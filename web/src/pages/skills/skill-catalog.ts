import { formatLocale } from "@/lib/format-locale";
import { t } from "@/i18n";
import type { Skill, SkillCategory } from "@/services/api/skills";

export const fallbackSkillCategories: SkillCategory[] = [
    { value: "drama", label: t("skills:short-drama-and-film") },
    { value: "ecommerce", label: t("skills:e-commerce-marketing") },
    { value: "creative", label: t("skills:creative-design") },
    { value: "social", label: t("skills:social-media-content") },
    { value: "others", label: t("skills:other") },
];

export function skillCategoryLabel(value: string, categories: SkillCategory[] = fallbackSkillCategories) {
    return categories.find((item) => item.value === value)?.label || t("skills:other");
}

export function groupSkills(skills: Skill[], categories: SkillCategory[]) {
    const ordered = categories.length ? categories : fallbackSkillCategories;
    return ordered.map((category) => ({ ...category, skills: skills.filter((skill) => skill.tag === category.value) })).filter((group) => group.skills.length > 0);
}

export function formatSkillCount(value: number) {
    return new Intl.NumberFormat(formatLocale(), { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatSkillDate(value: number) {
    return new Intl.DateTimeFormat(formatLocale(), { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}
