import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 规范生产源文件（后端embed的单一来源），test/fixtures不再作为生产来源
const SKILL_PATH = path.join(__dirname, "..", "..", "backend", "internal", "service", "seed", "skills", "storyboard-director.md");

function loadSkillContent(): string {
    // 去除markdown加粗标记，便于子串匹配
    return readFileSync(SKILL_PATH, "utf-8").replace(/\*\*/g, "");
}

// ============ 1. Skill可加载 ============
test("Skill契约: storyboard-director可通过现有机制加载", () => {
    const content = loadSkillContent();
    assert.ok(content.length > 1000, "Skill内容不应为空");
    assert.ok(content.includes("分镜导演"), "Skill应包含角色定位");
    assert.ok(content.includes("工作流契约"), "Skill应包含工作流契约");
});

// ============ 2. 语义优先顺序 ============
test("Skill契约: 引用语义优先工具序列", () => {
    const content = loadSkillContent();
    // 必须按顺序引用三个工具
    assert.ok(content.includes("project_get_context"), "应引用project_get_context");
    assert.ok(content.includes("project_create_or_update_shots"), "应引用project_create_or_update_shots");
    assert.ok(content.includes("canvas_create_storyboard_shots"), "应引用canvas_create_storyboard_shots");

    // 验证顺序：project_get_context 在 project_create_or_update_shots 之前
    const ctxPos = content.indexOf("project_get_context");
    const persistPos = content.indexOf("project_create_or_update_shots");
    const projectPos = content.indexOf("canvas_create_storyboard_shots");
    assert.ok(ctxPos < persistPos, "project_get_context应在project_create_or_update_shots之前");
    assert.ok(persistPos < projectPos, "project_create_or_update_shots应在canvas_create_storyboard_shots之前");
});

// ============ 3. 禁止直接媒体生成 ============
test("Skill契约: 明确禁止未经请求的媒体生成", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("禁止") && content.includes("生成"), "应包含禁止生成的表述");
    assert.ok(content.includes("只做分镜") || content.includes("先别生成图片"), "应包含用户说只做分镜时停止的场景");
    assert.ok(content.includes("canvas_generate_image"), "应明确禁止canvas_generate_image");
    assert.ok(content.includes("canvas_generate_video"), "应明确禁止canvas_generate_video");
    assert.ok(content.includes("不创建生成任务"), "应说明不创建生成任务");
});

// ============ 4. 先持久化再投影 ============
test("Skill契约: 明确要求先持久化再投影", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("必须先持久化，再投影"), "应明确要求先持久化再投影");
    assert.ok(content.includes("稳定的 shotId") || content.includes("稳定 shotId"), "应提到获取稳定shotId");
    assert.ok(content.includes("持久化后你会获得"), "应说明持久化后获得shotId");
});

// ============ 5. 尊重精确分镜数量 ============
test("Skill契约: 明确尊重用户指定的分镜数量", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("8个分镜") || content.includes("N个分镜"), "应提到分镜数量示例");
    assert.ok(content.includes("必须恰好"), "应明确要求恰好指定数量");
    assert.ok(content.includes("不要因为模型偏好更多细节"), "应禁止模型自行增加数量");
});

// ============ 6. 已有分镜身份保留 ============
test("Skill契约: 指示保留/更新已有分镜身份而非盲目重复", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("已有分镜处理"), "应包含已有分镜处理章节");
    assert.ok(content.includes("不要盲目追加重复分镜"), "应禁止盲目追加重复");
    assert.ok(content.includes("保留稳定的Shot ID") || content.includes("保留稳定shotId"), "应要求保留稳定ID");
    assert.ok(content.includes("upsert") || content.includes("更新语义"), "应提到使用upsert/更新语义");
});

// ============ 7. 连续性指导 ============
test("Skill契约: 包含连续性指导", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("连续性"), "应包含连续性章节");
    assert.ok(content.includes("角色在场"), "应提到角色在场连续性");
    assert.ok(content.includes("180度轴线") || content.includes("角色方向"), "应提到方向/轴线连续性");
    assert.ok(content.includes("动作衔接") || content.includes("匹配剪辑"), "应提到动作衔接");
    assert.ok(content.includes("情绪状态"), "应提到情绪状态连续性");
});

// ============ 8. 景别指导 ============
test("Skill契约: 包含景别选择指导", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("景别"), "应包含景别章节");
    assert.ok(content.includes("远景") || content.includes("建立镜头"), "应提到远景/建立镜头");
    assert.ok(content.includes("中景"), "应提到中景");
    assert.ok(content.includes("特写"), "应提到特写");
    assert.ok(content.includes("避免连续8个镜头使用基本相同的景别"), "应警告避免连续相同景别");
});

// ============ 9. 机位/运镜指导 ============
test("Skill契约: 包含机位角度与运镜指导", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("机位角度") || content.includes("机位"), "应包含机位章节");
    assert.ok(content.includes("运镜"), "应包含运镜章节");
    assert.ok(content.includes("静态镜头是有效且常更优的选择"), "应强调静态镜头的价值");
    assert.ok(content.includes("不要强迫每个镜头都有运镜"), "应禁止强迫每个镜头都有运镜");
    assert.ok(content.includes("仰视") && content.includes("俯视"), "应提到仰视和俯视");
});

// ============ 10. 时长/节奏指导 ============
test("Skill契约: 包含时长与节奏指导", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("时长") && content.includes("节奏"), "应包含时长与节奏章节");
    assert.ok(content.includes("不要默认每个镜头相同时长"), "应禁止默认相同时长");
    assert.ok(content.includes("建立镜头") && content.includes("更长"), "应提到建立镜头可以更长");
    assert.ok(content.includes("插入镜头") && content.includes("更短"), "应提到插入镜头可以更短");
    assert.ok(content.includes("总时长") && content.includes("合理分配"), "应提到总时长分配");
});

// ============ 11. 不计算画布坐标 ============
test("Skill契约: 不指示模型计算画布坐标", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("禁止") && content.includes("计算x/y坐标"), "应明确禁止计算x/y坐标");
    assert.ok(content.includes("手动创建通用文本节点"), "应禁止手动创建文本节点");
    assert.ok(content.includes("布局、碰撞避免、undo/redo由该工具和画布系统自动处理"), "应说明布局由系统自动处理");
    // 确认skill中没有出现具体的像素坐标计算指导
    assert.ok(!content.includes("position.x =") && !content.includes("position.y ="), "不应包含具体坐标计算");
});

// ============ 12. 叙事节拍指导 ============
test("Skill契约: 包含叙事节拍指导", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("叙事节拍"), "应包含叙事节拍章节");
    assert.ok(content.includes("不要按句子长度机械拆分剧本"), "应禁止机械拆分");
    assert.ok(content.includes("建立") && content.includes("Setup"), "应提到建立/Setup");
    assert.ok(content.includes("反应") && content.includes("Reaction"), "应提到反应/Reaction");
    assert.ok(content.includes("揭示") && content.includes("Reveal"), "应提到揭示/Reveal");
    assert.ok(content.includes("每个分镜都应该有存在的理由"), "应强调每个分镜有存在理由");
});

// ============ 13. 澄清策略 ============
test("Skill契约: 包含澄清策略（高影响才问）", () => {
    const content = loadSkillContent();
    assert.ok(content.includes("澄清策略"), "应包含澄清策略章节");
    assert.ok(content.includes("不要把技能变成问卷"), "应禁止变成问卷");
    assert.ok(content.includes("高影响歧义"), "应区分高影响歧义");
    assert.ok(content.includes("低影响歧义"), "应区分低影响歧义");
    assert.ok(content.includes("选择合理的电影制作默认值"), "低影响时应选择默认值");
});

// ============ 14. 内置技能JSON可验证 ============
test("Skill契约: 内置技能JSON中包含storyboard-director且字段完整", () => {
    const skillsJsonPath = path.join(__dirname, "..", "..", "backend", "internal", "service", "seed", "skills.json");
    const skills = JSON.parse(readFileSync(skillsJsonPath, "utf-8"));
    const skill = skills.find((s: { skill_id: string }) => s.skill_id === "storyboard-director");
    assert.ok(skill, "storyboard-director应在内置技能JSON中");
    assert.equal(skill.skill_name, "分镜导演");
    assert.equal(skill.status, 1);
    assert.equal(skill.is_private, false);
    assert.ok(skill.instruction.length > 1000, "instruction应有实质内容");
    assert.ok(skill.instruction.includes("工作流契约"), "instruction应包含工作流契约");
    assert.ok(skill.effective_user.name, "应有作者信息");
});
