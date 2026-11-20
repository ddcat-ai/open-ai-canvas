package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Only user-editable media options cross the approval boundary. Targets,
// references, prompt, snapshot and generation mode remain server-authored.
type CloudAgentMediaSettings struct {
	LogicalModelID             string `json:"logicalModelId,omitempty"`
	ChannelID                  string `json:"channelId,omitempty"`
	ChannelModelKey            string `json:"channelModelKey,omitempty"`
	Size                       string `json:"size"`
	ImageResolution            string `json:"imageResolution,omitempty"`
	ImageParameters            string `json:"imageParameters,omitempty"`
	Quality                    string `json:"quality"`
	DurationSeconds            *int   `json:"durationSeconds,omitempty"`
	VideoGenerateAudio         *bool  `json:"videoGenerateAudio,omitempty"`
	VideoWatermark             *bool  `json:"videoWatermark,omitempty"`
	VideoArkPrivateAssetUpload *bool  `json:"videoArkPrivateAssetUpload,omitempty"`
}

// updateCloudAgentMediaApproval rebuilds the complete prepared admission for an
// edited approval. It is called inside MutateCloudAgent so the new prepared
// hash, resource lease set and runtime checkpoint commit atomically.
func (s *Service) updateCloudAgentMediaApproval(repo *repository.Repository, run *model.CloudAgentExecution, state *cloudAgentRuntime, settings CloudAgentMediaSettings) error {
	if state == nil || state.Approval == nil {
		return creationConflict("审批不存在或已过期")
	}
	call := state.Approval.Call
	if call.Function.Name == "generate_media_batch" {
		return s.updateCloudAgentMediaBatchApproval(repo, run, state, settings)
	}
	if call.Function.Name != "generate_media" {
		return BadAuthRequest("当前审批不是媒体生成，不能修改生成参数")
	}
	var args cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return err
	}
	if err := applyCloudAgentMediaApprovalSettings(&args, settings); err != nil {
		return err
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	req, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return err
	}
	task, preparation, err := s.prepareCloudAgentEditedMedia(run, state, &req, plan)
	if err != nil {
		return err
	}
	args = plan.Args
	raw, err = json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	name, err := s.cloudAgentMediaModelName(args)
	if err != nil {
		return err
	}
	canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	prepared, err := prepareCloudAgentMediaApproval(repo, run.UserID, doc, plan, req, task, preparation.Order)
	if err != nil {
		return err
	}
	// Editing an approval changes the prepared inputs and quote, but it is still
	// the same user-approved generation intent until the user submits a new
	// generation from the canvas.
	if previous := state.Approval.Prepared; previous != nil && previous.GenerationID != "" {
		prepared.GenerationID = previous.GenerationID
		prepared.Hash = creationHash(prepared)
	}
	if err := replaceCloudAgentPreparedLeases(repo, run.UserID, run.ID, state.Approval.ID, prepared); err != nil {
		return err
	}
	state.Calls[state.CallIndex] = call
	state.Approval.Call = call
	state.Approval.CallHash = cloudAgentApprovalCallHash(call)
	state.Approval.ModelName = name
	state.Approval.Preview = cloudAgentMediaApprovalPreview(plan, name)
	state.Approval.Prepared = prepared
	return nil
}

func applyCloudAgentMediaApprovalSettings(args *cloudAgentMediaArgs, settings CloudAgentMediaSettings) error {
	if args.Mode != "image" && args.Mode != "video" {
		return BadAuthRequest("仅图片或视频生成审批支持修改模型和规格")
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = settings.LogicalModelID, settings.ChannelID, settings.ChannelModelKey
	// These settings now come directly from the user, not the Agent's proposal.
	args.ConfigurationChange = nil
	args.Size, args.ImageResolution, args.Quality = settings.Size, settings.ImageResolution, settings.Quality
	args.ImageParameters = settings.ImageParameters
	if args.Mode == "video" {
		if settings.DurationSeconds != nil {
			if *settings.DurationSeconds < 0 {
				return BadAuthRequest("视频时长不能为负数")
			}
			args.Duration = *settings.DurationSeconds
		}
		args.VideoGenerateAudio = settings.VideoGenerateAudio
		args.VideoWatermark = settings.VideoWatermark
		args.VideoArkPrivateAssetUpload = settings.VideoArkPrivateAssetUpload
	}
	if args.Mode == "image" && (settings.DurationSeconds != nil || settings.VideoGenerateAudio != nil || settings.VideoWatermark != nil || settings.VideoArkPrivateAssetUpload != nil) {
		return BadAuthRequest("视频参数仅适用于视频生成审批")
	}
	return nil
}

func (s *Service) prepareCloudAgentEditedMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, req *CreateTaskRequest, plan *cloudAgentMediaPlan) (*model.Task, *creationTaskPreparation, error) {
	// Dry admission uses the same model, ownership and option checks as task
	// submission, without reserving credits or creating a generation task.
	// DecideCloudAgentApproval already holds storageMu for this mutation.
	preparation := &creationTaskPreparation{}
	req.creationPrepare = preparation
	req.callerHoldsStorageMu = true
	task, err := s.CreateTask(run.UserID, *req)
	if err != nil {
		return nil, nil, err
	}
	var resolved map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
		return nil, nil, err
	}
	requested, _ := req.Input["config"].(map[string]any)
	if cloudAgentImageTierSelectorConsumed(requested, resolved) {
		// 用户在审批卡里点选的档位已换算进像素尺寸，不再作为质量参数参与核对。
		delete(requested, "quality")
		plan.Args.Quality = ""
	}
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
		return nil, nil, err
	}
	if err := applyCloudAgentResolvedMediaDefaults(req, plan, task); err != nil {
		return nil, nil, err
	}
	if err := validateCloudAgentMediaBudget(plan.Args, state); err != nil {
		return nil, nil, err
	}
	return task, preparation, nil
}

// Batch edits retain the server-prepared targets, prompts and references. Only
// editable settings are replaced, and every item is admitted again before the
// quote, leases and approval checkpoint are replaced in the same transaction.
func (s *Service) updateCloudAgentMediaBatchApproval(repo *repository.Repository, run *model.CloudAgentExecution, state *cloudAgentRuntime, settings CloudAgentMediaSettings) error {
	previous := state.MediaBatch
	call := state.Approval.Call
	if previous == nil || previous.ID != state.Approval.ID || previous.CallID != call.ID || previous.Phase != cloudAgentMediaBatchPhaseApproval {
		return creationConflict("批量生成审批不存在或已过期")
	}
	args, err := decodeCloudAgentMediaBatchArgs(call.Function.Arguments)
	if err != nil {
		return err
	}
	if len(args.Items) != len(previous.Items) {
		return creationConflict("批量生成审批条目已变化")
	}
	batch := *previous
	batch.Items = make([]cloudAgentMediaBatchItem, 0, len(previous.Items))
	prepared := make([]cloudAgentMediaBatchPrepared, 0, len(previous.Items))
	resourceIDs := []string{}
	seen := map[string]bool{}
	var total int64
	videoSeconds := 0
	for index, item := range previous.Items {
		if item.NodeID != args.Items[index].NodeID || item.Status != cloudAgentMediaBatchItemPending || item.Attempts != 0 {
			return creationConflict("批量生成审批条目已变化")
		}
		var itemArgs cloudAgentMediaArgs
		if err := decodeCloudAgentJSONObject(item.Arguments, &itemArgs); err != nil {
			return err
		}
		if itemArgs.Mode != args.Mode || itemArgs.NodeID != item.NodeID {
			return creationConflict("批量生成审批条目不一致")
		}
		if err := applyCloudAgentMediaApprovalSettings(&itemArgs, settings); err != nil {
			return err
		}
		itemCall, err := cloudAgentMediaBatchItemCall(call.ID, index, itemArgs)
		if err != nil {
			return err
		}
		// Keep the approval in the state: user-selected settings must not be
		// replaced by the Agent's configuration inheritance rules.
		req, plan, err := s.prepareCloudAgentMedia(run, state, itemCall)
		if err != nil {
			return err
		}
		task, preparation, err := s.prepareCloudAgentEditedMedia(run, state, &req, plan)
		if err != nil {
			return err
		}
		item.ResolvedHash, err = cloudAgentResolvedMediaHash(task)
		if err != nil {
			return err
		}
		item.SpecHash, err = cloudAgentResolvedMediaSpecHash(task)
		if err != nil {
			return err
		}
		name, err := s.cloudAgentMediaModelName(plan.Args)
		if err != nil {
			return err
		}
		stored := plan.Args
		stored.Prompt, stored.SnapshotHash, stored.ConfigurationChange = itemArgs.Prompt, "", nil
		raw, err := json.Marshal(stored)
		if err != nil {
			return err
		}
		item.Arguments, item.Duration, item.Amount = string(raw), stored.Duration, 0
		if preparation.Order != nil {
			item.Amount = preparation.Order.AmountMicrocredits
		}
		item.ResourceIDs = cloudAgentMediaBatchResourceIDs(req.Input)
		for _, id := range item.ResourceIDs {
			if !seen[id] {
				seen[id] = true
				resourceIDs = append(resourceIDs, id)
			}
		}
		total += item.Amount
		videoSeconds += item.Duration
		batch.Items = append(batch.Items, item)
		prepared = append(prepared, cloudAgentMediaBatchPrepared{plan: plan, item: item, model: name})
		if index == 0 {
			batch.ModelName = name
			args.LogicalModelID, args.ChannelID, args.ChannelModelKey = stored.LogicalModelID, stored.ChannelID, stored.ChannelModelKey
			args.Size, args.Quality, args.ImageResolution, args.ImageParameters = stored.Size, stored.Quality, stored.ImageResolution, stored.ImageParameters
			args.VideoGenerateAudio, args.VideoWatermark, args.VideoArkPrivateAssetUpload = stored.VideoGenerateAudio, stored.VideoWatermark, stored.VideoArkPrivateAssetUpload
		}
		// An explicit duration applies to the whole batch, including items
		// that previously had individual overrides. Omission preserves them.
		if settings.DurationSeconds != nil {
			args.Items[index].Duration = stored.Duration
			args.Duration = stored.Duration
		}
	}
	budget := state.Request.Budget
	if budget.MaxGenerationTasks > 0 && state.Generations+len(batch.Items) > budget.MaxGenerationTasks {
		return BadAuthRequest("批量生成超过本轮生成次数预算")
	}
	if args.Mode == "video" && budget.MaxVideoSeconds > 0 && state.VideoSeconds+videoSeconds > budget.MaxVideoSeconds {
		return BadAuthRequest("批量生成超过本轮视频时长预算")
	}
	orders, err := repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if total > remaining {
		return BadAuthRequest("批量生成超过本轮积分预算")
	}
	batch.CapMicrocredits = total * int64(1+batch.MaxRetries)
	if raw, err := json.Marshal(batch); err != nil {
		return err
	} else if len(raw) > cloudAgentMediaBatchStateLimit {
		return BadAuthRequest("批量生成审批内容过长，请拆分批次")
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	if err := repo.ReplaceCloudAgentResourceLeases(run.UserID, run.ID, state.Approval.ID, resourceIDs, time.Now().UTC().Add(cloudAgentMediaBatchLeaseLifetime)); err != nil {
		return err
	}
	state.MediaBatch = &batch
	state.Calls[state.CallIndex] = call
	state.Approval.Call = call
	state.Approval.CallHash = cloudAgentApprovalCallHash(call)
	state.Approval.ModelName = batch.ModelName
	state.Approval.Preview = cloudAgentMediaBatchApprovalPreview(&batch, prepared)
	return nil
}

func replaceCloudAgentPreparedLeases(repo *repository.Repository, userID, runID, approvalID string, prepared *cloudAgentPreparedMedia) error {
	ids := make([]string, 0, len(prepared.ResourceSignatures))
	for id := range prepared.ResourceSignatures {
		ids = append(ids, id)
	}
	return repo.ReplaceCloudAgentResourceLeases(userID, runID, approvalID, ids, prepared.Quote.ExpiresAt)
}

// cloudAgentImageTierSelectorConsumed 识别画布尺寸选择器的档位约定：未声明质量参数的
// 比例/预设模型用 quality=1K/1.5K/2K/4K 选择像素预设，任务准入换算尺寸后会清空 quality。
// 只用于用户编辑审批：选择器只展示模型已配置的档位，换算结果随报价一起固定。
func cloudAgentImageTierSelectorConsumed(requested, resolvedInput map[string]any) bool {
	if stringValue(resolvedInput["mode"]) != "image" || declaredImageResolutionTier(stringValue(requested["quality"])) == "" {
		return false
	}
	options, _ := resolvedInput["capabilityOptions"].(map[string]any)
	config, _ := resolvedInput["config"].(map[string]any)
	if _, declared := options["quality"]; declared {
		return false
	}
	return strings.TrimSpace(stringValue(config["quality"])) == ""
}

func validateCloudAgentResolvedMediaOptions(requested, resolvedInput map[string]any) error {
	resolvedOptions, _ := resolvedInput["capabilityOptions"].(map[string]any)
	resolvedConfig, _ := resolvedInput["config"].(map[string]any)
	if raw := requested["imageParameters"]; raw != nil {
		var values map[string]any
		if encoded, ok := raw.(string); ok {
			if err := json.Unmarshal([]byte(encoded), &values); err != nil {
				return creationConflict("图片参数格式无效")
			}
		} else {
			values, _ = raw.(map[string]any)
		}
		for name, value := range values {
			if resolvedOptions[name] != value {
				return creationConflict("模型解析后的图片参数与审批内容不同")
			}
		}
	}
	for _, key := range []string{"size", "imageResolution", "videoSeconds", "vquality", "quality", "count", "videoGenerateAudio", "videoWatermark", "videoArkPrivateAssetUpload"} {
		requestedValue := stringValue(requested[key])
		if stringValue(resolvedInput["mode"]) == "image" && (key == "quality" || key == "imageResolution") && inactiveCapabilityOptionValue(key, requestedValue) {
			continue
		}
		// 图片目录保留比例，任务配置保存按预设换算的像素；审批可以提交任一种表达。
		if key == "size" && stringValue(resolvedInput["mode"]) == "image" && requestedValue != "" && strings.EqualFold(requestedValue, stringValue(resolvedConfig[key])) {
			continue
		}
		// 比例按预设换成像素（16:9 → 1824x1024）是同一个画幅，不是改了规格；审批卡展示的就是
		// 解析后的像素值。反方向（像素换回比例）会丢掉像素档位，仍按不一致处理。
		if key == "size" && (cloudAgentMediaSizeSameFrame(requestedValue, stringValue(resolvedOptions[key])) || cloudAgentMediaSizeSameFrame(requestedValue, stringValue(resolvedConfig[key]))) {
			continue
		}
		if key == "quality" && requestedValue != "" {
			if _, declared := resolvedOptions[key]; !declared {
				if strings.EqualFold(requestedValue, stringValue(resolvedOptions["imageResolution"])) {
					// 任务准入已把旧 quality 档位解析为图片分辨率，不能再次与空 quality 比较。
					continue
				}
				return cloudAgentMediaSpecMismatch(key, requestedValue, "", "所选图片模型未声明质量参数，请使用模型声明的图片分辨率或质量选项")
			}
		}
		resolved := stringValue(resolvedOptions[key])
		if resolved == "" {
			resolved = stringValue(resolvedConfig[key])
		}
		if requestedValue != "" && !strings.EqualFold(requestedValue, resolved) {
			return cloudAgentMediaSpecMismatch(key, requestedValue, resolved, "")
		}
	}
	return nil
}

// cloudAgentMediaSizeFrameTolerance 是比例与像素写法视为同一画幅的宽高比相对误差。
// 预设像素按 16/32 取整（16:9 → 1824x1024 约差 0.2%）；常见比例之间至少差 6%。
const cloudAgentMediaSizeFrameTolerance = 0.02

// cloudAgentMediaSizeSameFrame 判断申请的比例是否被换算成了同一画幅的像素尺寸。
// 只认"比例 → 像素"：两边都是比例或都是像素时不放行，那是真的换了规格。
func cloudAgentMediaSizeSameFrame(requested, resolved string) bool {
	requested, resolved = strings.TrimSpace(requested), strings.TrimSpace(resolved)
	if requested == "" || resolved == "" || !strings.Contains(requested, ":") || strings.Contains(resolved, ":") {
		return false
	}
	left, leftOK := cloudAgentMediaFrameRatio(requested)
	right, rightOK := cloudAgentMediaFrameRatio(resolved)
	return leftOK && rightOK && math.Abs(left-right)/right <= cloudAgentMediaSizeFrameTolerance
}

// cloudAgentMediaFrameRatio 解析 "16:9" 或 "1824x1024" 的宽高比；auto 等非尺寸值返回 false。
func cloudAgentMediaFrameRatio(value string) (float64, bool) {
	value = strings.ToLower(strings.ReplaceAll(value, "×", "x"))
	separator := "x"
	if strings.Contains(value, ":") {
		separator = ":"
	}
	left, right, found := strings.Cut(value, separator)
	if !found {
		return 0, false
	}
	width, widthErr := strconv.ParseFloat(strings.TrimSpace(left), 64)
	height, heightErr := strconv.ParseFloat(strings.TrimSpace(right), 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, false
	}
	return width / height, true
}

// cloudAgentMediaSpecArgument 把任务配置键映射回 generate_media 参数名，便于模型和用户定位。
var cloudAgentMediaSpecArgument = map[string]string{"videoSeconds": "durationSeconds", "vquality": "quality"}

var cloudAgentMediaSpecLabel = map[string]string{
	"size": "画幅/尺寸", "imageResolution": "图片分辨率", "quality": "质量", "vquality": "视频清晰度", "videoSeconds": "视频时长",
	"count": "生成数量", "videoGenerateAudio": "同步生成音频", "videoWatermark": "水印", "videoArkPrivateAssetUpload": "参考图同步",
}

// cloudAgentMediaSpecMismatch 说明具体哪一项被模型目录改写：此时还没有提交收费任务，
// 返回参数错误让 Agent 按目录修正后重新申请审批，而不是整轮失败；用户编辑审批时同样能看到原因。
// 仍然拒绝静默替换：用户批准的规格必须与最终提交的一致。
func cloudAgentMediaSpecMismatch(key, requested, resolved, message string) error {
	field := key
	if mapped, ok := cloudAgentMediaSpecArgument[key]; ok {
		field = mapped
	}
	if message == "" {
		label := cloudAgentMediaSpecLabel[key]
		if label == "" {
			label = key
		}
		if resolved == "" {
			message = fmt.Sprintf("所选模型不支持%s「%s」，请去掉该参数或改用 model_list 中该模型声明的取值", label, truncateRunes(requested, 40))
		} else {
			message = fmt.Sprintf("所选模型会把%s「%s」解析为「%s」，与申请的规格不一致；请改用「%s」或 model_list 中该模型声明的其他取值", label, truncateRunes(requested, 40), truncateRunes(resolved, 40), truncateRunes(resolved, 40))
		}
	}
	return cloudAgentFieldError(field, "invalid_value", message)
}
