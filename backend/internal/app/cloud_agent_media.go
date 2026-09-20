package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// The Agent uses the same public catalog as the composer, never a second routing policy.
func (s *Service) cloudAgentModelList(intent *ModelRequestIntent) (any, error) {
	catalog, err := s.ModelCatalog(intent)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, m := range catalog.Models {
		if m.Available && cloudAgentGenerationModeSupported(normalizeCapability(m.Capability)) {
			items = append(items, map[string]any{"name": m.Name, "capability": m.Capability, "selection": map[string]any{"logicalModelId": m.ID}, "priceLabel": m.PriceLabel, "priceTiers": m.PriceTiers, "options": m.CapabilitySpec, "profiles": m.CapabilityProfiles, "defaults": m.DefaultOptions})
		}
	}
	for _, channel := range catalog.Channels {
		for _, m := range channel.Models {
			if m.Available && cloudAgentGenerationModeSupported(normalizeCapability(m.Capability)) {
				items = append(items, map[string]any{"name": m.DisplayName, "capability": m.Capability, "selection": map[string]any{"channelId": channel.ID, "channelModelKey": m.ModelKey}, "priceLabel": m.PriceLabel, "priceTiers": m.PriceTiers, "options": m.CapabilityConfig})
			}
		}
	}
	return map[string]any{"source": catalog.Source, "models": items, "intent": intent}, nil
}

// Resolve actual canvas resources before filtering the shared catalog. Counts
// supplied by the model must not replace resource ownership/readiness checks.
func (s *Service) cloudAgentModelIntent(userID, canvasID, arguments string) (*ModelRequestIntent, error) {
	var a struct {
		Mode             string   `json:"mode"`
		ReferenceNodeIDs []string `json:"referenceNodeIds"`
	}
	if err := decodeCloudAgentJSONObject(arguments, &a); err != nil {
		return nil, BadAuthRequest("模型查询参数无效")
	}
	if a.Mode == "" && len(a.ReferenceNodeIDs) == 0 {
		return nil, nil
	}
	if !cloudAgentGenerationModeSupported(a.Mode) || len(a.ReferenceNodeIDs) > 16 {
		return nil, BadAuthRequest("请指定支持的生成模式，参考节点最多16个")
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	refs := map[string]any{}
	seen := map[string]bool{}
	for _, id := range a.ReferenceNodeIDs {
		if id == "" || seen[id] || nodes[id] == nil {
			return nil, BadAuthRequest("参考节点不存在或重复")
		}
		seen[id] = true
		ref, field, err := cloudAgentReference(s.repo, userID, nodes[id])
		if err != nil {
			return nil, err
		}
		list, _ := refs[field].([]any)
		refs[field] = append(list, ref)
	}
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return nil, err
	}
	refs["mode"] = a.Mode
	intent := ModelRequestIntentFromTaskInput(refs, "canvas_"+a.Mode, cloudAgentMediaOperation(a.Mode, refs))
	return &intent, nil
}

type cloudAgentMediaArgs struct {
	Prepared              *cloudAgentPreparedMedia `json:"-"`
	DraftRunID            string                   `json:"-"`
	Mode                  string                   `json:"mode"`
	Prompt                string                   `json:"prompt"`
	LogicalModelID        string                   `json:"logicalModelId"`
	ChannelID             string                   `json:"channelId"`
	ChannelModelKey       string                   `json:"channelModelKey"`
	Duration              int                      `json:"durationSeconds"`
	Size                  string                   `json:"size"`
	Quality               string                   `json:"quality"`
	VideoGenerateAudio    *bool                    `json:"videoGenerateAudio"`
	SnapshotHash          string                   `json:"snapshotHash"`
	NodeID                string                   `json:"nodeId"`
	Title                 string                   `json:"title"`
	SourceNodeID          string                   `json:"sourceNodeId"`
	ReferenceNodeIDs      []string                 `json:"referenceNodeIds"`
	ReferenceTransientIDs []string                 `json:"referenceTransientIds"`
}

type cloudAgentMediaPlan struct {
	Args                cloudAgentMediaArgs
	CallID              string
	TransientReferences map[string]cloudAgentTransientReference
}

// A resumed draft's incoming edges must describe the new approved inputs,
// rather than retaining references removed from the generation request.
func cloudAgentMediaConnections(edges []map[string]any, a cloudAgentMediaArgs) []map[string]any {
	incoming := map[string]map[string]any{}
	result := make([]map[string]any, 0, len(edges))
	for _, edge := range edges {
		if stringValue(edge["toNodeId"]) != a.NodeID {
			result = append(result, edge)
		} else {
			incoming[stringValue(edge["fromNodeId"])] = edge
		}
	}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if edge := incoming[id]; edge != nil {
			result = append(result, edge)
			delete(incoming, id)
		}
	}
	return result
}

type cloudAgentReferenceAdapter struct {
	PayloadField string
	MIMEMajor    string
}

// Provider payload fields are an adapter concern, not a canvas node-type
// allow-list. A new reference kind must register both a canvas capability and
// an upstream media adapter before it can cross this boundary.
var cloudAgentReferenceAdapters = map[string]cloudAgentReferenceAdapter{
	"image": {PayloadField: "referenceImages", MIMEMajor: "image"},
	"video": {PayloadField: "referenceVideos", MIMEMajor: "video"},
	"audio": {PayloadField: "referenceAudios", MIMEMajor: "audio"},
}

// This is the provider/task boundary, not a node allow-list. A canvas
// descriptor alone cannot activate a billing or provider operation: that
// operation must have an implemented adapter before it is exposed to Agent.
var cloudAgentGenerationAdapters = map[string]struct{}{
	"image": {}, "video": {}, "audio": {},
}

func (s *Service) cloudAgentMediaModelName(a cloudAgentMediaArgs) (string, error) {
	if !cloudAgentGenerationModeSupported(a.Mode) {
		return "", BadAuthRequest("生成模式当前不受 Agent 支持")
	}
	catalog, err := s.ModelCatalog(nil)
	if err != nil {
		return "", err
	}
	for _, m := range catalog.Models {
		if a.LogicalModelID != "" && m.ID == a.LogicalModelID && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
			return m.Name, nil
		}
	}
	for _, channel := range catalog.Channels {
		if channel.ID != a.ChannelID {
			continue
		}
		for _, m := range channel.Models {
			if m.ModelKey == a.ChannelModelKey && m.Available && normalizeCapability(m.Capability) == normalizeCapability(a.Mode) {
				return m.DisplayName, nil
			}
		}
	}
	return "", BadAuthRequest("模型目录已变化，请重新读取目录并询问用户选择模型")
}

func cloudAgentReferenceDescriptor(node map[string]any) (cloudAgentNodeCapability, cloudAgentReferenceAdapter, error) {
	descriptor, known := cloudAgentNodeCapabilityForType(stringValue(node["type"]))
	if !known || !descriptor.Connection.CanReference || descriptor.InputKind == "" {
		return cloudAgentNodeCapability{}, cloudAgentReferenceAdapter{}, BadAuthRequest("该节点不能作为媒体参考资产")
	}
	adapter, supported := cloudAgentReferenceAdapters[descriptor.InputKind]
	if !supported {
		return cloudAgentNodeCapability{}, cloudAgentReferenceAdapter{}, BadAuthRequest("该节点的参考输入类型尚未接入媒体生成")
	}
	return descriptor, adapter, nil
}

func cloudAgentReference(repo *repository.Repository, userID string, node map[string]any) (map[string]any, string, error) {
	descriptor, adapter, err := cloudAgentReferenceDescriptor(node)
	if err != nil {
		return nil, "", err
	}
	meta, _ := node["metadata"].(map[string]any)
	key := stringValue(meta["storageKey"])
	if !strings.HasPrefix(key, "resource:") {
		return nil, "", BadAuthRequest("参考资产尚未保存到账号资源库，请先上传；不能用外部地址代替")
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil {
		return nil, "", BadAuthRequest("参考资产不存在或不属于当前用户")
	}
	if resource.Status != "ready" || !strings.HasPrefix(strings.ToLower(resource.MimeType), adapter.MIMEMajor+"/") {
		return nil, "", BadAuthRequest("参考资产尚未就绪或媒体类型不匹配")
	}
	return map[string]any{"id": node["id"], "name": node["title"], "storageKey": key, "type": resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs, "inputKind": descriptor.InputKind}, adapter.PayloadField, nil
}

// Shared by the read projection and generation admission. Ownership of an
// otherwise eligible draft remains a separate, transactional admission check.
func cloudAgentMediaTargetIssue(node map[string]any, nodeType string) (string, string) {
	meta, _ := node["metadata"].(map[string]any)
	switch {
	case meta["locked"] == true:
		return "target_locked", "目标节点已锁定，不能提交生成"
	case stringValue(meta["taskId"]) != "" || stringValue(meta["generationTaskId"]) != "":
		return "task_bound", "目标节点已关联任务，不能覆盖；可读取 generation 或 task_get 查询原任务状态和错误"
	case stringValue(node["type"]) != nodeType:
		return "target_type_mismatch", "目标节点类型与生成模式不匹配"
	case stringValue(meta["storageKey"]) != "" || stringValue(meta["content"]) != "":
		return "output_exists", "目标节点已有媒体产物，不能作为未提交草稿覆盖"
	case stringValue(meta["status"]) != "idle":
		return "target_not_idle", "目标节点不是空闲的未提交草稿，请读取节点及任务状态"
	}
	return "", ""
}

type cloudAgentMediaAdmissionError struct {
	error
	Reason string
	NodeID string
}

func (e *cloudAgentMediaAdmissionError) Unwrap() error { return e.error }

func cloudAgentMediaDocument(repo *repository.Repository, userID, canvasID string, args cloudAgentMediaArgs, transient ...map[string]cloudAgentTransientReference) (*model.CanvasProject, map[string]any, map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, nil, err
	}
	unchanged := args.SnapshotHash != "" && (cloudAgentCanvasHash(doc) == args.SnapshotHash || cloudAgentMediaContentHash(doc) == args.SnapshotHash)
	if args.Prepared != nil {
		dependency, err := cloudAgentMediaDependencyHash(doc, args)
		if err != nil {
			return nil, nil, nil, err
		}
		unchanged = dependency == args.Prepared.DependencyHash
	}
	if !unchanged {
		return nil, nil, nil, &cloudAgentMediaAdmissionError{creationConflict("画布内容已变化，请重新读取画布并重新审批；未提交生成任务"), "snapshot_conflict", args.NodeID}
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, nil, err
	}
	existing := nodes[args.NodeID]
	existingMeta, _ := existing["metadata"].(map[string]any)
	targetDescriptor, supported := cloudAgentNodeCapabilityForGenerationMode(args.Mode)
	if !supported {
		return nil, nil, nil, BadAuthRequest("生成模式当前不受 Agent 支持")
	}
	if err := validateCloudAgentID(args.NodeID, "生成节点 ID", 80); err != nil {
		return nil, nil, nil, err
	}
	if existing != nil {
		if reason, issue := cloudAgentMediaTargetIssue(existing, targetDescriptor.Type); reason != "" {
			return nil, nil, nil, &cloudAgentMediaAdmissionError{BadAuthRequest(issue), reason, args.NodeID}
		}
		if args.DraftRunID == "" {
			return nil, nil, nil, BadAuthRequest("续用草稿缺少当前运行身份")
		}
		ownerID := stringValue(existingMeta["agentDraftRunId"])
		if ownerID != "" && ownerID != args.DraftRunID {
			owner, err := repo.CloudAgent(userID, ownerID)
			if err != nil {
				return nil, nil, nil, BadAuthRequest("无法确认草稿所属运行，请停止重试并检查原草稿")
			}
			if owner.CanvasID != canvasID || !cloudAgentRunTerminal(owner.Status) || owner.CleanupPending {
				return nil, nil, nil, BadAuthRequest("草稿仍由另一运行处理，请先完成或取消原运行；不要另建节点绕过审批")
			}
		}
	}
	if args.SourceNodeID != "" && nodes[args.SourceNodeID] == nil {
		return nil, nil, nil, BadAuthRequest("来源镜头节点不在当前画布")
	}
	if source := nodes[args.SourceNodeID]; source != nil {
		descriptor, known := cloudAgentNodeCapabilityForType(stringValue(source["type"]))
		if !known || !descriptor.Connection.CanSource || descriptor.InputKind != "text" {
			return nil, nil, nil, BadAuthRequest("sourceNodeId 仅接受可作为文本输入的节点；媒体资产请放入 referenceNodeIds，并将 sourceNodeId 留空，不要重复传入")
		}
	}
	// Keep the media entry point subject to the same graph admission policy as
	// canvas_apply_ops. The old implementation only checked that references
	// existed, which allowed invalid edges (for example frame -> image) to be
	// smuggled in through generate_media.
	prospectiveConnections := cloudAgentMediaConnections(creationMaps(doc["connections"]), args)
	target := existing
	if target == nil {
		target = map[string]any{"id": args.NodeID, "type": targetDescriptor.Type}
	}
	prospectiveNodes := make([]map[string]any, 0, len(nodes)+1)
	for _, node := range nodes {
		prospectiveNodes = append(prospectiveNodes, node)
	}
	if existing == nil {
		prospectiveNodes = append(prospectiveNodes, target)
	}
	prospectiveSources := append(append([]string{}, args.ReferenceNodeIDs...), args.SourceNodeID)
	prospectiveSeen := map[string]bool{}
	for _, sourceID := range prospectiveSources {
		if sourceID == "" || prospectiveSeen[sourceID] {
			continue
		}
		prospectiveSeen[sourceID] = true
		alreadyConnected := false
		for _, edge := range prospectiveConnections {
			if stringValue(edge["fromNodeId"]) == sourceID && stringValue(edge["toNodeId"]) == args.NodeID {
				alreadyConnected = true
				break
			}
		}
		if alreadyConnected {
			continue
		}
		if err := validateCloudAgentConnection(prospectiveNodes, sourceID, args.NodeID, prospectiveConnections); err != nil {
			return nil, nil, nil, err
		}
		prospectiveConnections = append(prospectiveConnections, map[string]any{"fromNodeId": sourceID, "toNodeId": args.NodeID})
	}
	if args.Prepared != nil {
		refs, err := cloudAgentPreparedReferences(repo, userID, args.Prepared)
		return canvas, doc, refs, err
	}
	refs := map[string]any{}
	seen := map[string]bool{}
	for _, id := range args.ReferenceNodeIDs {
		if id == "" || seen[id] || nodes[id] == nil {
			return nil, nil, nil, BadAuthRequest("参考节点不存在或重复")
		}
		seen[id] = true
		ref, payloadField, e := cloudAgentReference(repo, userID, nodes[id])
		if e != nil {
			return nil, nil, nil, e
		}
		list, _ := refs[payloadField].([]any)
		refs[payloadField] = append(list, ref)
	}
	if len(args.ReferenceTransientIDs) > 0 && len(transient) > 0 {
		available := map[string]cloudAgentTransientReference{}
		if len(transient) > 0 && transient[0] != nil {
			available = transient[0]
		}
		for _, id := range args.ReferenceTransientIDs {
			ref, ok := available[id]
			if !ok || !strings.HasPrefix(ref.MIMEType, "image/") || ref.ResourceID == "" || time.Now().After(ref.ExpiresAt) {
				return nil, nil, nil, BadAuthRequest("临时参考图不存在、类型不匹配或已过期，请重新渲染标注")
			}
			resolved, _, err := cloudAgentReference(repo, userID, map[string]any{"id": ref.ID, "type": "image", "title": ref.Name, "metadata": map[string]any{"storageKey": "resource:" + ref.ResourceID}})
			if err != nil {
				return nil, nil, nil, err
			}
			list, _ := refs["referenceImages"].([]any)
			refs["referenceImages"] = append(list, resolved)
		}
	}
	return canvas, doc, refs, nil
}

func validateCloudAgentMediaArgs(a cloudAgentMediaArgs, state *cloudAgentRuntime) error {
	mode := strings.ToLower(strings.TrimSpace(a.Mode))
	if !cloudAgentGenerationModeSupported(mode) {
		return BadAuthRequest("生成模式当前不受 Agent 支持")
	}
	a.Mode = mode
	if a.SnapshotHash == "" {
		return BadAuthRequest("缺少画布快照，请先读取当前画布")
	}
	if len(a.SnapshotHash) != 64 {
		return BadAuthRequest("画布快照无效，请重新读取当前画布")
	}
	for _, r := range a.SnapshotHash {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')) {
			return BadAuthRequest("画布快照无效，请重新读取当前画布")
		}
	}
	if err := validateCloudAgentID(a.NodeID, "生成节点 ID", 80); err != nil {
		return err
	}
	if a.SourceNodeID != "" {
		if err := validateCloudAgentID(a.SourceNodeID, "来源节点 ID", 80); err != nil {
			return err
		}
	}
	for _, id := range a.ReferenceNodeIDs {
		if err := validateCloudAgentID(id, "参考节点 ID", 80); err != nil {
			return err
		}
	}
	if len(a.ReferenceTransientIDs) > 4 {
		return BadAuthRequest("临时参考图最多 4 个")
	}
	for _, id := range a.ReferenceTransientIDs {
		if err := validateCloudAgentID(id, "临时参考图 ID", 120); err != nil {
			return err
		}
	}
	if strings.TrimSpace(a.Prompt) == "" {
		return BadAuthRequest("生成提示词不能为空")
	}
	if strings.TrimSpace(a.Title) == "" || utf8.RuneCountInString(a.Title) > 240 {
		return BadAuthRequest("生成节点标题不能为空且不能超过 240 个字符")
	}
	if utf8.RuneCountInString(a.Prompt) > 16000 {
		return BadAuthRequest(fmt.Sprintf("提示词共%d字符，超过16000字符上限；请先告知用户，不要擅自删改关键内容", utf8.RuneCountInString(a.Prompt)))
	}
	if (mode == "image" || mode == "video") && strings.TrimSpace(a.Size) == "" {
		return BadAuthRequest("请填写模型支持的具体画幅；用户授权默认时沿用参考图比例或目录默认画幅，无需重复询问")
	}
	if a.Duration < 0 {
		return BadAuthRequest("生成时长不能为负数")
	}
	switch mode {
	case "video":
		if a.Duration == 0 {
			return BadAuthRequest("视频生成必须明确 durationSeconds")
		}
	case "image", "audio":
		if a.Duration != 0 {
			return BadAuthRequest("只有视频生成允许设置 durationSeconds")
		}
		if a.VideoGenerateAudio != nil {
			return BadAuthRequest("videoGenerateAudio 仅适用于视频生成")
		}
	}
	if len(a.ReferenceNodeIDs) > 16 {
		return BadAuthRequest("参考节点最多 16 个")
	}
	if a.SourceNodeID != "" {
		for _, id := range a.ReferenceNodeIDs {
			if id == a.SourceNodeID {
				return BadAuthRequest("sourceNodeId 与 referenceNodeIds 不能重复；参考图片、视频、音频请仅保留在 referenceNodeIds 并清空 sourceNodeId，文本镜头节点则仅放 sourceNodeId")
			}
		}
	}
	if state == nil {
		return BadAuthRequest("Agent 状态无效")
	}
	if state.Request.Budget.MaxGenerationTasks > 0 && state.Generations >= state.Request.Budget.MaxGenerationTasks {
		return BadAuthRequest("已达到本轮媒体生成次数上限")
	}
	if mode == "video" && state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds-a.Duration {
		return BadAuthRequest("已超过本轮视频时长预算")
	}
	return nil
}

func validateCloudAgentMediaReferences(mode string, refs map[string]any) error {
	imageCount := lenAnySlice(refs["referenceImages"])
	videoCount := lenAnySlice(refs["referenceVideos"])
	audioCount := lenAnySlice(refs["referenceAudios"])
	switch mode {
	case "image":
		if videoCount > 0 || audioCount > 0 {
			return BadAuthRequest("图片生成仅支持图片参考资产")
		}
	case "audio":
		if imageCount > 0 || videoCount > 0 || audioCount > 0 {
			return BadAuthRequest("当前音频生成只支持文本输入，暂不支持媒体参考资产")
		}
	case "video":
		// Video reference admission is completed against the selected model's
		// capability contract by CreateTask. Do not guess a provider operation here.
	default:
		return BadAuthRequest("生成模式尚未实现媒体任务适配器")
	}
	return nil
}

func lenAnySlice(value any) int {
	switch items := value.(type) {
	case []any:
		return len(items)
	case []map[string]any:
		return len(items)
	default:
		return 0
	}
}

func cloudAgentMediaOperation(mode string, refs map[string]any) string {
	switch mode {
	case "video":
		if lenAnySlice(refs["referenceVideos"]) > 0 {
			return "reference_to_video"
		}
		if lenAnySlice(refs["referenceAudios"]) > 0 {
			return "audio_to_video"
		}
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_video"
		}
	case "image":
		if lenAnySlice(refs["referenceImages"]) > 0 {
			return "image_to_image"
		}
	}
	if mode == "image" || mode == "video" || mode == "audio" {
		return "text_to_" + mode
	}
	return ""
}

func (s *Service) fillCloudAgentMediaSnapshotHash(userID, canvasID string, a *cloudAgentMediaArgs) error {
	if a == nil || strings.TrimSpace(a.SnapshotHash) != "" {
		return nil
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	a.SnapshotHash = cloudAgentMediaContentHash(doc)
	return nil
}

func (s *Service) prepareCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) (CreateTaskRequest, *cloudAgentMediaPlan, error) {
	var a cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &a); err != nil {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成参数必须是只含支持字段的单个JSON对象")
	}
	a.Mode = strings.ToLower(strings.TrimSpace(a.Mode))
	a.DraftRunID = run.ID
	if state.Approval != nil && state.Approval.Call.ID == call.ID {
		a.Prepared = state.Approval.Prepared
	}
	if err := s.fillCloudAgentMediaSnapshotHash(run.UserID, state.Request.CanvasID, &a); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if err := validateCloudAgentMediaArgs(a, state); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if (a.LogicalModelID == "" && (a.ChannelID == "" || a.ChannelModelKey == "")) || (a.LogicalModelID != "" && (a.ChannelID != "" || a.ChannelModelKey != "")) {
		return CreateTaskRequest{}, nil, BadAuthRequest("请复制 model_list 的 selection：逻辑模型或系统渠道二选一，不得混用")
	}
	_, _, refs, err := cloudAgentMediaDocument(s.repo, run.UserID, state.Request.CanvasID, a, state.TransientReferences)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	if a.Prepared != nil {
		a.Prompt = stringValue(a.Prepared.Input["prompt"])
	} else {
		a.Prompt, err = cloudAgentMediaReferencePrompt(a.Prompt, refs)
		if err != nil {
			return CreateTaskRequest{}, nil, err
		}
	}
	spec, err := cloudAgentGenerationSpec(a, refs, nil)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	config := spec.Options.TaskConfig()
	if a.ChannelID != "" {
		config["channelId"], config["channelModelKey"], config["model"] = a.ChannelID, a.ChannelModelKey, a.ChannelModelKey
	}
	input := refs
	input["mode"], input["prompt"], input["config"] = a.Mode, a.Prompt, config
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	operation := cloudAgentMediaOperation(a.Mode, refs)
	if operation == "" {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成模式尚未实现媒体任务适配器")
	}
	metadata := map[string]any{"nodeId": a.NodeID, "source": "cloud_agent"}
	if a.Mode == "video" {
		metadata["videoEditOperation"] = operation
	}
	input["metadata"] = metadata
	transientSnapshot := map[string]cloudAgentTransientReference{}
	for id, ref := range state.TransientReferences {
		transientSnapshot[id] = ref
	}
	return CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_" + a.Mode, Operation: operation, Prompt: a.Prompt, LogicalModelID: a.LogicalModelID, Model: a.ChannelModelKey, Input: input}, &cloudAgentMediaPlan{Args: a, CallID: call.ID, TransientReferences: transientSnapshot}, nil
}

func saveCloudAgentDocument(repo *repository.Repository, canvas *model.CanvasProject, doc map[string]any, policy RuntimePolicySetting) error {
	doc["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	if len(raw) > 8<<20 {
		return BadAuthRequest("画布大小超限")
	}
	usage, err := repo.UserStorageUsage(canvas.UserID)
	if err != nil {
		return err
	}
	if err = validateStructuredStorageQuotaWithPolicy(usage, "canvas", false, int64(len(raw)-len(canvas.PayloadJSON)), policy.Resource); err != nil {
		return err
	}
	before := canvas.PayloadJSON
	canvas.PayloadJSON = string(raw)
	return saveCreationCanvasWithHistory(repo, canvas, before)
}

// Called inside the same transaction as the task, charge reservation and Agent checkpoint.
func createCloudAgentMediaNode(repo *repository.Repository, userID, canvasID string, plan *cloudAgentMediaPlan, task *model.Task, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) error {
	a := plan.Args
	canvas, doc, refs, err := cloudAgentMediaDocument(repo, userID, canvasID, a, plan.TransientReferences)
	if err != nil {
		return err
	}
	beforeJSON := canvas.PayloadJSON
	beforeHash := cloudAgentCanvasHash(doc)
	nodes := creationMaps(doc["nodes"])
	x, y := 80.0, 80.0
	for _, node := range nodes {
		position, _ := node["position"].(map[string]any)
		nx, _ := position["x"].(float64)
		width, _ := node["width"].(float64)
		if nx+width+80 > x {
			x = nx + width + 80
		}
		if stringValue(node["id"]) == a.SourceNodeID {
			y, _ = position["y"].(float64)
		}
	}
	var input struct {
		Config map[string]any `json:"config"`
	}
	if task != nil {
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			return err
		}
	}
	spec, err := cloudAgentGenerationSpec(a, refs, input.Config)
	if err != nil {
		return err
	}
	meta, err := spec.NodeMetadata()
	if err != nil {
		return err
	}
	meta["status"], meta["agentDraftRunId"], meta["referenceNodeIds"] = "idle", a.DraftRunID, a.ReferenceNodeIDs
	if task != nil {
		meta["status"], meta["taskId"], meta["taskStatus"] = "loading", task.ID, "queued"
		delete(meta, "agentDraftRunId")
	}
	descriptor, supported := cloudAgentNodeCapabilityForGenerationMode(a.Mode)
	if !supported || !cloudAgentGenerationModeSupported(a.Mode) {
		return BadAuthRequest("生成模式当前不受 Agent 支持")
	}
	node := creationAddedNode(CreationCanvasOp{Type: "add_node", ID: a.NodeID, NodeType: descriptor.Type, Title: a.Title, X: &x, Y: &y, Metadata: meta})
	if a.Size == "9:16" {
		node["width"], node["height"] = float64(360), float64(640)
	}
	replaced := false
	for _, existing := range nodes {
		if stringValue(existing["id"]) == a.NodeID {
			existing["metadata"] = meta
			if task == nil {
				existing["title"] = a.Title
			}
			replaced = true
			break
		}
	}
	if !replaced {
		nodes = append(nodes, node)
	}
	doc["nodes"] = nodes
	edges := cloudAgentMediaConnections(creationMaps(doc["connections"]), a)
	seen := map[string]bool{}
	for _, edge := range edges {
		if stringValue(edge["toNodeId"]) == a.NodeID {
			seen[stringValue(edge["fromNodeId"])] = true
		}
	}
	for _, id := range append(append([]string{}, a.ReferenceNodeIDs...), a.SourceNodeID) {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		edges = append(edges, map[string]any{"id": "agent-" + newID(), "fromNodeId": id, "toNodeId": a.NodeID})
	}
	// Reused drafts may already contain only a subset of the new references.
	// Reorder after adding missing edges so chip numbers match submitted arrays.
	doc["connections"] = cloudAgentMediaConnections(edges, a)
	if err := saveCloudAgentDocument(repo, canvas, doc, policy); err != nil {
		return err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		stepID := plan.CallID
		if stepID == "" {
			stepID = a.NodeID
		}
		operation := "generate_media_draft"
		if task != nil {
			operation = "generate_media_submit"
		}
		preview := cloudAgentMediaApprovalPreview(plan, "")
		return recorder[0](repo, cloudAgentMutationInput{
			RunID:              a.DraftRunID,
			UserID:             userID,
			CanvasID:           canvasID,
			StepID:             stepID,
			Operation:          operation,
			BeforeSnapshotHash: beforeHash,
			AfterSnapshotHash:  cloudAgentCanvasHash(doc),
			BeforeJSON:         beforeJSON,
			HasSubmittedTask:   task != nil,
			Preview:            &preview,
		})
	}
	return nil
}

type cloudAgentMediaWritebackError struct {
	error
	reason string
}

func (e *cloudAgentMediaWritebackError) Unwrap() error { return e.error }

func completeCloudAgentMediaNode(repo *repository.Repository, userID, canvasID, targetNodeID string, task *model.Task, policy RuntimePolicySetting) (string, error) {
	if validateCloudAgentID(targetNodeID, "生成节点ID", 80) != nil {
		return "", &cloudAgentMediaWritebackError{error: creationConflict("任务缺少有效的目标节点记录，未回写画布"), reason: "target_node_unknown"}
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", &cloudAgentMediaWritebackError{error: creationConflict("目标画布不存在或已不可访问，未回写任务状态"), reason: "canvas_unavailable"}
		}
		return "", err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return "", err
	}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != targetNodeID {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		if stringValue(meta["taskId"]) != task.ID {
			return "", &cloudAgentMediaWritebackError{error: creationConflict("目标节点的任务绑定已变化，未覆盖现有内容"), reason: "task_binding_changed"}
		}
		meta["taskStatus"] = string(task.Status)
		meta["status"] = "error"
		meta["errorDetails"] = "媒体任务" + string(task.Status) + "：" + cloudAgentSafeMediaTaskError(task)
		if task.Status == model.TaskStatusSucceeded {
			id, _ := taskOutputResource(task.ResultJSON, task.Type)
			resource, e := repo.ResourceForUser(userID, id)
			if e != nil || resource.Status != "ready" || !strings.HasPrefix(resource.MimeType, stringValue(node["type"])+"/") {
				meta["status"] = "error"
				meta["errorDetails"] = "生成结果没有可用的账号资源，未写入媒体地址"
				if saveErr := saveCloudAgentDocument(repo, canvas, doc, policy); saveErr != nil {
					return stringValue(node["id"]), saveErr
				}
				return stringValue(node["id"]), &cloudAgentMediaWritebackError{error: BadAuthRequest("生成结果没有可用的账号资源，未写入媒体地址"), reason: "result_resource_unavailable"}
			}
			meta["content"], meta["storageKey"], meta["status"] = resourceFileURL(id), "resource:"+id, "success"
			meta["naturalWidth"], meta["naturalHeight"] = resource.Width, resource.Height
			if resource.Width > 0 && resource.Height > 0 {
				if width, ok := node["width"].(float64); ok && width > 0 {
					node["height"] = width * float64(resource.Height) / float64(resource.Width)
				}
			}
			delete(meta, "errorDetails")
		}
		return stringValue(node["id"]), saveCloudAgentDocument(repo, canvas, doc, policy)
	}
	return "", &cloudAgentMediaWritebackError{error: creationConflict("目标生成节点不存在，未重建节点；任务记录仍保留在任务中心"), reason: "target_node_missing"}
}
