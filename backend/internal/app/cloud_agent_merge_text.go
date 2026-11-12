package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentMergeTextArgs struct {
	SnapshotHash string `json:"snapshotHash"`
	NodeID       string `json:"nodeId"`
	Title        string `json:"title"`
	Heading      string `json:"heading,omitempty"`
	Sources      []struct {
		NodeID       string `json:"nodeId"`
		RemovePrefix string `json:"removePrefix,omitempty"`
	} `json:"sources"`
}

type cloudAgentTextIntegrity struct {
	NodeID           string `json:"nodeId"`
	SHA256           string `json:"sha256"`
	Chars            int    `json:"chars"`
	Bytes            int    `json:"bytes"`
	RemovedPrefixLen int    `json:"removedPrefixChars,omitempty"`
}

type cloudAgentMergeTextPlan struct {
	Canvas     *model.CanvasProject
	Document   map[string]any
	BeforeJSON string
	BeforeHash string
	Args       cloudAgentMergeTextArgs
	Integrity  []cloudAgentTextIntegrity
	Result     cloudAgentTextIntegrity
	Preview    cloudAgentApprovalPreview
}

func cloudAgentTextSHA256(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

func prepareCloudAgentMergeText(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentMergeTextPlan, error) {
	var args cloudAgentMergeTextArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.SnapshotHash == "" || len(args.Sources) < 2 || len(args.Sources) > 12 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("需要 snapshotHash 和 2 到 12 个有序来源节点")}
	}
	if err := validateCloudAgentID(args.NodeID, "新节点 ID", 80); err != nil {
		return nil, &cloudAgentArgumentError{err}
	}
	if !utf8.ValidString(args.Title) || strings.TrimSpace(args.Title) == "" || utf8.RuneCountInString(args.Title) > 240 ||
		!utf8.ValidString(args.Heading) || utf8.RuneCountInString(args.Heading) > 240 || strings.ContainsAny(args.Heading, "\r\n\ufffd") {
		return nil, &cloudAgentArgumentError{BadAuthRequest("标题或总标题无效或超过 240 字符")}
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	if !utf8.ValidString(canvas.PayloadJSON) {
		return nil, BadAuthRequest("画布存储文本含无效 UTF-8，不能安全合并")
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.SnapshotHash {
		return nil, cloudAgentFieldError("snapshotHash", "stale_snapshot", "来源画布已变化，请重新读取后再合并")
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	if nodes[args.NodeID] != nil {
		return nil, cloudAgentFieldError("nodeId", "duplicate", "结果节点 ID 已存在，请换一个新 ID")
	}
	seen := map[string]bool{}
	parts := make([]string, 0, len(args.Sources))
	integrity := make([]cloudAgentTextIntegrity, 0, len(args.Sources))
	for i, source := range args.Sources {
		field := fmt.Sprintf("sources[%d]", i)
		if err := validateCloudAgentID(source.NodeID, "来源节点 ID", 80); err != nil {
			return nil, cloudAgentFieldError(field+".nodeId", "invalid_value", cloudAgentSafeToolError(err))
		}
		if seen[source.NodeID] {
			return nil, cloudAgentFieldError(field+".nodeId", "duplicate", "来源节点不能重复")
		}
		seen[source.NodeID] = true
		node := nodes[source.NodeID]
		if node == nil || (stringValue(node["type"]) != "text" && stringValue(node["type"]) != "markdown") {
			return nil, cloudAgentFieldError(field+".nodeId", "not_found", "来源必须是当前画布中的 text 或 markdown 节点")
		}
		meta, _ := node["metadata"].(map[string]any)
		if meta["locked"] == true || stringValue(meta["workflowKind"]) == "character" {
			return nil, cloudAgentFieldError(field+".nodeId", "invalid_source", "锁定节点或角色卡不能作为合并来源")
		}
		content, ok := meta["content"].(string)
		if !ok || content == "" || !utf8.ValidString(content) || strings.ContainsRune(content, '\ufffd') || strings.Contains(source.RemovePrefix, "\ufffd") {
			return nil, cloudAgentFieldError(field+".nodeId", "unreliable_text", "来源正文为空、包含替换字符或无效 UTF-8；请核对存储原文，不能直接合并")
		}
		if strings.HasPrefix(content, "/api/resources/") || strings.HasPrefix(content, "resource:") || stringValue(meta["storageKey"]) != "" {
			return nil, cloudAgentFieldError(field+".nodeId", "resource_source", "资源文件暂不支持直接合并，请使用画布内正文节点")
		}
		if !strings.HasPrefix(content, source.RemovePrefix) {
			return nil, cloudAgentFieldError(field+".removePrefix", "prefix_mismatch", "要移除的总标题与来源正文开头不一致，请逐字核对")
		}
		part := strings.TrimPrefix(content, source.RemovePrefix)
		if strings.TrimSpace(part) == "" {
			return nil, cloudAgentFieldError(field+".removePrefix", "empty_source", "去掉标题后来源正文为空")
		}
		parts = append(parts, part)
		integrity = append(integrity, cloudAgentTextIntegrity{NodeID: source.NodeID, SHA256: cloudAgentTextSHA256(content), Chars: utf8.RuneCountInString(content), Bytes: len(content), RemovedPrefixLen: utf8.RuneCountInString(source.RemovePrefix)})
	}
	content := strings.Join(parts, "\n\n")
	if args.Heading != "" {
		content = args.Heading + "\n\n" + content
	}
	if utf8.RuneCountInString(content) > 16000 {
		return nil, cloudAgentFieldError("sources", "length_exceeded", "合并正文超过文本节点 16000 字符上限，请缩减来源范围")
	}
	items, err := applyCloudAgentCanvasPlan(doc, []agentCanvasOp{{Type: "add_node", ID: args.NodeID, NodeType: "text", Title: &args.Title, Content: &content}})
	if err != nil {
		return nil, err
	}
	result := cloudAgentTextIntegrity{NodeID: args.NodeID, SHA256: cloudAgentTextSHA256(content), Chars: utf8.RuneCountInString(content), Bytes: len(content)}
	preview := cloudAgentCanvasApprovalPreview(items)
	preview.Description = fmt.Sprintf("按给定顺序合并 %d 个文本节点，创建《%s》（%d 字符）。", len(parts), args.Title, result.Chars)
	return &cloudAgentMergeTextPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeHash: beforeHash, Args: args, Integrity: integrity, Result: result, Preview: preview}, nil
}

func cloudAgentPreviewMergeText(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentMergeText(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func applyCloudAgentMergeText(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentMergeText(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	nodes, err := creationObjects(plan.Document["nodes"])
	if err != nil {
		return nil, err
	}
	node := nodes[plan.Args.NodeID]
	if node == nil {
		return nil, BadAuthRequest("合并写入后的完整性校验失败：结果节点不存在")
	}
	meta, _ := node["metadata"].(map[string]any)
	stored, _ := meta["content"].(string)
	if cloudAgentTextSHA256(stored) != plan.Result.SHA256 || len(stored) != plan.Result.Bytes {
		return nil, BadAuthRequest(fmt.Sprintf("合并写入后的完整性校验失败：预期 %d 字节，读回 %d 字节", plan.Result.Bytes, len(stored)))
	}
	appliedPreview := cloudAgentCanvasAppliedPreview(plan.Preview)
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: call.Function.Name, BeforeSnapshotHash: plan.BeforeHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document), BeforeJSON: plan.BeforeJSON, Preview: &appliedPreview}); err != nil {
			return nil, err
		}
	}
	return map[string]any{"canvasId": canvasID, "nodeId": plan.Args.NodeID, "snapshotHash": cloudAgentCanvasHash(plan.Document), "committed": true, "verified": true, "sources": plan.Integrity, "result": plan.Result, "preview": appliedPreview}, nil
}
