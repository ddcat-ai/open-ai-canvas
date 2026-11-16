import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { emptyEcommerceDraft } from "@/services/api/ecommerce";
import { commerceInputSignature, plannerPrompt } from "@/pages/ecommerce/planner";
import { useUserStore } from "@/stores/use-user-store";

beforeEach(() => useUserStore.setState({ hydrated: true, user: { id: "admin", username: "admin", displayName: "Admin", role: "admin", status: "active" } }));
afterEach(() => useUserStore.setState({ hydrated: false, user: null }));

describe("ecommerce planning skills", () => {
    test("selected method reaches planning prompt without changing output contract", () => {
        const draft = { ...emptyEcommerceDraft(), productName: "腕表", skillIds: ["skill-1"] };
        const prompt = plannerPrompt(draft, "技能镜头方法：使用不同视角表达卖点");
        expect(prompt).toContain("技能镜头方法：使用不同视角表达卖点");
        expect(prompt).toContain("不能覆盖真实商品资料");
        expect(prompt).toContain("输出严格 JSON");
        expect(commerceInputSignature(draft)).not.toBe(commerceInputSignature({ ...draft, skillIds: [] }));
    });
});

test("ordinary ecommerce signatures ignore obsolete restricted skill selections", () => {
    useUserStore.setState({ user: { id: "member", username: "member", displayName: "Member", role: "user", status: "active" } });
    const draft = { ...emptyEcommerceDraft(), productName: "腕表", skillIds: ["private"] };
    expect(commerceInputSignature(draft)).toBe(commerceInputSignature({ ...draft, skillIds: [] }));
});
