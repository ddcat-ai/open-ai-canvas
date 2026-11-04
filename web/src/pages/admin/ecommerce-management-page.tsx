import { lazy, Suspense, useMemo } from "react";
import { Skeleton } from "antd";
import { useLocation, useNavigate } from "react-router";
import { AdminPageFrame } from "./components/admin-shell";
import { AdminSegmented } from "./ui/controls";
import "./ecommerce-management.css";

const EcommerceKnowledgePage = lazy(() => import("./ecommerce-knowledge-page"));
const EcommerceSkillsPage = lazy(() => import("./ecommerce-skills-page"));
const EcommerceCategoriesPage = lazy(() => import("./ecommerce-categories-page"));

const tabs = [
    { value: "knowledge", label: "视觉知识库", path: "/admin/ecommerce/library" },
    { value: "skills", label: "创作 Skills", path: "/admin/ecommerce/library/skills" },
    { value: "categories", label: "行业品类", path: "/admin/ecommerce/library/categories" },
] as const;

type Tab = (typeof tabs)[number]["value"];

/** 电商 Agent 策划时依赖的知识、技能方法与行业品类；运行开关与模型在「电商 Agent 配置」。 */
export default function EcommerceManagementPage() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const active = useMemo<Tab>(() => (pathname.endsWith("/skills") ? "skills" : pathname.endsWith("/categories") ? "categories" : "knowledge"), [pathname]);

    return (
        <AdminPageFrame
            title="知识与技能"
            description="电商 Agent 策划时检索的视觉知识、调用的创作 Skills，以及按商品定位方法的行业品类。"
            actions={
                <AdminSegmented<Tab>
                    ariaLabel="知识与技能视图"
                    value={active}
                    onChange={(value) => {
                        const target = tabs.find((tab) => tab.value === value);
                        if (target) navigate(target.path, { replace: true });
                    }}
                    options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
                />
            }
            scroll
        >
            <div className="eal-page">
                <Suspense fallback={<Skeleton active paragraph={{ rows: 8 }} />}>
                    {active === "knowledge" ? <EcommerceKnowledgePage /> : null}
                    {active === "skills" ? <EcommerceSkillsPage /> : null}
                    {active === "categories" ? <EcommerceCategoriesPage /> : null}
                </Suspense>
            </div>
        </AdminPageFrame>
    );
}
