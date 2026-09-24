package app

import (
	"fmt"
	"strings"
)

// cloudAgentScenarioRule 定义一个短剧视听创作场景及其上游种子技能映射。
//
// 推荐位约定：RecommendedSkills 一律填种子市场的 skill_id（与 skills.json 的
// skill_id 字段一致，编号一经分配永不变更）。官方短剧技能与 judian 工位技能
// （S1-S6 = 16000000000115-120，E0-E6 = 16000000000108-114）同批上架，一并映射；
// 关键词避免单字泛词（如裸「第」「集」会命中「第一次」「集合」），保证路由精度。
type cloudAgentScenarioRule struct {
	ID                string   // 场景标识
	Name              string   // 中文场景名
	Keywords          []string // 触发特征词
	Principles        string   // 导演级视听方法论要义
	RecommendedSkills []string // 推荐的种子技能ID
	TargetCards       []string // 目标技能名（人工可读）
}

// builtinScenarioRules 源起·剧典核心场景规则库（短剧向）
var builtinScenarioRules = []cloudAgentScenarioRule{
	{
		ID:   "drama_structure",
		Name: "短剧结构策划与节奏卡点",
		Keywords: []string{
			"大纲", "故事大纲", "分集", "短剧", "策划", "卡点",
			"开篇", "钩子", "节律", "骨骼", "五段式",
		},
		Principles: "前3秒黄金视听热开篇抓人，30秒确立核心矛盾与主角人设；集尾必须设置强悬念卡点与情绪反转；整体遵循五段式跌宕节律。",
		RecommendedSkills: []string{
			"14811816983052", "14811816983308", "14811816982796", "16000000000115",
		},
		TargetCards: []string{
			"故事开发", "三幕式短剧工厂", "剧本撰写", "短剧分镜表",
		},
	},
	{
		ID:   "dramatic_twist",
		Name: "戏剧冲突与预期反转",
		Keywords: []string{
			"反转", "打脸", "爽点", "预期违背", "冲突", "误会", "错位",
			"身份错位", "悬念", "情绪拉扯", "三点一线",
		},
		Principles: "反转必须建立在扎实的铺垫与观众预期违背之上；合理利用信息不对称与身份错位；痛点蓄力越深，爽点爆发越强烈，严禁机械无逻辑反转。",
		RecommendedSkills: []string{
			"14811816983052", "14811816970252", "16000000000115",
		},
		TargetCards: []string{
			"故事开发", "剧本资产视频一条龙创作", "短剧分镜表",
		},
	},
	{
		ID:   "cinematography_directing",
		Name: "导演分镜与机位调度",
		Keywords: []string{
			"分镜", "镜头", "机位", "轴线", "景深", "特写", "全景",
			"中景", "视听", "构图", "运镜", "蒙太奇", "声画契约", "光影",
		},
		Principles: "每个镜头必须具备明确的叙事动机；严格遵守180度机位轴线法则；特写抓微表情传达内心，全景交代空间与权力关系；音画契约强化情绪张力。",
		RecommendedSkills: []string{
			"14811816970508", "14811816970252", "16000000000115", "16000000000117",
		},
		TargetCards: []string{
			"叙事短片导演分镜", "剧本资产视频一条龙创作", "短剧分镜表", "影视提示词编译",
		},
	},
	{
		ID:   "character_dialogue",
		Name: "角色人设与台词潜台词",
		Keywords: []string{
			"人设", "角色", "台词", "对白", "潜台词", "主角", "配角",
			"反派", "性格反差", "人物弧光", "共情",
		},
		Principles: "拒绝脸谱化，角色必须具备核心缺陷与执念；台词精炼且富含生活化动作，潜台词重于表面字义；用行动和关键抉择展现人物弧光。",
		RecommendedSkills: []string{
			"14811816982284", "14811816982796", "16000000000116",
		},
		TargetCards: []string{
			"角色设计", "剧本撰写", "角色资产板",
		},
	},
}

// scenarioPreRoutingResult 场景预路由分析结果
type scenarioPreRoutingResult struct {
	ScenarioID        string   `json:"scenarioId"`
	ScenarioName      string   `json:"scenarioName"`
	Score             int      `json:"score"`
	Principles        string   `json:"principles"`
	RecommendedSkills []string `json:"recommendedSkills"`
	MatchedSkillFiles []string `json:"matchedSkillFiles"`
}

// resolveScenarioPreRouting 自动分析创作输入并与已启用技能匹配
func resolveScenarioPreRouting(prompt string, skills []cloudAgentSkill) *scenarioPreRoutingResult {
	trimmed := strings.TrimSpace(prompt)
	if trimmed == "" {
		return nil
	}
	lower := strings.ToLower(trimmed)

	var bestRule *cloudAgentScenarioRule
	maxScore := 0

	for i := range builtinScenarioRules {
		rule := &builtinScenarioRules[i]
		score := 0
		for _, kw := range rule.Keywords {
			if strings.Contains(lower, kw) {
				score += 2
			}
		}
		if score > maxScore && score >= 2 {
			maxScore = score
			bestRule = rule
		}
	}

	if bestRule == nil {
		return nil
	}

	result := &scenarioPreRoutingResult{
		ScenarioID:        bestRule.ID,
		ScenarioName:      bestRule.Name,
		Score:             maxScore,
		Principles:        bestRule.Principles,
		RecommendedSkills: bestRule.RecommendedSkills,
		MatchedSkillFiles: make([]string, 0),
	}

	// 检查当前启用的技能中是否包含推荐技能及其具体可读文件
	skillMap := make(map[string]cloudAgentSkill, len(skills))
	for _, sk := range skills {
		skillMap[sk.ID] = sk
	}

	for _, recID := range bestRule.RecommendedSkills {
		if sk, ok := skillMap[recID]; ok {
			// 将该技能入口和卡路径纳入推荐
			paths := cloudAgentSkillPaths(sk)
			for _, p := range paths {
				result.MatchedSkillFiles = append(result.MatchedSkillFiles, fmt.Sprintf("%s [%s] (%s)", sk.Name, sk.ID, p))
			}
		}
	}

	return result
}

// formatScenarioRoutingGuide 生成注入到系统提示词中的导演律法导语
func formatScenarioRoutingGuide(res *scenarioPreRoutingResult) string {
	if res == nil {
		return ""
	}
	var sb strings.Builder
	sb.WriteString("\n【源起·剧典 场景自适应导演律法 (Genesis Judian Directing Rules)】\n")
	sb.WriteString(fmt.Sprintf("- 识别当前创作场景：%s\n", res.ScenarioName))
	sb.WriteString(fmt.Sprintf("- 核心工业化视听原则：%s\n", res.Principles))

	if len(res.MatchedSkillFiles) > 0 {
		sb.WriteString("- 本轮已挂载匹配的剧典知识卡（建议优先用 skill_read_file 精确调取）：\n")
		count := 0
		for _, fileRef := range res.MatchedSkillFiles {
			sb.WriteString(fmt.Sprintf("  * %s\n", fileRef))
			count++
			if count >= 6 {
				break
			}
		}
	} else {
		sb.WriteString("- 推荐参考剧典方法论：" + strings.Join(res.RecommendedSkills, "、") + "。\n")
	}
	sb.WriteString("要求：在执行剧本、大纲或分镜输出时，严格结合上述视听规范，杜绝空洞平庸。\n")
	return sb.String()
}
