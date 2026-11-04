import type { EcommerceDraft } from "@/services/api/ecommerce";

export type CommerceModelProfile = {
    id: string;
    name: string;
    kind: "person" | "mannequin";
    gender: "female" | "male";
    age: "child" | "adult" | "mature";
    country: string;
    image: string;
    description: string;
};

const profile = (id: string, name: string, kind: CommerceModelProfile["kind"], gender: CommerceModelProfile["gender"], age: CommerceModelProfile["age"], country: string, description: string): CommerceModelProfile => ({
    id,
    name,
    kind,
    gender,
    age,
    country,
    image: `/ecommerce-models/${id}.png`,
    description,
});

export const commerceModelCatalog: CommerceModelProfile[] = [
    profile("cn-woman", "中国 · 成熟女模", "person", "female", "adult", "中国", "专业商业时装模特，适合女装、美妆与生活方式"),
    profile("cn-man", "中国 · 成熟男模", "person", "male", "adult", "中国", "专业商业时装模特，适合男装、配饰与生活方式"),
    profile("us-man", "美国 · 成熟男模", "person", "male", "adult", "美国", "专业商业时装模特，适合运动、男装与国际市场"),
    profile("in-woman", "印度 · 成熟女模", "person", "female", "adult", "印度", "专业商业时装模特，适合服装、美妆与南亚市场"),
    profile("eu-woman", "欧洲 · 成熟女模", "person", "female", "adult", "欧洲", "专业商业时装模特，适合女装与国际品牌"),
    profile("eu-senior-man", "欧洲 · 银发男模", "person", "male", "mature", "欧洲", "专业银发商业模特，适合成熟客群"),
    profile("jp-senior-woman", "日本 · 银发女模", "person", "female", "mature", "日本", "专业银发商业模特，适合成熟客群"),
    profile("cn-girl", "中国 · 女童模特", "person", "female", "child", "中国", "专业童装模特，造型与展示均符合儿童年龄"),
    profile("us-boy", "美国 · 男童模特", "person", "male", "child", "美国", "专业童装模特，造型与展示均符合儿童年龄"),
    profile("mannequin-woman", "女装 · 成人假人", "mannequin", "female", "adult", "通用", "专业服装陈列假人，正面、侧面、背面与细节"),
    profile("mannequin-man", "男装 · 成人假人", "mannequin", "male", "adult", "通用", "专业服装陈列假人，正面、侧面、背面与细节"),
    profile("mannequin-girl", "女童 · 儿童假人", "mannequin", "female", "child", "通用", "儿童服装陈列假人，正面、侧面、背面与细节"),
    profile("mannequin-boy", "男童 · 儿童假人", "mannequin", "male", "child", "通用", "儿童服装陈列假人，正面、侧面、背面与细节"),
    profile("mannequin-senior-woman", "银发女装 · 假人", "mannequin", "female", "mature", "通用", "成熟身形服装陈列假人，正面、侧面、背面与细节"),
];

export const commerceModelById = (id?: string) => commerceModelCatalog.find((item) => item.id === id);

export function suggestCommerceModel(draft: EcommerceDraft): CommerceModelProfile {
    const context = `${draft.productName} ${draft.category} ${draft.audience} ${draft.description} ${draft.instruction}`.toLowerCase();
    const child = /童装|儿童|男童|女童|child|kids|baby/.test(context);
    const mature = /老年|银发|中老年|长者|senior|mature/.test(context);
    const male = /男装|男士|男款|男童|剃须|men|mens|boy/.test(context);
    const female = /女装|女士|女款|女童|裙|美妆|护肤|women|womens|girl/.test(context);
    const mannequin = /假人|人台|陈列|mannequin/.test(context);
    if (child) return commerceModelById(mannequin ? (male && !female ? "mannequin-boy" : "mannequin-girl") : male && !female ? "us-boy" : "cn-girl")!;
    if (mannequin) return commerceModelById(male && !female ? "mannequin-man" : mature ? "mannequin-senior-woman" : "mannequin-woman")!;
    if (mature) return commerceModelById(male && !female ? "eu-senior-man" : "jp-senior-woman")!;
    if (male && !female) return commerceModelById(draft.language.startsWith("en") ? "us-man" : "cn-man")!;
    if (draft.language.startsWith("hi")) return commerceModelById("in-woman")!;
    if (draft.language.startsWith("en")) return commerceModelById("eu-woman")!;
    return commerceModelById("cn-woman")!;
}
