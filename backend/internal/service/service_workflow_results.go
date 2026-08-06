package service

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

func buildAgentResult(task model.Task) (map[string]any, []map[string]any) {
	title := strings.TrimSpace(task.Prompt)
	if len([]rune(title)) > 28 {
		title = string([]rune(title)[:28]) + "..."
	}
	result := map[string]any{
		"taskId":    task.ID,
		"operation": task.Operation,
		"provider":  defaultString(task.Provider, "internal-agent"),
		"model":     defaultString(task.Model, "workflow-router"),
		"plan": []map[string]any{
			{"kind": "script", "title": "创意脚本", "content": task.Prompt},
			{"kind": "scene", "title": "主场景", "content": "根据用户输入拆解为可生成的视频场景。"},
			{"kind": "shot", "title": "镜头 1", "content": "建立画面、主体、风格和运镜。"},
			{"kind": "final", "title": "成片", "content": "等待视频生成 Provider 回填成片结果。"},
		},
	}
	ops := []map[string]any{
		nodeOp("script-"+task.ID, "text", "剧本 · "+title, 0, 0, "script", task.Prompt),
		nodeOp("scene-"+task.ID, "text", "场景 · 主场景", 380, 0, "scene", "主场景设定、角色关系、视觉风格。"),
		nodeOpWithMetadata("shot-"+task.ID, "video", "分镜 · 镜头 1", 760, 0, map[string]any{"workflowKind": "shot", "status": "idle", "generationMode": "video", "prompt": task.Prompt, "composerContent": task.Prompt, "videoEditOperation": "text_to_video"}),
		nodeOp("final-"+task.ID, "video", "成片 · 待生成", 1140, 0, "final", ""),
		connectOp("script-"+task.ID, "scene-"+task.ID),
		connectOp("scene-"+task.ID, "shot-"+task.ID),
		connectOp("shot-"+task.ID, "final-"+task.ID),
	}
	return result, ops
}

func buildVideoWorkflowResult(task model.Task) (map[string]any, []map[string]any) {
	title := strings.TrimSpace(task.Prompt)
	if len([]rune(title)) > 28 {
		title = string([]rune(title)[:28]) + "..."
	}
	operation := defaultString(task.Operation, strings.TrimPrefix(task.Type, "video_"))
	result := map[string]any{
		"taskId":    task.ID,
		"operation": operation,
		"provider":  defaultString(task.Provider, "internal-agent"),
		"model":     defaultString(task.Model, "workflow-router"),
		"plan": []map[string]any{
			{"kind": "reference_set", "title": "参考素材组", "content": "收集原视频、参考图、参考音频和版本样片。"},
			{"kind": "shot", "title": "编辑镜头", "content": task.Prompt},
			{"kind": "final", "title": "结果版本", "content": "等待 provider 生成或人工确认后回填版本结果。"},
		},
	}
	ops := []map[string]any{
		nodeOp("video-brief-"+task.ID, "text", "编辑需求 · "+title, 0, 0, "script", task.Prompt),
		nodeOpWithMetadata("video-ref-"+task.ID, "text", "参考素材组", 380, 0, map[string]any{"workflowKind": "reference_set", "status": "idle", "content": "原片、参考图、参考音频、风格板或历史版本。", "videoEditOperation": operation}),
		nodeOpWithMetadata("video-shot-"+task.ID, "video", "视频任务 · "+operation, 760, 0, map[string]any{"workflowKind": "shot", "status": "idle", "generationMode": "video", "prompt": task.Prompt, "composerContent": task.Prompt, "videoEditOperation": operation}),
		nodeOpWithMetadata("video-result-"+task.ID, "video", "结果版本 · 待回填", 1140, 0, map[string]any{"workflowKind": "final", "status": "idle", "videoEditOperation": operation, "versionLabel": "v1"}),
		connectOp("video-brief-"+task.ID, "video-ref-"+task.ID),
		connectOp("video-ref-"+task.ID, "video-shot-"+task.ID),
		connectOp("video-shot-"+task.ID, "video-result-"+task.ID),
	}
	return result, ops
}
