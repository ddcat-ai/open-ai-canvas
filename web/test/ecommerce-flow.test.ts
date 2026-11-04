import { expect, test } from "bun:test";
import { commerceFlowNextStep, resolveCommerceFlow, type CommerceFlowInput } from "../src/pages/ecommerce/flow";

const base: CommerceFlowInput = {
    direct: false,
    hasProduct: false,
    hasInstruction: false,
    directionsLoading: false,
    directionsReady: false,
    directionChosen: false,
    planningPending: false,
    planReady: false,
    planCount: 0,
    submitted: 0,
    completed: 0,
    failed: 0,
    active: 0,
};
const current = (input: Partial<CommerceFlowInput>) => resolveCommerceFlow({ ...base, ...input }).find((step) => step.status === "current");

test("walks the five steps from material to delivery", () => {
    expect(current({})?.key).toBe("material");
    expect(current({ hasProduct: true, hasInstruction: true })?.key).toBe("direction");
    expect(current({ hasProduct: true, hasInstruction: true, directionsLoading: true })).toMatchObject({ key: "direction", running: true });
    expect(current({ hasProduct: true, hasInstruction: true, directionsReady: true })?.detail).toContain("选一套视觉方向");
    expect(current({ hasProduct: true, directionChosen: true, planningPending: true })).toMatchObject({ key: "plan", running: true });
    expect(current({ hasProduct: true, planReady: true, planCount: 8 })?.detail).toContain("方案共 8 张");
    expect(current({ hasProduct: true, planReady: true, planCount: 8, submitted: 8, completed: 3, active: 5, failed: 0 })).toMatchObject({ key: "generate", running: true, detail: "已完成 3 / 8 张" });
    const delivered = resolveCommerceFlow({ ...base, hasProduct: true, planReady: true, planCount: 8, submitted: 8, completed: 8 });
    expect(delivered.map((step) => step.status)).toEqual(["done", "done", "done", "done", "current"]);
});

test("a follow-up round goes back to directions while the delivered round stays visible", () => {
    const steps = resolveCommerceFlow({ ...base, hasProduct: true, planCount: 8, submitted: 8, completed: 8, directionsLoading: true });
    expect(steps.find((step) => step.status === "current")?.key).toBe("direction");
});

test("failed images are counted and direct projects skip directions and plans", () => {
    expect(current({ hasProduct: true, planCount: 4, submitted: 4, completed: 2, failed: 2 })?.detail).toBe("已完成 2 / 4 张，2 张失败可重试");
    const direct = resolveCommerceFlow({ ...base, direct: true, hasProduct: true, hasInstruction: true });
    expect(direct.map((step) => step.key)).toEqual(["material", "generate", "deliver"]);
    expect(commerceFlowNextStep(direct)).toContain("直接按设置出图");
});
