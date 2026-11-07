package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/canvas/layout"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 批量生成：一次审批覆盖一组占位节点的收费生成。批准后由服务端执行器按并发提交、
// 逐条回写画布，阶段结束（试跑完成或全部结束）再把结果交回 Agent。
// 每次实际提交仍走 CreateTask 的完整准入：模型能力、参考归属、额度与报价都重新校验，
// 批次授权只放宽"每条都要用户点一次"，不放宽任何业务校验。
const (
	cloudAgentMediaBatchMaxItems      = 40
	cloudAgentMediaBatchMaxRetries    = 2
	cloudAgentMediaBatchStateLimit    = 200 << 10
	cloudAgentMediaBatchLeaseLifetime = 24 * time.Hour
	cloudAgentMediaBatchTaskLease     = 30 * time.Minute
	cloudAgentMediaBatchPollInterval  = time.Second
	cloudAgentMediaBatchDefaultSlots  = 3
)

const (
	cloudAgentMediaBatchPhaseApproval   = "approval"
	cloudAgentMediaBatchPhaseCanary     = "canary"
	cloudAgentMediaBatchPhaseCanaryDone = "canary_done"
	cloudAgentMediaBatchPhaseRunning    = "running"
	cloudAgentMediaBatchPhaseDone       = "done"
)

const (
	cloudAgentMediaBatchItemPending   = "pending"
	cloudAgentMediaBatchItemSubmitted = "submitted"
	cloudAgentMediaBatchItemSucceeded = "succeeded"
	cloudAgentMediaBatchItemFailed    = "failed"
	cloudAgentMediaBatchItemCancelled = "cancelled"
)

// cloudAgentPiMediaBatchPauseText 是批次在后台执行时交给运行时的占位结果；
// 批次结束后由真实回执替换（见 cloudAgentToolResultIsPlaceholder）。
const cloudAgentPiMediaBatchPauseText = "批次正在后台执行，完成后会把结果发给你。"

var errCloudAgentMediaBatchWait = errors.New("media batch submission must wait")

type cloudAgentMediaBatch struct {
	ID              string                     `json:"id"`
	CallID          string                     `json:"callId"`
	Mode            string                     `json:"mode"`
	ModelName       string                     `json:"modelName,omitempty"`
	Phase           string                     `json:"phase"`
	Concurrency     int                        `json:"concurrency"`
	Canary          bool                       `json:"canary,omitempty"`
	MaxRetries      int                        `json:"maxRetries"`
	CapMicrocredits int64                      `json:"capMicrocredits"`
	Items           []cloudAgentMediaBatchItem `json:"items"`
}

type cloudAgentMediaBatchItem struct {
	NodeID          string   `json:"nodeId"`
	Title           string   `json:"title,omitempty"`
	Arguments       string   `json:"arguments"`
	ResolvedHash    string   `json:"resolvedHash"`
	SpecHash        string   `json:"specHash"`
	Amount          int64    `json:"amountMicrocredits"`
	Duration        int      `json:"durationSeconds,omitempty"`
	ResourceIDs     []string `json:"resourceIds,omitempty"`
	Status          string   `json:"status"`
	TaskIDs         []string `json:"taskIds,omitempty"`
	Attempts        int      `json:"attempts,omitempty"`
	PromptChanged   bool     `json:"promptChanged,omitempty"`
	PreviousNodeIDs []string `json:"previousNodeIds,omitempty"`
	Error           string   `json:"error,omitempty"`
}

func (b *cloudAgentMediaBatch) active() bool {
	return b != nil && (b.Phase == cloudAgentMediaBatchPhaseCanary || b.Phase == cloudAgentMediaBatchPhaseRunning)
}

func (item cloudAgentMediaBatchItem) taskID() string {
	if len(item.TaskIDs) == 0 {
		return ""
	}
	return item.TaskIDs[len(item.TaskIDs)-1]
}

func cloudAgentMediaBatchActive(state *cloudAgentRuntime) bool {
	return state != nil && state.MediaBatch.active()
}

func (b *cloudAgentMediaBatch) counts() map[string]int {
	counts := map[string]int{"total": len(b.Items)}
	for _, item := range b.Items {
		counts[item.Status]++
	}
	return counts
}

func (b *cloudAgentMediaBatch) inFlight() int {
	count := 0
	for _, item := range b.Items {
		if item.Status == cloudAgentMediaBatchItemSubmitted {
			count++
		}
	}
	return count
}

func (b *cloudAgentMediaBatch) nextPending() int {
	for index, item := range b.Items {
		if item.Status == cloudAgentMediaBatchItemPending {
			if b.Phase == cloudAgentMediaBatchPhaseCanary && index != 0 {
				return -1
			}
			return index
		}
	}
	return -1
}

type cloudAgentMediaBatchArgs struct {
	Mode                       string `json:"mode"`
	LogicalModelID             string `json:"logicalModelId"`
	ChannelID                  string `json:"channelId"`
	ChannelModelKey            string `json:"channelModelKey"`
	Size                       string `json:"size"`
	Quality                    string `json:"quality"`
	ImageResolution            string `json:"imageResolution"`
	Duration                   int    `json:"durationSeconds"`
	VideoGenerateAudio         *bool  `json:"videoGenerateAudio"`
	ImageParameters            string `json:"imageParameters,omitempty"`
	VideoWatermark             *bool  `json:"videoWatermark,omitempty"`
	VideoArkPrivateAssetUpload *bool  `json:"videoArkPrivateAssetUpload,omitempty"`
	Concurrency                int    `json:"concurrency"`
	Canary                     bool   `json:"canary"`
	MaxRetries                 *int   `json:"maxRetriesPerItem"`
	Items                      []struct {
		NodeID   string `json:"nodeId"`
		Prompt   string `json:"prompt"`
		Duration int    `json:"durationSeconds"`
	} `json:"items"`
}

func decodeCloudAgentMediaBatchArgs(raw string) (cloudAgentMediaBatchArgs, error) {
	var args cloudAgentMediaBatchArgs
	if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	args.Mode = strings.ToLower(strings.TrimSpace(args.Mode))
	if args.Mode != "image" && args.Mode != "video" && args.Mode != "audio" {
		return args, cloudAgentFieldError("mode", "invalid_value", "批量生成只支持 image、video 或 audio；同一批只能是一种模式")
	}
	if len(args.Items) == 0 {
		return args, cloudAgentFieldError("items", "required", "批量生成至少需要一个条目")
	}
	if len(args.Items) > cloudAgentMediaBatchMaxItems {
		return args, cloudAgentFieldError("items", "item_count", fmt.Sprintf("一批最多 %d 条，请拆成多批", cloudAgentMediaBatchMaxItems))
	}
	seen := map[string]bool{}
	for index, item := range args.Items {
		if err := validateCloudAgentID(item.NodeID, "占位节点 ID", 80); err != nil {
			return args, cloudAgentFieldError(fmt.Sprintf("items[%d].nodeId", index), "invalid_value", cloudAgentSafeToolError(err))
		}
		if seen[item.NodeID] {
			return args, cloudAgentFieldError(fmt.Sprintf("items[%d].nodeId", index), "duplicate", "同一批里每个占位节点只能出现一次")
		}
		seen[item.NodeID] = true
		if item.Duration < 0 || (item.Duration > 0 && args.Mode != "video") {
			return args, cloudAgentFieldError(fmt.Sprintf("items[%d].durationSeconds", index), "invalid_value", "只有视频条目可以单独设置时长")
		}
	}
	if args.Concurrency < 0 || args.Concurrency > 10 {
		return args, cloudAgentFieldError("concurrency", "invalid_value", "并发数必须在 1 到 10 之间")
	}
	if args.MaxRetries != nil && (*args.MaxRetries < 0 || *args.MaxRetries > cloudAgentMediaBatchMaxRetries) {
		return args, cloudAgentFieldError("maxRetriesPerItem", "invalid_value", fmt.Sprintf("每条最多重试 %d 次", cloudAgentMediaBatchMaxRetries))
	}
	return args, nil
}

// cloudAgentMediaBatchNodePrompt 读取占位节点里保存的提示词：生成合同优先，旧节点退回编辑器正文。
func cloudAgentMediaBatchNodePrompt(node map[string]any) string {
	meta, _ := node["metadata"].(map[string]any)
	if raw, exists := meta["generationSpec"]; exists {
		if encoded, err := json.Marshal(raw); err == nil {
			if spec, err := contract.Decode(encoded); err == nil && strings.TrimSpace(spec.Prompt) != "" {
				return strings.TrimSpace(spec.Prompt)
			}
		}
	}
	for _, key := range []string{"composerContent", "prompt"} {
		if text := strings.TrimSpace(stringValue(meta[key])); text != "" {
			return text
		}
	}
	return ""
}

// cloudAgentMediaBatchItemArgs 把一个占位节点换算成等价的 generate_media 参数：
// 提示词来自条目覆盖或节点本身，参考来自节点现有入边（按连线顺序），首尾帧来自节点字段。
func cloudAgentMediaBatchItemArgs(doc map[string]any, args cloudAgentMediaBatchArgs, index int) (cloudAgentMediaArgs, error) {
	field := func(name string) string { return fmt.Sprintf("items[%d].%s", index, name) }
	item := args.Items[index]
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return cloudAgentMediaArgs{}, err
	}
	node := nodes[item.NodeID]
	if node == nil {
		return cloudAgentMediaArgs{}, cloudAgentFieldError(field("nodeId"), "not_found", "占位节点不在当前画布；请重新读取画布并使用真实节点 ID")
	}
	if stringValue(node["type"]) != args.Mode {
		return cloudAgentMediaArgs{}, cloudAgentFieldError(field("nodeId"), "invalid_value", "占位节点类型与本批生成模式不一致；图片、视频、音频请分批")
	}
	if reason, issue := cloudAgentMediaTargetIssue(node, args.Mode); reason != "" {
		return cloudAgentMediaArgs{}, cloudAgentFieldError(field("nodeId"), reason, issue+"；请把它移出本批")
	}
	prompt := strings.TrimSpace(item.Prompt)
	if prompt == "" {
		prompt = cloudAgentMediaBatchNodePrompt(node)
	}
	if prompt == "" {
		return cloudAgentMediaArgs{}, cloudAgentFieldError(field("prompt"), "required", "占位节点没有提示词；请在条目里提供 prompt，或先用 canvas_apply_ops 写入节点提示词")
	}
	a := cloudAgentMediaArgs{
		Mode: args.Mode, Prompt: prompt, LogicalModelID: args.LogicalModelID, ChannelID: args.ChannelID, ChannelModelKey: args.ChannelModelKey,
		Size: args.Size, Quality: args.Quality, ImageResolution: args.ImageResolution, ImageParameters: args.ImageParameters, NodeID: item.NodeID,
		Title: strings.TrimSpace(stringValue(node["title"])), ReferenceNodeIDs: []string{},
	}
	if a.Title == "" {
		a.Title = map[string]string{"image": "图片创作", "video": "视频创作", "audio": "音频创作"}[args.Mode]
	}
	if args.Mode == "video" {
		a.Duration = args.Duration
		if item.Duration > 0 {
			a.Duration = item.Duration
		}
		a.VideoGenerateAudio = args.VideoGenerateAudio
		a.VideoWatermark = args.VideoWatermark
		a.VideoArkPrivateAssetUpload = args.VideoArkPrivateAssetUpload
	}
	seen := map[string]bool{}
	for _, edge := range creationMaps(doc["connections"]) {
		if stringValue(edge["toNodeId"]) != item.NodeID || stringValue(edge["fromHandleId"]) != "" || stringValue(edge["toHandleId"]) != "" {
			continue
		}
		fromID := stringValue(edge["fromNodeId"])
		source := nodes[fromID]
		if source == nil || seen[fromID] {
			continue
		}
		seen[fromID] = true
		switch {
		case cloudAgentCharacterNode(source):
			a.ReferenceNodeIDs = append(a.ReferenceNodeIDs, fromID)
		case stringValue(source["type"]) == "image" || stringValue(source["type"]) == "video" || stringValue(source["type"]) == "audio":
			a.ReferenceNodeIDs = append(a.ReferenceNodeIDs, fromID)
		case (stringValue(source["type"]) == "text" || stringValue(source["type"]) == "markdown") && a.SourceNodeID == "":
			a.SourceNodeID = fromID
		}
	}
	if len(a.ReferenceNodeIDs) > 16 {
		return cloudAgentMediaArgs{}, cloudAgentFieldError(field("nodeId"), "item_count", "占位节点的参考连线超过 16 个；请减少参考后再生成")
	}
	if args.Mode == "video" {
		meta, _ := node["metadata"].(map[string]any)
		for _, frame := range []struct {
			id     string
			target *string
		}{{stringValue(meta["videoStartFrameNodeId"]), &a.VideoStartFrameNodeID}, {stringValue(meta["videoEndFrameNodeId"]), &a.VideoEndFrameNodeID}} {
			if frame.id != "" && cloudAgentContainsString(a.ReferenceNodeIDs, frame.id) {
				*frame.target = frame.id
			}
		}
	}
	return a, nil
}

func cloudAgentMediaBatchItemCall(callID string, index int, a cloudAgentMediaArgs) (cloudAgentCall, error) {
	raw, err := json.Marshal(a)
	if err != nil {
		return cloudAgentCall{}, err
	}
	call := cloudAgentCall{ID: fmt.Sprintf("%s-item-%d", callID, index)}
	call.Function.Name, call.Function.Arguments = agenttool.GenerateMedia, string(raw)
	return call, nil
}

// cloudAgentMediaBatchProbeState 让条目准入按"未进入审批"的路径解析模型与规格：
// 批次没有单条 Prepared，也不能复用单条审批的报价。
func cloudAgentMediaBatchProbeState(state *cloudAgentRuntime) *cloudAgentRuntime {
	probe := *state
	probe.Approval = nil
	probe.AutoPreparedMedia = nil
	probe.AutoPreparedCallHash = ""
	return &probe
}

// cloudAgentResolvedMediaSpecHash 与 cloudAgentResolvedMediaHash 相同但不含提示词：
// 重试允许改写提示词，模型、规格和参考必须保持批准时的样子。
func cloudAgentResolvedMediaSpecHash(task *model.Task) (string, error) {
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return "", err
	}
	delete(input, "prompt")
	raw, err := json.Marshal(input)
	if err != nil {
		return "", err
	}
	clone := *task
	clone.InputJSON = string(raw)
	return cloudAgentResolvedMediaHash(&clone)
}

func cloudAgentMediaBatchResourceIDs(input map[string]any) []string {
	ids := []string{}
	seen := map[string]bool{}
	for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		for _, ref := range creationMaps(input[field]) {
			key := stringValue(ref["storageKey"])
			if !strings.HasPrefix(key, "resource:") {
				continue
			}
			id := strings.TrimPrefix(key, "resource:")
			if id != "" && !seen[id] {
				seen[id] = true
				ids = append(ids, id)
			}
		}
	}
	return ids
}

func cloudAgentCreditsLabel(micro int64) string {
	value := float64(micro) / float64(CreditScale)
	text := strconv.FormatFloat(math.Round(value*100)/100, 'f', -1, 64)
	return text + " 积分"
}

// cloudAgentMediaBatchItemAdmissionError 只把"去掉这一条就能继续"的问题交回模型修正；
// 预算、权限和模型不可用等问题保持原分类，由通用准入路径决定是否终止。
func cloudAgentMediaBatchItemAdmissionError(index int, err error) error {
	var argumentErr *cloudAgentArgumentError
	if errors.As(err, &argumentErr) {
		var fieldErr *cloudAgentFieldArgumentError
		if errors.As(err, &fieldErr) && !strings.HasPrefix(fieldErr.Field, "items[") {
			return cloudAgentFieldError(fmt.Sprintf("items[%d].%s", index, fieldErr.Field), fieldErr.Issue, cloudAgentSafeToolError(err))
		}
		return err
	}
	var admissionErr *cloudAgentMediaAdmissionError
	if errors.As(err, &admissionErr) {
		switch admissionErr.Reason {
		case "task_bound", "output_exists", "target_locked", "target_not_idle", "target_type_mismatch", "snapshot_conflict":
			return cloudAgentFieldError(fmt.Sprintf("items[%d].nodeId", index), admissionErr.Reason, cloudAgentSafeToolError(err)+"；请把它移出本批或重新读取画布")
		}
	}
	return err
}

type cloudAgentMediaBatchPrepared struct {
	plan  *cloudAgentMediaPlan
	item  cloudAgentMediaBatchItem
	model string
}

// requestCloudAgentMediaBatchApproval 逐条做无扣费准入，建好草稿节点后发出一张审批卡。
func (s *Service) requestCloudAgentMediaBatchApproval(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	args, err := decodeCloudAgentMediaBatchArgs(call.Function.Arguments)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
	}
	limit := policy.Task.ActiveTaskLimit
	if limit <= 0 {
		limit = 1
	}
	concurrency := args.Concurrency
	if concurrency == 0 {
		concurrency = cloudAgentMediaBatchDefaultSlots
	}
	if concurrency > limit {
		concurrency = limit
	}
	maxRetries := 1
	if args.MaxRetries != nil {
		maxRetries = *args.MaxRetries
	}
	if active, countErr := s.repo.ActiveTaskCountForUser(run.UserID); countErr == nil && active >= int64(limit) {
		return s.cloudAgentMediaError(run, state, "admission", false, false, &cloudAgentMediaAdmissionError{
			error: BadAuthRequest(fmt.Sprintf("当前已有 %d 个任务在排队或运行，达到同时任务上限；请等它们完成后再申请批次", active)), Reason: "active_task_limit", Retryable: true,
		})
	}
	canvas, err := s.repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	probe := cloudAgentMediaBatchProbeState(state)
	prepared := make([]cloudAgentMediaBatchPrepared, 0, len(args.Items))
	var total int64
	videoSeconds := 0
	for index := range args.Items {
		itemArgs, err := cloudAgentMediaBatchItemArgs(doc, args, index)
		if err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		itemCall, err := cloudAgentMediaBatchItemCall(call.ID, index, itemArgs)
		if err != nil {
			return err
		}
		req, plan, err := s.prepareCloudAgentMedia(run, probe, itemCall)
		if err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentMediaBatchItemAdmissionError(index, err))
		}
		preparation := &creationTaskPreparation{}
		req.creationPrepare = preparation
		task, err := s.CreateTask(run.UserID, req)
		if err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentMediaBatchItemAdmissionError(index, err))
		}
		if err := applyCloudAgentResolvedMediaDefaults(&req, plan, task); err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentMediaBatchItemAdmissionError(index, err))
		}
		resolvedHash, err := cloudAgentResolvedMediaHash(task)
		if err != nil {
			return err
		}
		specHash, err := cloudAgentResolvedMediaSpecHash(task)
		if err != nil {
			return err
		}
		modelName, err := s.cloudAgentMediaModelName(plan.Args)
		if err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentMediaBatchItemAdmissionError(index, err))
		}
		stored := plan.Args
		stored.Prompt, stored.SnapshotHash, stored.ConfigurationChange = itemArgs.Prompt, "", nil
		raw, err := json.Marshal(stored)
		if err != nil {
			return err
		}
		amount := int64(0)
		if preparation.Order != nil {
			amount = preparation.Order.AmountMicrocredits
		}
		total += amount
		videoSeconds += plan.Args.Duration
		prepared = append(prepared, cloudAgentMediaBatchPrepared{plan: plan, model: modelName, item: cloudAgentMediaBatchItem{
			NodeID: plan.Args.NodeID, Title: plan.Args.Title, Arguments: string(raw), ResolvedHash: resolvedHash, SpecHash: specHash,
			Amount: amount, Duration: plan.Args.Duration, ResourceIDs: cloudAgentMediaBatchResourceIDs(req.Input), Status: cloudAgentMediaBatchItemPending,
		}})
	}
	budget := state.Request.Budget
	// 预算不足是"拆小一点就能继续"的问题：按参数错误交回模型，由它拆批或告诉用户调高预算。
	if budget.MaxGenerationTasks > 0 && state.Generations+len(prepared) > budget.MaxGenerationTasks {
		return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentFieldError("items", "item_count", fmt.Sprintf("本轮最多还能生成 %d 条，本批有 %d 条；请拆批，或请用户调高本轮生成次数预算", budget.MaxGenerationTasks-state.Generations, len(prepared))))
	}
	if args.Mode == "video" && budget.MaxVideoSeconds > 0 && state.VideoSeconds+videoSeconds > budget.MaxVideoSeconds {
		return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentFieldError("items", "item_count", fmt.Sprintf("本批视频共 %d 秒，超过本轮剩余视频时长预算 %d 秒；请拆批，或请用户调高预算", videoSeconds, budget.MaxVideoSeconds-state.VideoSeconds)))
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if total > remaining {
		return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentFieldError("items", "item_count", fmt.Sprintf("本批预计 %s，超过本轮剩余积分预算 %s；请拆批，或请用户调高本轮积分预算", cloudAgentCreditsLabel(total), cloudAgentCreditsLabel(remaining))))
	}
	approvalID := fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex)
	batch := &cloudAgentMediaBatch{
		ID: approvalID, CallID: call.ID, Mode: args.Mode, ModelName: prepared[0].model, Phase: cloudAgentMediaBatchPhaseApproval,
		Concurrency: concurrency, Canary: args.Canary && len(prepared) > 1, MaxRetries: maxRetries,
		CapMicrocredits: total * int64(1+maxRetries), Items: make([]cloudAgentMediaBatchItem, 0, len(prepared)),
	}
	for _, entry := range prepared {
		batch.Items = append(batch.Items, entry.item)
	}
	if raw, err := json.Marshal(batch); err != nil {
		return err
	} else if len(raw) > cloudAgentMediaBatchStateLimit {
		return s.cloudAgentMediaError(run, state, "admission", false, false, cloudAgentFieldError("items", "item_count", "本批条目的提示词合计过长，请拆成两批"))
	}
	preview := cloudAgentMediaBatchApprovalPreview(batch, prepared)
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		resourceIDs := []string{}
		seen := map[string]bool{}
		for _, entry := range prepared {
			latest, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			if err != nil {
				return err
			}
			latestDoc, err := creationDocument(latest.PayloadJSON)
			if err != nil {
				return err
			}
			// 前面条目的草稿写入会推进画布；每条都基于事务内最新内容写自己的草稿。
			entry.plan.Args.SnapshotHash = cloudAgentMediaContentHash(latestDoc)
			if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, entry.plan, nil, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
				return err
			}
			for _, id := range entry.item.ResourceIDs {
				if !seen[id] {
					seen[id] = true
					resourceIDs = append(resourceIDs, id)
				}
			}
		}
		if len(resourceIDs) > 0 {
			if err := repo.UpsertCloudAgentResourceLeases(run.UserID, run.ID, approvalID, resourceIDs, time.Now().UTC().Add(cloudAgentMediaBatchLeaseLifetime)); err != nil {
				return err
			}
		}
		state.MediaBatch = batch
		state.Approval = &cloudAgentApproval{ID: approvalID, Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, ModelName: batch.ModelName}
		state.PiResumePrompt = ""
		current.Status = "waiting_approval"
		state.event(run.ID, "approval_requested", map[string]any{
			"approvalId": approvalID, "toolName": call.Function.Name, "modelName": batch.ModelName,
			"arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description,
			"batch": cloudAgentMediaBatchSummary(batch, false),
		})
		return cloudAgentSave(current, state)
	})
}

func cloudAgentMediaBatchApprovalPreview(batch *cloudAgentMediaBatch, prepared []cloudAgentMediaBatchPrepared) cloudAgentApprovalPreview {
	descriptor, _ := cloudAgentNodeCapabilityForGenerationMode(batch.Mode)
	var total int64
	items := make([]cloudAgentApprovalPreviewItem, 0, len(prepared))
	for index, entry := range prepared {
		total += entry.item.Amount
		args := entry.plan.Args
		details := []string{fmt.Sprintf("单价：%s", cloudAgentCreditsLabel(entry.item.Amount))}
		if entry.model != batch.ModelName {
			details = append(details, "模型："+truncateRunes(entry.model, 80))
		}
		if len(args.ReferenceNodeIDs) > 0 {
			details = append(details, fmt.Sprintf("参考 %d 个", len(args.ReferenceNodeIDs)))
		}
		if args.Duration > 0 {
			details = append(details, fmt.Sprintf("时长：%d 秒", args.Duration))
		}
		if index == 0 && batch.Canary {
			details = append(details, "先试跑这一条")
		}
		var promptHint struct {
			Prompt string `json:"prompt"`
		}
		_ = json.Unmarshal([]byte(entry.item.Arguments), &promptHint)
		items = append(items, cloudAgentApprovalPreviewItem{
			Operation: "generate_media_item", NodeID: args.NodeID, NodeTitle: truncateRunes(args.Title, 120),
			NodeType: descriptor.Type, NodeTypeLabel: descriptor.Label, Details: details,
			Summary: truncateRunes(strings.Join(strings.Fields(promptHint.Prompt), " "), 90),
		})
	}
	spec := []string{}
	first := prepared[0].plan.Args
	for _, value := range []string{first.Size, first.Quality, first.ImageResolution} {
		if strings.TrimSpace(value) != "" {
			spec = append(spec, value)
		}
	}
	description := fmt.Sprintf("一次批准 %d 个%s生成：模型 %s", len(items), descriptor.Label, truncateRunes(batch.ModelName, 60))
	if len(spec) > 0 {
		description += "，规格 " + strings.Join(spec, " · ")
	}
	description += fmt.Sprintf("；预计 %s，并发 %d", cloudAgentCreditsLabel(total), batch.Concurrency)
	if batch.MaxRetries > 0 {
		description += fmt.Sprintf("；每条最多重试 %d 次，本批总额上限 %s", batch.MaxRetries, cloudAgentCreditsLabel(batch.CapMicrocredits))
	}
	if batch.Canary {
		description += "；先试跑第 1 条，结果交给 Agent 确认后再放行其余条目"
	}
	description += "。草稿节点已建好，批准后才提交收费任务，结果逐条回写画布。"
	return cloudAgentApprovalPreview{
		Kind: "media_batch", Title: fmt.Sprintf("确认批量生成 %d 个%s", len(items), descriptor.Label),
		Description: description, Items: items,
	}
}

// cloudAgentMediaBatchSummary 是事件与工具回执共用的批次摘要；条目只带状态，不带提示词。
func cloudAgentMediaBatchSummary(batch *cloudAgentMediaBatch, includeAll bool) map[string]any {
	counts := batch.counts()
	items := []map[string]any{}
	for index, item := range batch.Items {
		if !includeAll && item.Status == cloudAgentMediaBatchItemPending && len(batch.Items) > 12 {
			continue
		}
		entry := map[string]any{"index": index, "nodeId": item.NodeID, "title": truncateRunes(item.Title, 60), "status": item.Status}
		if taskID := item.taskID(); taskID != "" {
			entry["taskId"] = taskID
		}
		if item.Error != "" {
			entry["error"] = truncateRunes(item.Error, 90)
		}
		if item.Attempts > 0 {
			entry["attempts"] = item.Attempts
		}
		items = append(items, entry)
	}
	return map[string]any{
		"batchId": batch.ID, "mode": batch.Mode, "phase": batch.Phase, "concurrency": batch.Concurrency,
		"total": counts["total"], "pending": counts[cloudAgentMediaBatchItemPending], "submitted": counts[cloudAgentMediaBatchItemSubmitted],
		"succeeded": counts[cloudAgentMediaBatchItemSucceeded], "failed": counts[cloudAgentMediaBatchItemFailed], "cancelled": counts[cloudAgentMediaBatchItemCancelled],
		"items": items,
	}
}

func (s *Service) emitCloudAgentMediaBatchProgress(runID string, state *cloudAgentRuntime, changed ...int) {
	batch := state.MediaBatch
	if batch == nil {
		return
	}
	summary := cloudAgentMediaBatchSummary(batch, true)
	if len(changed) > 0 {
		items := []map[string]any{}
		all, _ := summary["items"].([]map[string]any)
		for _, index := range changed {
			if index >= 0 && index < len(all) {
				items = append(items, all[index])
			}
		}
		summary["items"] = items
		summary["delta"] = true
	}
	counts := batch.counts()
	summary["text"] = fmt.Sprintf("批量生成：完成 %d / %d，运行 %d，失败 %d", counts[cloudAgentMediaBatchItemSucceeded], counts["total"], counts[cloudAgentMediaBatchItemSubmitted], counts[cloudAgentMediaBatchItemFailed])
	summary["callId"] = batch.CallID
	state.event(runID, "media_batch_progress", summary)
}

// startCloudAgentMediaBatch 在用户批准后打开批次；真正的提交由后台执行器完成。
func (s *Service) startCloudAgentMediaBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	batch := state.MediaBatch
	if batch == nil || batch.ID != state.Approval.ID || batch.CallID != call.ID {
		return s.terminateCloudAgent(run, "批量生成审批与待执行批次不一致，本轮已停止")
	}
	if batch.active() {
		return nil
	}
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		batch.Phase = cloudAgentMediaBatchPhaseRunning
		if batch.Canary {
			batch.Phase = cloudAgentMediaBatchPhaseCanary
		}
		s.emitCloudAgentMediaBatchProgress(run.ID, state)
		return cloudAgentSave(current, state)
	})
}

func (s *Service) startCloudAgentMediaBatchRunner(userID, runID string) {
	if s == nil || runID == "" {
		return
	}
	key := "batch:" + runID
	ctx, cancel := context.WithCancel(context.Background())
	s.approvedMediaMu.Lock()
	if s.approvedMediaClosed {
		s.approvedMediaMu.Unlock()
		cancel()
		return
	}
	if s.approvedMediaWaiters == nil {
		s.approvedMediaWaiters = make(map[string]context.CancelFunc)
	}
	if _, exists := s.approvedMediaWaiters[key]; exists {
		s.approvedMediaMu.Unlock()
		cancel()
		return
	}
	s.approvedMediaWaiters[key] = cancel
	s.approvedMediaWg.Add(1)
	s.approvedMediaMu.Unlock()
	go func() {
		defer func() {
			cancel()
			s.approvedMediaMu.Lock()
			delete(s.approvedMediaWaiters, key)
			s.approvedMediaMu.Unlock()
			s.approvedMediaWg.Done()
		}()
		if err := s.runCloudAgentMediaBatch(ctx, userID, runID); err != nil && !errors.Is(err, context.Canceled) {
			log.Printf("[Agent] media batch runner failed run=%s: %v", runID, err)
			s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)))
		}
	}()
}

func (s *Service) runCloudAgentMediaBatch(ctx context.Context, userID, runID string) error {
	conflicts := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		done, err := s.stepCloudAgentMediaBatch(ctx, userID, runID)
		switch {
		case errors.Is(err, repository.ErrCreationConflict):
			conflicts++
			if conflicts > 50 {
				return err
			}
			time.Sleep(time.Duration(min(conflicts, 10)) * 20 * time.Millisecond)
			continue
		case err != nil:
			return err
		case done:
			return nil
		}
		conflicts = 0
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(cloudAgentMediaBatchPollInterval):
		}
	}
}

// stepCloudAgentMediaBatch 推进一轮：先回写已结束的条目，再判断阶段，最后按空余并发提交。
// 返回 true 表示执行器可以退出（阶段已结束或批次已收尾）。
func (s *Service) stepCloudAgentMediaBatch(ctx context.Context, userID, runID string) (bool, error) {
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return false, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false, err
	}
	batch := state.MediaBatch
	if batch == nil {
		return true, nil
	}
	for index, item := range batch.Items {
		if item.Status != cloudAgentMediaBatchItemSubmitted {
			continue
		}
		task, err := s.repo.TaskForUser(userID, item.taskID())
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, s.settleCloudAgentMediaBatchItem(run, &state, index, nil)
		}
		if err != nil {
			return false, err
		}
		if cloudAgentTaskTerminal(task.Status) {
			return false, s.settleCloudAgentMediaBatchItem(run, &state, index, task)
		}
	}
	if cloudAgentRunTerminal(run.Status) {
		return s.closeCloudAgentMediaBatchAfterStop(ctx, run, &state)
	}
	if !batch.active() {
		return batch.inFlight() == 0, nil
	}
	if batch.Phase == cloudAgentMediaBatchPhaseCanary && batch.Items[0].Status != cloudAgentMediaBatchItemPending && batch.Items[0].Status != cloudAgentMediaBatchItemSubmitted {
		return s.finishCloudAgentMediaBatchPhase(run, &state, cloudAgentMediaBatchPhaseCanaryDone)
	}
	next := batch.nextPending()
	if next < 0 && batch.inFlight() == 0 {
		return s.finishCloudAgentMediaBatchPhase(run, &state, cloudAgentMediaBatchPhaseDone)
	}
	if next < 0 || batch.inFlight() >= batch.Concurrency {
		return false, nil
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return false, err
	}
	if active, err := s.repo.ActiveTaskCountForUser(userID); err != nil {
		return false, err
	} else if active >= int64(policy.Task.ActiveTaskLimit) {
		return false, nil
	}
	err = s.submitCloudAgentMediaBatchItem(run, &state, next, policy)
	if errors.Is(err, errCloudAgentMediaBatchWait) {
		return false, nil
	}
	return false, err
}

func (s *Service) markCloudAgentMediaBatchItemFailed(run *model.CloudAgentExecution, state *cloudAgentRuntime, index int, message string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		item := &state.MediaBatch.Items[index]
		item.Status, item.Error = cloudAgentMediaBatchItemFailed, truncateRunes(message, 200)
		s.emitCloudAgentMediaBatchProgress(run.ID, state, index)
		return cloudAgentSave(current, state)
	})
}

func (s *Service) submitCloudAgentMediaBatchItem(run *model.CloudAgentExecution, state *cloudAgentRuntime, index int, policy RuntimePolicySetting) error {
	batch := state.MediaBatch
	item := batch.Items[index]
	budget := state.Request.Budget
	if budget.MaxGenerationTasks > 0 && state.Generations >= budget.MaxGenerationTasks {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "已达到本轮媒体生成次数上限，未提交")
	}
	if batch.Mode == "video" && budget.MaxVideoSeconds > 0 && state.VideoSeconds+item.Duration > budget.MaxVideoSeconds {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "已超过本轮视频时长预算，未提交")
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(budget.MaxCredits * float64(CreditScale)))
	batchTasks := map[string]bool{}
	for _, entry := range batch.Items {
		for _, id := range entry.TaskIDs {
			batchTasks[id] = true
		}
	}
	var batchSpent int64
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
		if batchTasks[order.TaskID] {
			batchSpent += order.AmountMicrocredits
		}
	}
	maxCharge := item.Amount
	if remaining < maxCharge || batch.CapMicrocredits-batchSpent < maxCharge {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "本轮积分预算或批次总额上限不足，未提交")
	}
	var a cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(item.Arguments), &a); err != nil {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "批次条目参数无效，未提交")
	}
	call, err := cloudAgentMediaBatchItemCall(batch.CallID, index, a)
	if err != nil {
		return err
	}
	probe := cloudAgentMediaBatchProbeState(state)
	// Stored item arguments already contain the user-approved model and specs.
	// Do not inherit the pre-approval draft configuration again at submission.
	// The empty approval disables inheritance without reusing a single-item quote.
	probe.Approval = &cloudAgentApproval{}
	req, plan, err := s.prepareCloudAgentMedia(run, probe, call)
	if err != nil {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "提交前校验未通过："+cloudAgentSafeToolError(err))
	}
	preparation := &creationTaskPreparation{}
	req.creationPrepare = preparation
	req.admission = &taskAdmission{
		ID:        cloudAgentID(run.UserID, fmt.Sprintf("%s:batch:%s:%d:%d", run.ID, batch.ID, index, item.Attempts)),
		MaxCharge: maxCharge, AgentRunID: run.ID, GenerationID: newID(), ApprovalID: batch.ID,
	}
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		if strings.Contains(err.Error(), "同时排队或运行的任务") {
			return errCloudAgentMediaBatchWait
		}
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "提交前校验未通过："+cloudAgentSafeToolError(err))
	}
	if item.PromptChanged {
		if hash, hashErr := cloudAgentResolvedMediaSpecHash(task); hashErr != nil || hash != item.SpecHash {
			return s.markCloudAgentMediaBatchItemFailed(run, state, index, "模型或规格与批准时不同，未提交；需要重新申请批次")
		}
	} else if hash, hashErr := cloudAgentResolvedMediaHash(task); hashErr != nil || hash != item.ResolvedHash {
		return s.markCloudAgentMediaBatchItemFailed(run, state, index, "节点内容、参考或规格与批准时不同，未提交；需要重新申请批次")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return err
	}
	task.InputJSON = string(raw)
	if preparation.Order != nil {
		task.BillingOrderID = preparation.Order.ID
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
		if err != nil {
			return err
		}
		doc, err := creationDocument(canvas.PayloadJSON)
		if err != nil {
			return err
		}
		plan.Args.SnapshotHash = cloudAgentMediaContentHash(doc)
		if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, plan, task, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
			return err
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, preparation.Order, policy); err != nil {
			return err
		}
		if len(item.ResourceIDs) > 0 {
			if err := repo.UpsertCloudAgentResourceLeases(run.UserID, run.ID, "task:"+task.ID, item.ResourceIDs, time.Now().UTC().Add(cloudAgentMediaBatchTaskLease)); err != nil {
				return err
			}
		}
		state.TaskIDs = append(state.TaskIDs, task.ID)
		state.Generations++
		state.VideoSeconds += plan.Args.Duration
		entry := &state.MediaBatch.Items[index]
		entry.Status, entry.Error = cloudAgentMediaBatchItemSubmitted, ""
		entry.TaskIDs = append(entry.TaskIDs, task.ID)
		s.emitCloudAgentMediaBatchProgress(run.ID, state, index)
		return cloudAgentSave(current, state)
	})
}

func (s *Service) settleCloudAgentMediaBatchItem(run *model.CloudAgentExecution, state *cloudAgentRuntime, index int, task *model.Task) error {
	item := state.MediaBatch.Items[index]
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		entry := &state.MediaBatch.Items[index]
		if task == nil {
			entry.Status, entry.Error = cloudAgentMediaBatchItemFailed, "任务记录不存在或已失去归属，结果未回写画布"
			s.emitCloudAgentMediaBatchProgress(run.ID, state, index)
			return cloudAgentSave(current, state)
		}
		before, readErr := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
		nodeID, writeErr := completeCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, item.NodeID, task, policy)
		if writeErr != nil {
			var appErr *AppError
			if !errors.Is(writeErr, gorm.ErrRecordNotFound) && !(errors.As(writeErr, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
				return writeErr
			}
		}
		if nodeID != "" {
			if readErr != nil {
				return readErr
			}
			if err := emitCloudAgentCanvasChange(repo, run.ID, state, cloudAgentMutationInput{UserID: run.UserID, CanvasID: state.Request.CanvasID, BeforeJSON: before.PayloadJSON, Operation: "generate_media_complete"}); err != nil {
				return err
			}
		}
		switch {
		case task.Status == model.TaskStatusSucceeded && writeErr == nil:
			entry.Status, entry.Error = cloudAgentMediaBatchItemSucceeded, ""
			cloudAgentInvalidateReadCache(state)
			recordTaskWritebackDiagnostic(task, item.NodeID, "succeeded", "", nil)
		case writeErr != nil:
			entry.Status = cloudAgentMediaBatchItemFailed
			entry.Error = "画布回写未完成：" + truncateRunes(cloudAgentSafeToolError(writeErr), 80)
			recordTaskWritebackDiagnostic(task, item.NodeID, "failed", "canvas_writeback_failed", writeErr)
		default:
			message := truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
			if !cloudAgentSafeUserMessage(message) {
				message = "媒体任务未成功"
			}
			entry.Status, entry.Error = cloudAgentMediaBatchItemFailed, message
			recordTaskWritebackDiagnostic(task, item.NodeID, "succeeded", "", nil)
		}
		if err := repo.UpdateTaskExecutionDiagnostic(run.UserID, task.ID, task.ExecutionDiagnosticJSON); err != nil {
			return err
		}
		s.emitCloudAgentMediaBatchProgress(run.ID, state, index)
		return cloudAgentSave(current, state)
	})
}

func cloudAgentMediaBatchResult(batch *cloudAgentMediaBatch) map[string]any {
	result := cloudAgentMediaBatchSummary(batch, false)
	failed := []string{}
	for index, item := range batch.Items {
		if item.Status == cloudAgentMediaBatchItemFailed {
			label := fmt.Sprintf("#%d《%s》", index+1, truncateRunes(item.Title, 30))
			if item.Error != "" {
				label += "：" + truncateRunes(item.Error, 40)
			}
			failed = append(failed, label)
		}
	}
	counts := batch.counts()
	switch batch.Phase {
	case cloudAgentMediaBatchPhaseCanaryDone:
		canary := batch.Items[0]
		result["summary"] = fmt.Sprintf("试跑完成：第 1 条%s，其余 %d 条等待放行", map[string]string{cloudAgentMediaBatchItemSucceeded: "成功", cloudAgentMediaBatchItemFailed: "失败"}[canary.Status], counts[cloudAgentMediaBatchItemPending])
		result["next"] = "成功时先用 canvas_inspect_image 查看试跑结果，再调用 media_batch_control（action=continue）放行其余条目；失败时按原因调整后用 action=retry 重试第 1 条，或 action=cancel 结束本批"
	default:
		summary := fmt.Sprintf("批次完成：成功 %d / %d", counts[cloudAgentMediaBatchItemSucceeded], counts["total"])
		if len(failed) > 0 {
			summary += "，失败 " + strings.Join(failed, "；")
		}
		if counts[cloudAgentMediaBatchItemCancelled] > 0 {
			summary += fmt.Sprintf("，取消 %d", counts[cloudAgentMediaBatchItemCancelled])
		}
		result["summary"] = truncateRunes(summary, 600)
		result["next"] = "结果已逐条回写画布节点。可用 canvas_inspect_image 抽查画面；失败或不满意的条目可在重试额度内调用 media_batch_control（action=retry）重跑，不会再次审批"
	}
	return result
}

// finishCloudAgentMediaBatchPhase 记录当前调用的工具结果并把运行交回 Agent。
func (s *Service) finishCloudAgentMediaBatchPhase(run *model.CloudAgentExecution, state *cloudAgentRuntime, phase string) (bool, error) {
	// 发起本阶段的 Pi 会话还没退出时先等：否则恢复提示词和旧会话会同时继续本轮。
	if s.cloudAgentPiSessionLive(run.ID) {
		return false, nil
	}
	batch := state.MediaBatch
	if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) || state.Calls[state.CallIndex].ID != batch.CallID {
		return true, s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			batch.Phase = phase
			return cloudAgentSave(current, state)
		})
	}
	call := state.Calls[state.CallIndex]
	err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		batch.Phase = phase
		if phase == cloudAgentMediaBatchPhaseDone && !cloudAgentMediaBatchRetryable(batch) {
			if err := repo.ReleaseCloudAgentResourceLeases(run.UserID, batch.ID); err != nil {
				return err
			}
		}
		result := cloudAgentMediaBatchResult(batch)
		s.emitCloudAgentMediaBatchProgress(run.ID, state)
		cloudAgentToolResult(run.ID, state, call, result, nil)
		prompt := "批量生成" + map[string]string{cloudAgentMediaBatchPhaseCanaryDone: "试跑", cloudAgentMediaBatchPhaseDone: "批次"}[phase] + "已结束，回执如下：\n" +
			truncateRunes(stringValue(result["summary"]), 600) + "\n" + stringValue(result["next"]) + "\n不要重复调用 generate_media_batch 提交同一批节点。"
		if state.CallIndex < len(state.Calls) {
			prompt += " 你上一步同批发出的其余调用未被执行，仍需要请重发。"
		}
		state.PiResumePrompt = prompt
		return cloudAgentSave(current, state)
	})
	if err != nil {
		return false, err
	}
	latest, err := s.repo.CloudAgent(run.UserID, run.ID)
	if err != nil {
		return false, err
	}
	fresh, err := cloudAgentDecode(latest)
	if err != nil {
		return false, err
	}
	return true, s.resumeCloudAgentAfterApproval(run.UserID, run.ID, &fresh)
}

func cloudAgentMediaBatchRetryable(batch *cloudAgentMediaBatch) bool {
	for _, item := range batch.Items {
		if item.Attempts < batch.MaxRetries && (item.Status == cloudAgentMediaBatchItemFailed || item.Status == cloudAgentMediaBatchItemSucceeded) {
			return true
		}
	}
	return false
}

// closeCloudAgentMediaBatchAfterStop 处理已停止或失败的运行：未提交的条目取消，
// 在途任务由收尾流程决定继续或取消，全部落定后释放批次租约并完成收尾。
func (s *Service) closeCloudAgentMediaBatchAfterStop(ctx context.Context, run *model.CloudAgentExecution, state *cloudAgentRuntime) (bool, error) {
	batch := state.MediaBatch
	changed := []int{}
	for index, item := range batch.Items {
		if item.Status == cloudAgentMediaBatchItemPending {
			changed = append(changed, index)
		}
	}
	if len(changed) > 0 || batch.active() {
		err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			for _, index := range changed {
				state.MediaBatch.Items[index].Status = cloudAgentMediaBatchItemCancelled
			}
			if batch.inFlight() == 0 {
				batch.Phase = cloudAgentMediaBatchPhaseDone
			}
			s.emitCloudAgentMediaBatchProgress(run.ID, state, changed...)
			return cloudAgentSave(current, state)
		})
		if err != nil {
			return false, err
		}
		return false, nil
	}
	if batch.inFlight() > 0 {
		return false, nil
	}
	if err := s.repo.ReleaseCloudAgentResourceLeases(run.UserID, batch.ID); err != nil {
		return false, err
	}
	latest, err := s.repo.CloudAgent(run.UserID, run.ID)
	if err != nil {
		return false, err
	}
	return true, s.finishCloudAgentCleanup(ctx, latest)
}

func (s *Service) cloudAgentPiSessionLive(runID string) bool {
	if s == nil {
		return false
	}
	s.piRunnerMu.Lock()
	defer s.piRunnerMu.Unlock()
	_, live := s.piRunners[runID]
	return live
}

// cloudAgentMediaBatchControlArgs 是 media_batch_control 的参数：只能在已批准的明细和额度内操作。
type cloudAgentMediaBatchControlArgs struct {
	Action string `json:"action"`
	Items  []struct {
		Index  *int   `json:"index"`
		NodeID string `json:"nodeId"`
		Prompt string `json:"prompt"`
	} `json:"items"`
}

func (s *Service) advanceCloudAgentMediaBatchControl(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	var args cloudAgentMediaBatchControlArgs
	record := func(result any, toolErr error) error {
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			cloudAgentRecordToolResult(current, state, call, result, toolErr)
			return cloudAgentSave(current, state)
		})
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return record(nil, cloudAgentJSONArgumentError(err))
	}
	batch := state.MediaBatch
	if batch == nil || batch.Phase == cloudAgentMediaBatchPhaseApproval {
		return record(nil, cloudAgentFieldError("action", "invalid_value", "本轮没有已批准的批次；请先调用 generate_media_batch 申请批准"))
	}
	if batch.active() {
		return record(nil, cloudAgentFieldError("action", "invalid_value", "批次仍在执行，等它结束后再操作"))
	}
	switch args.Action {
	case "status":
		return record(cloudAgentMediaBatchResult(batch), nil)
	case "cancel":
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			changed := []int{}
			for index := range batch.Items {
				if batch.Items[index].Status == cloudAgentMediaBatchItemPending {
					batch.Items[index].Status = cloudAgentMediaBatchItemCancelled
					changed = append(changed, index)
				}
			}
			batch.Phase = cloudAgentMediaBatchPhaseDone
			batch.MaxRetries = 0
			if err := repo.ReleaseCloudAgentResourceLeases(run.UserID, batch.ID); err != nil {
				return err
			}
			s.emitCloudAgentMediaBatchProgress(run.ID, state, changed...)
			cloudAgentRecordToolResult(current, state, call, cloudAgentMediaBatchResult(batch), nil)
			return cloudAgentSave(current, state)
		})
	case "continue":
		if batch.Phase != cloudAgentMediaBatchPhaseCanaryDone {
			return record(nil, cloudAgentFieldError("action", "invalid_value", "只有试跑结束后才需要放行；批次已全部执行"))
		}
	case "retry":
		if len(args.Items) == 0 || len(args.Items) > len(batch.Items) {
			return record(nil, cloudAgentFieldError("items", "required", "retry 需要列出要重跑的条目（index 或 nodeId）"))
		}
	default:
		return record(nil, cloudAgentFieldError("action", "invalid_value", "action 只能是 continue、retry、cancel 或 status"))
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		changed := []int{}
		if args.Action == "retry" {
			for position, request := range args.Items {
				index := -1
				if request.Index != nil {
					index = *request.Index
				} else {
					for candidate, item := range batch.Items {
						if item.NodeID == request.NodeID || cloudAgentContainsString(item.PreviousNodeIDs, request.NodeID) {
							index = candidate
						}
					}
				}
				if index < 0 || index >= len(batch.Items) {
					return cloudAgentFieldError(fmt.Sprintf("items[%d]", position), "not_found", "条目不在本批里")
				}
				item := &batch.Items[index]
				if item.Status != cloudAgentMediaBatchItemFailed && item.Status != cloudAgentMediaBatchItemSucceeded {
					return cloudAgentFieldError(fmt.Sprintf("items[%d]", position), "invalid_value", "只有已结束的条目可以重跑")
				}
				if item.Attempts >= batch.MaxRetries {
					return cloudAgentFieldError(fmt.Sprintf("items[%d]", position), "item_count", "该条目已用完批准的重试次数；需要再跑请重新申请批次")
				}
				if err := cloudAgentPrepareMediaBatchRetry(repo, run.UserID, state.Request.CanvasID, run.ID, item, strings.TrimSpace(request.Prompt), policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
					return err
				}
				changed = append(changed, index)
			}
		}
		batch.CallID = call.ID
		batch.Phase = cloudAgentMediaBatchPhaseRunning
		s.emitCloudAgentMediaBatchProgress(run.ID, state, changed...)
		return cloudAgentSave(current, state)
	})
	s.storageMu.Unlock()
	if err != nil {
		var argumentErr *cloudAgentArgumentError
		if errors.As(err, &argumentErr) {
			latest, readErr := s.repo.CloudAgent(run.UserID, run.ID)
			if readErr != nil {
				return err
			}
			fresh, decodeErr := cloudAgentDecode(latest)
			if decodeErr != nil {
				return err
			}
			run, *state = latest, fresh
			return record(nil, err)
		}
		return err
	}
	s.startCloudAgentMediaBatchRunner(run.UserID, run.ID)
	return nil
}

// cloudAgentPrepareMediaBatchRetry 为重跑准备目标节点：失败节点没有产物，重置为本轮草稿再用；
// 已成功的节点保留原结果，在旁边新建同款占位节点承接重跑，不覆盖用户已有的成品。
func cloudAgentPrepareMediaBatchRetry(repo *repository.Repository, userID, canvasID, runID string, item *cloudAgentMediaBatchItem, prompt string, policy RuntimePolicySetting, recorder cloudAgentMutationRecorder) error {
	var a cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(item.Arguments), &a); err != nil {
		return BadAuthRequest("批次条目参数无效")
	}
	if len([]rune(prompt)) > 16000 {
		return cloudAgentFieldError("items.prompt", "length_exceeded", "重跑提示词超过 16000 字符")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	before := canvas.PayloadJSON
	beforeHash := cloudAgentCanvasHash(doc)
	nodes := creationMaps(doc["nodes"])
	var original map[string]any
	for _, node := range nodes {
		if stringValue(node["id"]) == item.NodeID {
			original = node
		}
	}
	if original == nil {
		return cloudAgentFieldError("items.nodeId", "not_found", "原节点已被删除，无法重跑")
	}
	meta, _ := original["metadata"].(map[string]any)
	if meta["locked"] == true {
		return cloudAgentFieldError("items.nodeId", "target_locked", "原节点已锁定，无法重跑")
	}
	if item.Status == cloudAgentMediaBatchItemFailed && stringValue(meta["storageKey"]) == "" {
		for _, key := range []string{"taskId", "taskStatus", "taskStage", "taskProgress", "generationTaskId", "error", "errorDetails"} {
			delete(meta, key)
		}
		meta["status"], meta["agentDraftRunId"] = "idle", runID
		original["metadata"] = meta
	} else {
		width, _ := original["width"].(float64)
		height, _ := original["height"].(float64)
		if width <= 0 || height <= 0 {
			width, height = cloudAgentAddedNodeSize(stringValue(original["type"]))
		}
		position, _ := original["position"].(map[string]any)
		x, _ := position["x"].(float64)
		y, _ := position["y"].(float64)
		lane, _ := cloudAgentLayoutLane(stringValue(original["type"]))
		slot := layout.FreeSlot(width, height, lane, cloudAgentLayoutNodes(doc), &layout.Position{X: x + width + 24, Y: y}, 24)
		siblingID := cloudAgentID(userID, fmt.Sprintf("%s:retry:%s:%d", runID, item.NodeID, item.Attempts+1))
		spec, _ := meta["generationSpec"]
		sibling := creationAddedNode(CreationCanvasOp{Type: "add_node", ID: siblingID, NodeType: stringValue(original["type"]), Title: truncateRunes(stringValue(original["title"]), 200) + fmt.Sprintf(" · 重试%d", item.Attempts+1), X: &slot.X, Y: &slot.Y, Width: &width, Height: &height, Metadata: map[string]any{"status": "idle", "content": "", "agentDraftRunId": runID, "generationSpec": spec}})
		nodes = append(nodes, sibling)
		edges := creationMaps(doc["connections"])
		for _, edge := range creationMaps(doc["connections"]) {
			if stringValue(edge["toNodeId"]) == item.NodeID && stringValue(edge["toHandleId"]) == "" && stringValue(edge["fromHandleId"]) == "" {
				edges = append(edges, map[string]any{"id": "agent-" + newID(), "fromNodeId": edge["fromNodeId"], "toNodeId": siblingID})
			}
		}
		doc["connections"] = edges
		item.PreviousNodeIDs = append(item.PreviousNodeIDs, item.NodeID)
		item.NodeID = siblingID
		a.NodeID = siblingID
		a.Title = stringValue(sibling["title"])
	}
	doc["nodes"] = nodes
	if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
		return err
	}
	if recorder != nil {
		if err := recorder(repo, cloudAgentMutationInput{RunID: runID, UserID: userID, CanvasID: canvasID, StepID: item.NodeID, Operation: "generate_media_draft", BeforeSnapshotHash: beforeHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), BeforeJSON: before}); err != nil {
			return err
		}
	}
	if prompt != "" {
		a.Prompt = prompt
		item.PromptChanged = true
	}
	raw, err := json.Marshal(a)
	if err != nil {
		return err
	}
	item.Arguments = string(raw)
	item.Attempts++
	item.Status, item.Error = cloudAgentMediaBatchItemPending, ""
	return nil
}

// validateCloudAgentMediaBatch 是检查点不变量：激活的批次必须挂在当前调用上，且与单媒体任务互斥。
func validateCloudAgentMediaBatch(state *cloudAgentRuntime) error {
	batch := state.MediaBatch
	if batch == nil {
		return nil
	}
	if validateCloudAgentID(batch.ID, "批次 ID", 200) != nil || len(batch.Items) == 0 || len(batch.Items) > cloudAgentMediaBatchMaxItems || batch.Concurrency < 1 || batch.MaxRetries < 0 || batch.MaxRetries > cloudAgentMediaBatchMaxRetries {
		return errors.New("Agent runtime media batch is invalid")
	}
	switch batch.Phase {
	case cloudAgentMediaBatchPhaseApproval, cloudAgentMediaBatchPhaseCanary, cloudAgentMediaBatchPhaseCanaryDone, cloudAgentMediaBatchPhaseRunning, cloudAgentMediaBatchPhaseDone:
	default:
		return errors.New("Agent runtime media batch phase is invalid")
	}
	for _, item := range batch.Items {
		switch item.Status {
		case cloudAgentMediaBatchItemPending, cloudAgentMediaBatchItemSubmitted, cloudAgentMediaBatchItemSucceeded, cloudAgentMediaBatchItemFailed, cloudAgentMediaBatchItemCancelled:
		default:
			return errors.New("Agent runtime media batch item is invalid")
		}
		if item.Status == cloudAgentMediaBatchItemSubmitted && (item.taskID() == "" || !cloudAgentContainsString(state.TaskIDs, item.taskID())) {
			return errors.New("Agent runtime media batch task is not in task history")
		}
	}
	if batch.active() {
		if state.MediaTaskID != "" || state.ActiveTaskID != "" {
			return errors.New("Agent runtime has multiple active tasks")
		}
		if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) || state.Calls[state.CallIndex].ID != batch.CallID {
			return errors.New("Agent runtime media batch is not attached to current call")
		}
	}
	return nil
}
