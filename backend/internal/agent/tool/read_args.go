package tool

// The same types drive strict argument decoding in the host and schema creation.
// omitempty controls required fields in the schema, not runtime zero handling.
type CanvasGetStateArgs struct {
	Offset           int      `json:"offset,omitempty" description:"节点分页起点，默认0；后续用 nextOffset（非页码）" minimum:"0"`
	ConnectionOffset int      `json:"connectionOffset,omitempty" description:"连线分页起点；hasMoreConnections 时保持节点 offset，用 nextConnectionOffset" minimum:"0"`
	StoryboardOffset int      `json:"storyboardOffset,omitempty" description:"分镜行分页起点，省略为0" minimum:"0"`
	NodeIDs          []string `json:"nodeIds,omitempty" description:"节点ID数组（勿传单字符串）；与 focusNodeIds 互斥" itemDescription:"待精读的真实节点ID" maxItems:"8"`
	FocusNodeIDs     []string `json:"focusNodeIds,omitempty" description:"与 depth 读关联子图；未传勿传 depth" itemDescription:"当前节点或当前节点集合的真实ID" maxItems:"8"`
	Depth            *int     `json:"depth,omitempty" description:"从 focusNodeIds 沿无向连线展开；默认1；未传 focusNodeIds 勿传" minimum:"0" maximum:"3"`
	IncludeRelated   *bool    `json:"includeRelated,omitempty" description:"仅随 focusNodeIds 使用；true 读连通分量全部上下游，最多256节点；与 depth 互斥"`
}

type CanvasReadTextArgs struct {
	NodeID   string `json:"nodeId" description:"文本或文件节点ID"`
	Offset   int    `json:"offset,omitempty" description:"字符偏移，后续用 nextOffset" minimum:"0"`
	MaxChars int    `json:"maxChars,omitempty" description:"最多字符数，默认16000" minimum:"1" maximum:"16000"`
}

type StoryboardReadArgs struct {
	NodeID string `json:"nodeId" description:"真实分镜脚本节点ID"`
	Offset int    `json:"offset,omitempty" minimum:"0"`
}

type BatchTableReadArgs struct {
	NodeID string `json:"nodeId" description:"真实批量创作表节点ID"`
	Offset int    `json:"offset,omitempty" minimum:"0"`
}

type SkillReadArgs struct {
	SkillID string `json:"skillId" description:"技能ID"`
	Path    string `json:"path" description:"文件路径或空字符串"`
	Offset  int    `json:"offset,omitempty" minimum:"0"`
}

type ProfileReadArgs struct {
	Scope string `json:"scope" enum:"user,project,canvas"`
}

type TaskGetArgs struct {
	TaskID string `json:"taskId" description:"真实任务ID"`
}

type ImageNodeArgs struct {
	NodeID string `json:"nodeId" description:"真实图片节点ID"`
}
