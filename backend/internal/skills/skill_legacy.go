package skills

import (
	"fmt"
	"log"
	"time"

	"yingce/backend/internal/repository"
)

// LegacySkillMigration 记录已并入稳定技能包的旧内置技能。
// LegacyID / LegacyName 只用于兼容旧数据与旧说法，不能再作为独立技能重新发布。
type LegacySkillMigration struct {
	LegacyID   string
	LegacyName string
	TargetID   string
	TargetName string
}

// legacySkillMigrations 是旧包退休的唯一事实来源：
// 启动迁移、Agent 别名覆盖检查都从这里读取，避免两处映射漂移。
var legacySkillMigrations = []LegacySkillMigration{
	{LegacyID: "14889899552012", LegacyName: "AI演员微表情导演", TargetID: "16000000000086", TargetName: "AI 表演实验室"},
	{LegacyID: "16000000000075", LegacyName: "对白工坊", TargetID: "14811816982796", TargetName: "剧本撰写"},
	{LegacyID: "16000000000076", LegacyName: "剧本工业化机器", TargetID: "14811816982796", TargetName: "剧本撰写"},
	{LegacyID: "16000000000084", LegacyName: "故事结构引擎", TargetID: "14811816983052", TargetName: "故事与影像制作-源起"},
	{LegacyID: "16000000000080", LegacyName: "短片五阶段结构", TargetID: "14811816983052", TargetName: "故事与影像制作-源起"},
	{LegacyID: "16000000000073", LegacyName: "角色锻造工坊", TargetID: "14811816982284", TargetName: "角色设计"},
	{LegacyID: "16000000000089", LegacyName: "Freestyle 风格库", TargetID: "16000000000095", TargetName: "视觉提示词工程"},
	{LegacyID: "16000000000103", LegacyName: "提示词工程模式", TargetID: "16000000000095", TargetName: "视觉提示词工程"},
	{LegacyID: "14811816981260", LegacyName: "15秒极致夸张反转提示词", TargetID: "16000000000095", TargetName: "视觉提示词工程"},
	{LegacyID: "14811816981004", LegacyName: "15秒视觉特效", TargetID: "16000000000095", TargetName: "视觉提示词工程"},
	{LegacyID: "16000000000082", LegacyName: "情景喜剧工坊", TargetID: "16000000000074", TargetName: "喜剧 Mechanics"},
	{LegacyID: "16000000000083", LegacyName: "脱口秀手艺", TargetID: "16000000000074", TargetName: "喜剧 Mechanics"},
	{LegacyID: "16000000000085", LegacyName: "相声手艺", TargetID: "16000000000074", TargetName: "喜剧 Mechanics"},
	{LegacyID: "14811816969740", LegacyName: "珠宝设计进化", TargetID: "14811816969484", TargetName: "珠宝设计出款"},
	{LegacyID: "yingce-image-annotation", LegacyName: "图片标注编辑", TargetID: "yingce-image-editing", TargetName: "图片编辑工作流"},
	{LegacyID: "yingce-image-layer-split", LegacyName: "图片图层拆分", TargetID: "yingce-image-editing", TargetName: "图片编辑工作流"},
}

var legacySkillIDSet = func() map[string]struct{} {
	ids := make(map[string]struct{}, len(legacySkillMigrations))
	for _, migration := range legacySkillMigrations {
		ids[migration.LegacyID] = struct{}{}
	}
	return ids
}()

func isLegacySkillID(skillID string) bool {
	_, exists := legacySkillIDSet[skillID]
	return exists
}

func legacySkillTargetID(skillID string) (string, bool) {
	for _, migration := range legacySkillMigrations {
		if migration.LegacyID == skillID {
			return migration.TargetID, true
		}
	}
	return "", false
}

// LegacySkillMigrations 返回旧技能映射副本，调用方不能修改内置清单。
func LegacySkillMigrations() []LegacySkillMigration {
	return append([]LegacySkillMigration(nil), legacySkillMigrations...)
}

// retireLegacyBuiltinSkills 把旧技能的用户状态合并到稳定包，然后删除旧包。
// 目标包被管理员删除或下架时保留旧数据，等目标恢复后再迁移。
func (s *Service) retireLegacyBuiltinSkills() error {
	if s.repo == nil || len(legacySkillMigrations) == 0 {
		return nil
	}
	items := make([]repository.LegacySkillRetirement, 0, len(legacySkillMigrations))
	for _, migration := range legacySkillMigrations {
		items = append(items, repository.LegacySkillRetirement{
			LegacyID: migration.LegacyID,
			TargetID: migration.TargetID,
		})
	}
	report, err := s.repo.RetireLegacyBuiltinSkills(items, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("退休旧内置技能失败: %w", err)
	}
	if len(report.RetiredSkills) > 0 || report.CreatedStates > 0 || report.MergedStates > 0 {
		log.Printf("旧内置技能已退休: 包=%d 新建用户状态=%d 合并用户状态=%d 跳过=%d",
			len(report.RetiredSkills), report.CreatedStates, report.MergedStates, len(report.SkippedSkills))
	}
	if len(report.SkippedSkills) > 0 {
		log.Printf("旧内置技能暂未迁移（目标不存在或不可用）: %v", report.SkippedSkills)
	}
	return nil
}
