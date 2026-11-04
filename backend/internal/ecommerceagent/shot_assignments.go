package ecommerceagent

import (
	"fmt"
	"strings"
)

// Every camera pair is different. Page count selects a complete narrative,
// rather than repeating a short list until the requested number is reached.
var shotGoals = []string{
	"一眼识别完整商品与核心购买理由", "通过真实操作解释一个可见功能", "突出一处真实表面材质细节", "展现轮廓与真实体积感", "呈现商品与使用环境的关系",
	"展示真实接触方式与操作起点", "解释可见连接处或边缘做工", "展现使用者的自然反馈", "回答收纳摆放或日常取用问题", "说明一个明确的使用步骤",
	"展示另一处不同的可见局部", "建立商品与常见物体的真实尺度关系", "呈现自然光下的真实颜色与质感", "捕捉使用过程中的关键动作", "展示另一个合理使用地点",
	"回答选购时容易忽略的外观信息", "呈现使用结束后的生活片刻", "以环境远景展示陪伴或日常价值", "整理卖家已经确认的商品信息", "用完整商品与实际用途收束购买决策",
}

var shotCameras = []string{
	"左前45°，俯角15°", "右前30°，平视0°", "左前15°，俯角35°", "右侧75°，俯角10°", "正面0°，俯角85°",
	"左前60°，轻仰10°", "右前55°，俯角25°", "左前25°，平视0°", "右前10°，俯角60°", "左前70°，俯角45°",
	"正面0°，俯角25°", "右前40°，俯角70°", "左前10°，轻仰5°", "右侧80°，平视0°", "左前35°，俯角50°",
	"右前20°，俯角40°", "左前50°，俯角65°", "右前65°，轻仰10°", "左侧80°，俯角20°", "正面0°，平视0°",
}

var shotScales = []string{"完整商品近景", "操作中景", "材质微距", "轮廓近景", "俯拍全景", "接触面特写", "边缘微距", "互动中景", "环境近景", "步骤特写", "第二局部微距", "尺度中景", "侧光近景", "动作特写", "环境宽景", "细节近景", "生活中景", "远景", "信息近景", "完整商品全景"}

var petScenes = []string{
	"宠物在软毯边探头发现商品，前景有轻微遮挡、后景有自然窗光",
	"从宠物眼睛高度捕捉爪子与商品接触的一瞬，视线集中在互动点",
	"把商品的真实绒面或接触部位拉近，柔和侧光让纹理有层次",
	"使用者与宠物在安全的居家玩耍角互动，姿态自然、有明确动作",
	"从上方观察宠物活动区，地毯、靠垫与商品形成真实尺度关系",
}

var generalScenes = []string{
	"符合真实用途的生活现场，写明前景物体、商品接触面和远景层次",
	"自然窗光下的一次具体使用动作，使用者注意商品而非对镜头摆拍",
	"侧逆光表现一处真实可见细节，背景保留轻微环境线索",
	"不同于首屏的合理使用地点，用动作、视线与接触阴影形成视觉焦点",
	"真实日常空间中的安静片刻，用前后景、尺度与留白形成购买代入感",
}

func ShotAssignments(count int, imageType, category string) []string {
	if count < 1 || count > 30 {
		return nil
	}
	scenes := generalScenes
	if strings.Contains(strings.ToLower(category), "pet") || strings.Contains(category, "宠物") || strings.Contains(category, "猫") || strings.Contains(category, "狗") {
		scenes = petScenes
	}
	result := make([]string, count)
	for i := range result {
		index := 0
		if count > 1 {
			index = i * (len(shotGoals) - 1) / (count - 1)
		}
		goal := shotGoals[index]
		if count == 1 {
			goal = "单屏完成商品识别、一个有证据的购买理由与真实使用情境，不机械截取长套图首屏"
		}
		// The public picker uses 1–20; legacy 21–30 requests get additional
		// elevation offsets rather than duplicate camera pairs.
		camera := shotCameras[index]
		if count > 20 {
			camera = fmt.Sprintf("第%d机位，绕商品方位角%d°，俯角%d°", i+1, i*9-85, 10+i*2)
		}
		result[i] = fmt.Sprintf("第%d/%d屏（%s）｜本屏唯一购买问题：%s｜独立机位：%s，相机与商品都须按此关系重拍｜景别：%s｜场景创意：%s；本屏动作焦点是“%s”，不得复制其他屏的主体朝向、动作与完整构图。只描述有参考证据的可见表面，不虚构背面、接口、功能或配件；白底/纯商品/无人物/模板与平台硬规则优先，允许场景时才执行生活背景。", i+1, count, imageType, goal, camera, shotScales[index], scenes[i%len(scenes)], goal)
	}
	return result
}
