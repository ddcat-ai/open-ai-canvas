package capability

import "infinite-canvas/backend/internal/canvas/contract"

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
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "character"},
		}),
		generatedMediaDescriptor("video", "2", "视频", 720, 405, "video", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, AcceptedInputKinds: []string{"text", "image", "video", "audio", "character"},
		}),
		generatedMediaDescriptor("audio", "2", "音频", 340, 120, "audio", ConnectionPolicy{
			CanSource: true, CanTarget: true, CanReference: true, MaxInputCount: 1, AcceptedInputKinds: []string{"text", "character"},
		}),
		characterDescriptor(),
		{
			Type: "frame", Version: "1", Label: "背板", DefaultWidth: 760, DefaultHeight: 520,
			Purpose:       "在画布上建立可移动、可折叠的视觉分区，用来归组相关节点；背板本身不承载创作正文或生成结果。",
			GoodFor:       []string{"按场景或镜头组归拢脚本、参考图和生成结果", "按前期策划、制作、交付等阶段划分工作区", "为大型画布建立清晰分区，便于移动或折叠整组内容"},
			NotIdealFor:   []string{"承载结构化镜头数据（应使用分镜脚本节点）", "存放需要 Agent 单独读写的正文（应使用文本或 Markdown 节点）", "替代具体业务节点或媒体生成节点"},
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
			Actions:       []string{"read_rows", "append_row", "update_row", "remove_row", "generate_storyboard", "connect_assets", "update_node"},
			InputKind:     "text",
			Connection:    ConnectionPolicy{CanSource: true, CanTarget: true, AcceptedInputKinds: []string{"audio", "character", "image", "text", "video"}},
			CanUpdate:     true,
			SummaryFields: []string{"storyboard"}, DetailFields: []string{"storyboard"}, ProjectionKind: "storyboard", ProjectionField: "storyboard",
			PatchFields: titleAndPositionPatchFields(),
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

// characterDescriptor 是角色卡能力：画布上是 text + metadata.workflowKind=character 的节点，
// 设定、三视图与声音都来自账号内的角色资产而非节点正文。它可以被发现、精读、连线和引用，
// 但不能用 add_node 凭空创建：必须经 canvas_create_character 用真实图片/音频建角色资产，名称和设定只随角色资产更新。
func characterDescriptor() Descriptor {
	return Descriptor{
		Type: "character", Version: "1", Label: "角色卡", DefaultWidth: 264, DefaultHeight: 352,
		Purpose:     "引用账号角色库中的角色资产，统一提供角色设定、三视图/形象图和绑定声音，用来保持人物在多次生成中的一致性。",
		GoodFor:     []string{"图片或视频生成时锁定人物外观", "多镜头保持同一角色一致", "角色配音时使用绑定声音", "只取角色文字设定作为提示词来源"},
		NotIdealFor: []string{"临时一次性的人物描述（直接写进提示词或文本节点）", "用 add_node 新建（应使用 canvas_create_character 打包形象图片与声音）", "承载普通正文（节点正文不是角色设定）"},
		Tradeoffs:   []string{"设定与媒体随角色资产版本变化，提交时会校验版本", "未绑定形象或声音时对应引用不可用，需先读取 character.imageReference/audioReference"},
		Actions:     []string{"read_character", "use_as_reference", "use_as_text_source"},
		InputKind:   "character",
		Connection:  ConnectionPolicy{CanSource: true, CanReference: true},
		CanUpdate:   true,
		PatchFields: positionPatchFields(),
		Variant:     &NodeVariant{BaseType: "text", WorkflowKind: "character"},
	}
}

// generatedMediaDescriptor 根据节点类型、显示尺寸、生成模式和连接规则创建媒体能力描述。
// 返回读写字段及创建默认值；首尾帧只对视频开放，避免其他节点接受无效视频参数。
func generatedMediaDescriptor(nodeType, version, label string, width, height float64, generationMode string, connection ConnectionPolicy) Descriptor {
	semantics := generatedMediaSemantics(nodeType)
	fields := editableNodeFields("metadata.generationSpec.prompt", "提示词", "生成合同中的当前提示词；这是 Agent 唯一读写的媒体提示词")
	readFields := []string{"prompt", "assetTags", "referenceNodeIds"}
	if generationMode == "video" {
		for i, frame := range []struct{ key, label string }{
			{"videoStartFrameNodeId", "首帧"}, {"videoEndFrameNodeId", "尾帧"},
		} {
			fields[frame.key] = PatchField{Path: "metadata." + frame.key, Kind: patchKindString, Label: frame.label, Order: 40 + i, MaxRunes: 80, Description: "已连接图片ID；空字符串取消"}
			readFields = append(readFields, frame.key)
		}
	}
	return Descriptor{
		Type: nodeType, Version: version, Label: label, DefaultWidth: width, DefaultHeight: height,
		Purpose: semantics.Purpose, GoodFor: semantics.GoodFor, NotIdealFor: semantics.NotIdealFor,
		Tradeoffs: semantics.Tradeoffs, Actions: semantics.Actions,
		InputKind: nodeType, GenerationMode: generationMode, Connection: connection, CanUpdate: true,
		SummaryFields:  readFields,
		DetailFields:   readFields,
		PatchFields:    fields,
		CreateMetadata: func(prompt string) map[string]any { return generatedMetadata(generationMode, prompt) },
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

func titleAndPositionPatchFields() map[string]PatchField {
	fields := map[string]PatchField{
		"title": {
			Path: "title", Kind: patchKindString, Label: "节点名称", Order: 10, Description: "节点标题", MaxRunes: maxAgentNodeTitleRunes,
		},
	}
	for key, field := range positionPatchFields() {
		fields[key] = field
	}
	return fields
}

func editableNodeFields(contentPath, contentLabel, contentDescription string) map[string]PatchField {
	fields := titleAndPositionPatchFields()
	fields["content"] = PatchField{
		Path: contentPath, Kind: patchKindString, Label: contentLabel, Order: 20, Description: contentDescription, MaxRunes: maxAgentNodeContentRunes,
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

func generatedMetadata(mode, prompt string) map[string]any {
	spec := contract.GenerationSpec{
		Version:           contract.GenerationVersion,
		Mode:              mode,
		Prompt:            prompt,
		Options:           contract.Options{},
		ReferenceBindings: []contract.ReferenceBinding{},
		TextInputMode:     "append-sources",
	}
	metadata, err := spec.NodeMetadata()
	if err != nil {
		panic(err)
	}
	metadata["content"] = ""
	metadata["status"] = "idle"
	return metadata
}
