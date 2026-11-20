package app

import (
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// 角色多造型（妆造）：一个角色（DramaCast kind=character, ParentID="")可以有多套造型，
// 每套造型是一行 DramaCast（kind=character, ParentID=角色ID, LookName=造型名），只承载这套造型的外观与参考图，
// 名称、别名与声音沿用所属角色。写剧本时按本集章节选默认造型，镜头可按剧情另选；生成段视频时按本镜造型取参考图。

// dramaLooksForCharacter 返回某角色的全部造型行（不含角色本体），按位置排序。
func dramaLooksForCharacter(casts []model.DramaCast, characterID string) []model.DramaCast {
	looks := []model.DramaCast{}
	for _, cast := range casts {
		if cast.Kind == "character" && cast.ParentID == characterID {
			looks = append(looks, cast)
		}
	}
	return looks
}

// dramaBaseCharacterID 把造型行归到所属角色；角色本体返回自身 ID。
func dramaBaseCharacterID(cast model.DramaCast) string {
	if cast.ParentID != "" {
		return cast.ParentID
	}
	return cast.ID
}

// dramaLookRanges 把一个角色的造型行转成 production.LookRange，供按章节选默认造型。
func dramaLookRanges(looks []model.DramaCast) []production.LookRange {
	ranges := make([]production.LookRange, 0, len(looks))
	for _, look := range looks {
		ranges = append(ranges, production.LookRange{ID: look.ID, From: look.LookFromChapter, To: look.LookToChapter})
	}
	return ranges
}

// dramaResolveShotLook 为一个镜头里的出镜角色挑出实际使用的造型行 ID：
// 镜头明确指定了造型名（lookChoices[角色名]）时用它，否则用本集默认造型；都没有时用角色本体（返回空串）。
// chapters 是本集的章节序号（从 1 起），用于计算默认造型。
func dramaResolveShotLook(character model.DramaCast, looks []model.DramaCast, chosenLookName string, chapters []int) string {
	if name := strings.TrimSpace(chosenLookName); name != "" && production.IsBaseLookName(name) {
		return ""
	}
	if len(looks) == 0 {
		return ""
	}
	if name := strings.TrimSpace(chosenLookName); name != "" && !production.IsBaseLookName(name) {
		for _, look := range looks {
			if production.NormalizeName(look.LookName) == production.NormalizeName(name) {
				return look.ID
			}
		}
	}
	return production.DefaultLook(dramaLookRanges(looks), chapters)
}

// dramaLookAppearance 是一套造型写进提示词与参考图的外观：造型自己的外观，空时退回角色本体外观。
func dramaLookAppearance(character, look model.DramaCast) string {
	if look.ID == "" || look.ID == character.ID {
		return firstNonEmpty(character.Appearance, character.Description)
	}
	return firstNonEmpty(look.Appearance, character.Appearance, character.Description)
}
