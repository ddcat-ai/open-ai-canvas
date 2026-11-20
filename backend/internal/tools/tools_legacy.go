package tools

// LegacyBuiltinTool 是已改号的内置工具：旧编号的内置行停用，收藏迁到新编号，旧提示词标签按新编号解析。
type LegacyBuiltinTool struct {
	ID            int64
	ReplacementID int64
	Type          string
	LabelEn       string
}

// v1.7.3.4/v1.7.3.5 把故事板放在 90/91，会和旧站点用户自建工具的自增编号撞号，现改为 1000090/1000091。
// 只有仍是这两个内置故事板的行会被停用；同编号的用户工具不受影响。
var legacyBuiltinTools = []LegacyBuiltinTool{
	{ID: 90, ReplacementID: 1000090, Type: ToolTypeNineGrid, LabelEn: "short_storyboard"},
	{ID: 91, ReplacementID: 1000091, Type: ToolTypeNineGrid, LabelEn: "blocking_storyboard"},
}

func legacyBuiltinTool(toolType string, id int64) (LegacyBuiltinTool, bool) {
	for _, item := range legacyBuiltinTools {
		if item.ID == id && item.Type == toolType {
			return item, true
		}
	}
	return LegacyBuiltinTool{}, false
}
