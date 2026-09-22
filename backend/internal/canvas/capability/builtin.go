package capability

const (
	maxAgentNodeTitleRunes   = 240
	maxAgentNodeContentRunes = 16000
	// 坐标绝对值上限：与 app 侧整理工具收敛几何值的范围一致。
	maxAgentNodeCoordLimit = 1e6
)

func BuiltinRegistry() *Registry {
	registry, err := NewRegistry([]Descriptor{
		{
			Type: "text", Version: "1", Label: "文本", DefaultWidth: 340, DefaultHeight: 240,
			Purpose:     "承载普通说明、创意草稿和单段提示词。",
			GoodFor:     []string{"单个创意", "一次性提示词", "临时备注", "快速试验"},
			NotIdealFor: []string{"多镜头脚本", "需要逐镜修改的内容", "需要镜头级资产关系的内容"},
			Tradeoffs:   []string{"创建和编辑最轻量", "没有镜头级字段和逐镜维护能力"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "正文", "节点正文"),
			CreateMetadata: func(content string) map[string]any {
				return map[string]any{"content": content, "status": "idle", "fontSize": float64(14)}
			},
		},
		{
			Type: "markdown", Version: "1", Label: "Markdown", DefaultWidth: 420, DefaultHeight: 320,
			Purpose:     "承载面向人阅读的方案、脚本草稿和格式化文档。",
			GoodFor:     []string{"创意方案", "脚本草稿", "交付文档", "需要排版的长文本"},
			NotIdealFor: []string{"需要逐镜生成或审核的多镜头内容", "需要绑定媒体资产的结构化流程"},
			Tradeoffs:   []string{"适合阅读和导出", "结构化程度低，不能替代可维护的分镜表"},
			InputKind:   "text", Connection: ConnectionPolicy{CanSource: true}, CanUpdate: true,
			SummaryFields: []string{"content"}, DetailFields: []string{"content"},
			PatchFields: editableNodeFields("metadata.content", "Markdown 正文", "Markdown 正文"),
		},
		generatedMediaDescriptor("image", "2", "图片", 720, 405, "image", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image"},
		}),
		generatedMediaDescriptor("video", "2", "视频", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio"},
		}),
		generatedMediaDescriptor("audio", "2", "音频", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text"},
		}),
		{
			Type: "frame", Version: "1", Label: "背板", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "组织一组相关节点的画布区域。",
			GoodFor:       []string{"按场景整理节点", "划分工作区域"},
			NotIdealFor:   []string{"承载结构化镜头数据", "替代具体业务节点"},
			Tradeoffs:     []string{"改善空间组织但不增加内容结构或生成能力"},
			SummaryFields: []string{"label"}, DetailFields: []string{"label"},
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"frame": map[string]any{"collapsed": false, "expandedWidth": float64(760), "expandedHeight": float64(520)}}
			},
		},
		{
			Type: "batch-table", Version: "1", Label: "批量创作表", DefaultWidth: 1280, DefaultHeight: 560,
			Purpose:     "面向电商批量换装和创意生图的结构化任务表；每行绑定最多六组画布图片、可用 @参考图1 等位置引用编写独立提示词，也可设置全局提示词覆盖各行，并追踪生成结果。",
			GoodFor:     []string{"商品与模特批量换装", "同一商品多场景创意图", "多组参考图组合生成", "批量结果追踪与失败重试"},
			NotIdealFor: []string{"通用数据库或库存管理", "单张图片快速试验", "多镜头叙事连续性"},
			Tradeoffs:   []string{"参考图必须先作为图片节点进入画布", "批量提交会产生多项生成任务，执行前必须确认模型、数量和费用"},
			Actions:     []string{"read_rows", "append_row", "update_row", "remove_row", "set_operation", "set_concurrency", "add_reference_column", "remove_reference_column", "set_global_prompt", "preview_batch_generation"},
			InputKind:   "text",
			Connection:  ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"image"}},
			CanUpdate:   true, SummaryFields: []string{"batchTable"}, DetailFields: []string{"batchTable"}, ProjectionKind: "batch_table", ProjectionField: "batchTable",
			PatchFields: func() map[string]PatchField {
				fields := map[string]PatchField{
					"title": {Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "批量创作表标题", MaxRunes: maxAgentNodeTitleRunes},
				}
				for key, field := range positionPatchFields() {
					fields[key] = field
				}
				return fields
			}(),
			CreateMetadata: func(string) map[string]any {
				return map[string]any{
					"status": "idle",
					"batchTable": map[string]any{
						"operation": "try_on", "concurrency": float64(10),
						"referenceColumns": []any{
							map[string]any{"id": "reference-1", "label": "参考图 1"},
							map[string]any{"id": "reference-2", "label": "参考图 2"},
							map[string]any{"id": "reference-3", "label": "参考图 3"},
						},
						"rows": []any{},
					},
				}
			},
		},
		{
			Type: "script", Version: "1", Label: "分镜脚本", DefaultWidth: 920, DefaultHeight: 360,
			Purpose:       "维护结构化的多镜头脚本，支持镜头级审查、修改和媒体关联。",
			GoodFor:       []string{"多镜头规划", "镜头连续性", "逐镜审查和微调", "逐镜生成图片或视频", "需要他人接手维护的内容"},
			NotIdealFor:   []string{"只有一个画面的快速试验", "一次性临时提示词", "仅需要阅读排版的普通文档"},
			Tradeoffs:     []string{"前期录入成本高于文本节点", "但能保留镜头级结构、资产关系和后续维护能力"},
			Actions:       []string{"read_rows", "append_row", "update_row", "remove_row", "generate_storyboard"},
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			CreateMetadata: func(string) map[string]any {
				return map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": []any{}, "visibleColumns": []any{"shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"}, "referenceNodeIds": []any{}}}
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return registry
}

func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	semantics := generatedMediaSemantics(nodeType)
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		Purpose: semantics.Purpose, GoodFor: semantics.GoodFor, NotIdealFor: semantics.NotIdealFor,
		Tradeoffs: semantics.Tradeoffs, Actions: semantics.Actions,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		DetailFields:   []string{"prompt", "composerContent", "assetTags", "referenceNodeIds"},
		PatchFields:    editableNodeFields("metadata.composerContent", "下一版提示词", "下次生成使用的提示词草稿；不覆盖已提交提示词或媒体结果"),
		CreateMetadata: generatedMetadata,
	}
}

type generatedMediaCapabilitySemantics struct {
	Purpose     string
	GoodFor     []string
	NotIdealFor []string
	Tradeoffs   []string
	Actions     []string
}

func generatedMediaSemantics(nodeType string) generatedMediaCapabilitySemantics {
	switch nodeType {
	case "image":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个静态画面，并作为后续图片或视频生成的真实参考素材。",
			GoodFor:     []string{"单张图片生成", "有参考图的图片生成", "分镜首帧和关键帧", "需要复用的视觉素材"},
			NotIdealFor: []string{"承载多镜头脚本结构", "表达镜头运动或时间变化", "代替分镜表维护镜头连续性"},
			Tradeoffs:   []string{"一个节点对应一个静态媒体目标", "参考图数量和生成方式必须再由模型目录能力匹配"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "video":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个连续视频片段；可按实际参考素材执行文生视频、图生视频或多图生视频。",
			GoodFor:     []string{"单镜头文生视频", "单图生视频", "多图参考视频", "已有视频或音频参与的视频生成"},
			NotIdealFor: []string{"承载整部多镜头脚本", "用一个节点代替逐镜审查和维护", "未查询模型能力就假定支持任意参考数量"},
			Tradeoffs:   []string{"一个节点通常对应一个可独立生成和审核的视频片段", "参考类型、数量、时长、画幅、音频和价格受当前模型目录约束"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	case "audio":
		return generatedMediaCapabilitySemantics{
			Purpose:     "生成或承载一个音频素材，用于配音、音乐、音效或视频参考输入。",
			GoodFor:     []string{"文本转语音", "配音", "音乐或音效素材", "为视频提供音频参考"},
			NotIdealFor: []string{"承载分镜结构", "表达画面构图或镜头运动", "代替视频节点"},
			Tradeoffs:   []string{"一个节点对应一个音频目标且最多接收一个文本输入", "音频类型、时长和价格仍以模型目录及任务准入为准"},
			Actions:     []string{"generate_media", "update_prompt", "use_as_reference"},
		}
	default:
		return generatedMediaCapabilitySemantics{}
	}
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	fields := map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "节点标题", MaxRunes: maxAgentNodeTitleRunes,
		},
		"content": {
			Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
		},
	}
	for key, field := range positionPatchFields() {
		fields[key] = field
	}
	return fields
}

// positionPatchFields 是坐标字段：模型可以直接指定节点位置（微调），批量整理走 canvas_arrange_nodes。
// 坐标上限与整理侧的收敛范围一致，避免写进离谱的几何值。
func positionPatchFields() map[string]PatchField {
	return map[string]PatchField{
		"x": {Path: "position.x", Kind: patchKindNumber, Label: "横坐标", Order: 30, Limit: maxAgentNodeCoordLimit, Description: "画布横坐标（像素）；与 y 一起移动节点，通常用 canvas_arrange_nodes 批量整理"},
		"y": {Path: "position.y", Kind: patchKindNumber, Label: "纵坐标", Order: 31, Limit: maxAgentNodeCoordLimit, Description: "画布纵坐标（像素）；与 x 一起移动节点，通常用 canvas_arrange_nodes 批量整理"},
	}
}

func generatedMetadata(prompt string) map[string]any {
	return map[string]any{"content": "", "prompt": prompt, "composerContent": prompt, "status": "idle"}
}
