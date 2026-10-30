package prompts

import (
	"embed"
	"strings"
)

// 世界引擎 Agent 说明书：行为规范与多场景操作手册。
// 只通过 previs_scene_read 的 manual 参数按需返回给 Agent（工具参考资料），不拼进 system 提示词。
//
//go:embed previs-manual/*.md
var previsManualFiles embed.FS

type PrevisManualTopic struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	When  string `json:"when"`
}

// previsManualTopics 是说明书目录与推荐阅读顺序；When 告诉 Agent 什么时候该读哪一篇。
var previsManualTopics = []PrevisManualTopic{
	{ID: "rules", Title: "行为规范", When: "第一次操作世界引擎前必读：先读后写、坐标与地面 0 米、用对工具、不确定就问、写完自检"},
	{ID: "setup", Title: "搭场景", When: "搭外景、内景、街区城镇、批量道具"},
	{ID: "actors", Title: "摆人物与调度", When: "加人物、朝向、对话站位与轴线、原地动作"},
	{ID: "move", Title: "人物移动", When: "A→B、沿路线、飞行与离地高度、速率与运动规律"},
	{ID: "paths", Title: "用户画的轨迹", When: "用户提到画的轨迹、路径1、运镜轨迹，或要人物沿运镜轨迹走、镜头跟随"},
	{ID: "camera", Title: "机位与景别", When: "放摄影机、定景别焦段距离、机位高度与构图"},
	{ID: "moves", Title: "运镜", When: "推拉摇移、环绕、跟拍、大师手法、用户口语对应的手法"},
	{ID: "shots", Title: "镜头设计", When: "用户要电影感、高级运镜、某位导演的手法或多节拍镜头时必读：节拍表、质量底线、recipe 起手、过肩跟随转面部特写范例、常见偷懒写法"},
	{ID: "edit", Title: "修改与删除", When: "删除或修改运镜、路径、动作、对象、镜头"},
	{ID: "output", Title: "预览与自检", When: "写完核对、白模预览、交付视频生成"},
	{ID: "recipes", Title: "完整范例 · 文戏", When: "可原样执行的完整做法（搭景、表演、多段运镜、画面质感提示词）：走廊过肩跟随转面部特写、双人对话三机位、顿悟眩晕变焦、雨夜抽离、物到人揭示、竖屏短剧亮相；第 0 节是所有范例的用法与按用户说法选范例"},
	{ID: "recipes_action", Title: "完整范例 · 动作戏", When: "古街追逐、庭院打斗（环绕+急推+震屏）、御剑飞行、爆炸逃生"},
	{ID: "recipes_epic", Title: "完整范例 · 大场面", When: "开场航拍揭示古城、将军阅兵群戏、雨夜重逢环绕"},
}

func PrevisManualTopics() []PrevisManualTopic {
	return append([]PrevisManualTopic(nil), previsManualTopics...)
}

// PrevisManual 返回一篇说明书正文；topic 不存在时 ok=false。
func PrevisManual(topic string) (PrevisManualTopic, string, bool) {
	wanted := strings.TrimSpace(topic)
	for _, item := range previsManualTopics {
		if item.ID != wanted {
			continue
		}
		content, err := previsManualFiles.ReadFile("previs-manual/" + item.ID + ".md")
		if err != nil {
			return PrevisManualTopic{}, "", false
		}
		return item, string(content), true
	}
	return PrevisManualTopic{}, "", false
}
