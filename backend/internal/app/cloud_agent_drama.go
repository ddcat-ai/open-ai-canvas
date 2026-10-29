package app

import (
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// Agent 的短剧工具：只在画布关联了当前用户的短剧作品时暴露（Scope.Drama）。
// drama_get_context 只读；drama_adopt_canvas_media 总是审批后才写入，写入只改短剧版本，不改画布。

const (
	cloudAgentDramaListLimit  = 200
	cloudAgentDramaBoundLimit = 100
)

type cloudAgentDramaContextArgs struct {
	EpisodeID     string `json:"episodeId"`
	EpisodeNumber int    `json:"episodeNumber"`
}

type cloudAgentDramaRef struct {
	Kind         string
	ID           string
	EpisodeID    string
	SegmentIndex *int
}

// cloudAgentDramaRefOf 读取节点（或其所在剧情段框）上的短剧绑定，绑定由画布投送时写入 metadata.dramaRef。
func cloudAgentDramaRefOf(node map[string]any, nodes map[string]map[string]any) (cloudAgentDramaRef, bool) {
	for depth := 0; node != nil && depth < 3; depth++ {
		meta, _ := node["metadata"].(map[string]any)
		if raw, ok := meta["dramaRef"].(map[string]any); ok {
			ref := cloudAgentDramaRef{Kind: stringValue(raw["kind"]), ID: stringValue(raw["id"]), EpisodeID: stringValue(raw["episodeId"])}
			if index, ok := raw["segmentIndex"].(float64); ok && index >= 0 {
				value := int(index)
				ref.SegmentIndex = &value
			}
			if ref.Kind != "" && ref.ID != "" {
				return ref, true
			}
		}
		parentID := stringValue(node["parentId"])
		if parentID == "" {
			break
		}
		node = nodes[parentID]
	}
	return cloudAgentDramaRef{}, false
}

func cloudAgentDramaCanvas(repo *repository.Repository, userID, canvasID string) (*model.CanvasProject, map[string]map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, err
	}
	if !dramaLinkedCanvas(repo, canvas) {
		return nil, nil, BadAuthRequest("当前画布没有关联短剧作品")
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, err
	}
	return canvas, nodes, nil
}

func cloudAgentHandleDramaGetContext(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	if service == nil {
		return nil, BadAuthRequest("短剧服务不可用")
	}
	var args cloudAgentDramaContextArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	canvas, nodes, err := cloudAgentDramaCanvas(repo, userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	summary, err := service.DramaSummary(userID, canvas.ProjectID)
	if err != nil {
		return nil, err
	}
	casts, err := service.DramaCasts(userID, canvas.ProjectID)
	if err != nil {
		return nil, err
	}
	production := summary.Production
	result := map[string]any{
		"drama": map[string]any{
			"id": summary.Project.ID, "name": summary.Project.Name, "status": production.Status, "pauseReason": production.PauseReason,
			"aspectRatio": production.Settings.AspectRatio, "budgetCredits": float64(production.BudgetMicrocredits) / 1e6,
			"spentCredits": float64(production.SpentMicrocredits) / 1e6, "canvasSpentCredits": float64(production.CanvasSpentMicrocredits) / 1e6,
		},
	}
	episodes := make([]map[string]any, 0, min(len(summary.Episodes), cloudAgentDramaListLimit))
	for _, episode := range summary.Episodes {
		if len(episodes) >= cloudAgentDramaListLimit {
			break
		}
		episodes = append(episodes, map[string]any{
			"id": episode.ID, "number": episode.Number, "title": episode.Title, "stage": episode.Stage, "hasFinal": episode.FinalResourceID != "",
			"finalStale": episode.FinalStale, "segments": episode.Stats.Segments, "videoReady": episode.Stats.VideoReady, "failed": episode.Stats.Failed,
		})
	}
	result["episodes"] = episodes
	castViews := make([]map[string]any, 0, min(len(casts), cloudAgentDramaListLimit))
	for _, cast := range casts {
		if len(castViews) >= cloudAgentDramaListLimit {
			break
		}
		castViews = append(castViews, map[string]any{
			"id": cast.ID, "kind": cast.Kind, "name": cast.Name, "imageStatus": cast.ImageStatus, "hasImage": cast.ImageResourceID != "",
			"locked": cast.Locked, "appearance": truncateRunes(cast.Appearance, 200),
		})
	}
	result["casts"] = castViews
	bound := []map[string]any{}
	for id, node := range nodes {
		meta, _ := node["metadata"].(map[string]any)
		raw, ok := meta["dramaRef"].(map[string]any)
		if !ok || len(bound) >= cloudAgentDramaBoundLimit {
			continue
		}
		bound = append(bound, map[string]any{"nodeId": id, "nodeType": stringValue(node["type"]), "title": truncateRunes(stringValue(node["title"]), 80), "kind": stringValue(raw["kind"]), "id": stringValue(raw["id"]), "episodeId": stringValue(raw["episodeId"]), "segmentIndex": raw["segmentIndex"]})
	}
	result["boundNodes"] = bound
	episodeID := strings.TrimSpace(args.EpisodeID)
	if episodeID == "" && args.EpisodeNumber > 0 {
		for _, episode := range summary.Episodes {
			if episode.Number == args.EpisodeNumber {
				episodeID = episode.ID
				break
			}
		}
		if episodeID == "" {
			return nil, &cloudAgentArgumentError{BadAuthRequest(fmt.Sprintf("没有第 %d 集", args.EpisodeNumber))}
		}
	}
	if episodeID != "" {
		detail, err := service.DramaEpisodeDetail(userID, canvas.ProjectID, episodeID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, &cloudAgentArgumentError{BadAuthRequest("这一集不存在")}
			}
			return nil, err
		}
		segments := make([]map[string]any, 0, len(detail.Segments))
		for _, segment := range detail.Segments {
			references := make([]string, 0, len(segment.Request.References))
			for _, reference := range segment.Request.References {
				references = append(references, reference.Label+"："+reference.Name)
			}
			segments = append(segments, map[string]any{
				"index": segment.Index, "id": segment.ID, "title": segment.Title, "durationSeconds": float64(segment.DurationMs) / 1000,
				"videoStatus": segment.VideoStatus, "hasVideo": segment.VideoResourceID != "", "promptStatus": segment.PromptStatus,
				"references": references, "prompt": truncateRunes(segment.VideoPrompt, 300),
			})
		}
		result["episode"] = map[string]any{"id": detail.Episode.ID, "number": detail.Episode.Number, "title": detail.Episode.Title, "stage": detail.Episode.Stage, "segments": segments}
	}
	return result, nil
}

type cloudAgentDramaAdoptArgs struct {
	NodeID          string `json:"nodeId"`
	CastID          string `json:"castId"`
	EpisodeID       string `json:"episodeId"`
	SegmentIndex    *int   `json:"segmentIndex"`
	RestyleSegments bool   `json:"restyleSegments"`
	Cascade         bool   `json:"cascade"`
}

type cloudAgentDramaAdoptPlan struct {
	Args         cloudAgentDramaAdoptArgs
	DramaID      string
	ResourceID   string
	TaskID       string
	CastID       string
	EpisodeID    string
	SegmentIndex int
	Preview      cloudAgentApprovalPreview
}

// prepareCloudAgentDramaAdopt 解析并校验采用请求；审批预览与执行共用，执行时重新校验，不信任预览。
func prepareCloudAgentDramaAdopt(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentDramaAdoptPlan, error) {
	var args cloudAgentDramaAdoptArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("采用参数无效：仅允许 nodeId、castId、episodeId、segmentIndex、restyleSegments、cascade")}
	}
	if err := validateCloudAgentID(args.NodeID, "节点ID", 80); err != nil {
		return nil, &cloudAgentArgumentError{err}
	}
	canvas, nodes, err := cloudAgentDramaCanvas(repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	node := nodes[args.NodeID]
	if node == nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("节点不在当前画布，请先读取画布")}
	}
	nodeType := stringValue(node["type"])
	if nodeType != "image" && nodeType != "video" {
		return nil, &cloudAgentArgumentError{BadAuthRequest("只能采用图片或视频节点")}
	}
	meta, _ := node["metadata"].(map[string]any)
	key := stringValue(meta["storageKey"])
	if !strings.HasPrefix(key, "resource:") {
		return nil, &cloudAgentArgumentError{BadAuthRequest("节点媒体尚未保存到账号资源库，等生成或上传完成后再采用")}
	}
	resource, err := repo.ResourceForUser(userID, strings.TrimPrefix(key, "resource:"))
	if err != nil || resource == nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, nodeType+"/") {
		return nil, &cloudAgentArgumentError{BadAuthRequest("节点媒体不存在、未就绪或类型不匹配")}
	}
	drama, err := repo.ProjectForUser(userID, canvas.ProjectID)
	if err != nil {
		return nil, err
	}
	plan := &cloudAgentDramaAdoptPlan{Args: args, DramaID: drama.ID, ResourceID: resource.ID, TaskID: stringValue(meta["taskId"])}
	ref, hasRef := cloudAgentDramaRefOf(node, nodes)
	nodeTitle := cloudAgentApprovalNodeTitle(node, map[string]string{"image": "图片", "video": "视频"}[nodeType])
	item := cloudAgentApprovalPreviewItem{Operation: "adopt_drama_media", NodeID: args.NodeID, NodeTitle: nodeTitle, NodeType: nodeType, NodeTypeLabel: map[string]string{"image": "图片", "video": "视频"}[nodeType]}
	if nodeType == "image" {
		plan.CastID = strings.TrimSpace(args.CastID)
		if plan.CastID == "" && hasRef && ref.Kind == "cast" {
			plan.CastID = ref.ID
		}
		if plan.CastID == "" {
			return nil, &cloudAgentArgumentError{BadAuthRequest("请提供 castId：先用 drama_get_context 读取设定")}
		}
		cast, err := repo.DramaCast(drama.ID, plan.CastID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, &cloudAgentArgumentError{BadAuthRequest("设定不存在：请用 drama_get_context 返回的 castId")}
			}
			return nil, err
		}
		item.TargetNodeTitle = cast.Name
		item.Summary = fmt.Sprintf("把图片《%s》设为设定「%s」的参考图并锁定", nodeTitle, cast.Name)
		item.Details = []string{"旧参考图保留在版本记录中"}
		if args.RestyleSegments {
			item.Details = append(item.Details, "引用该设定、已生成的剧情段视频会标记过期，需要重新生成")
		}
	} else {
		plan.EpisodeID = strings.TrimSpace(args.EpisodeID)
		index := args.SegmentIndex
		if plan.EpisodeID == "" && hasRef && ref.Kind == "segment" {
			plan.EpisodeID, index = ref.EpisodeID, ref.SegmentIndex
		}
		if plan.EpisodeID == "" || index == nil {
			return nil, &cloudAgentArgumentError{BadAuthRequest("请提供 episodeId 和 segmentIndex：先用 drama_get_context 读取剧情段")}
		}
		plan.SegmentIndex = *index
		episode, err := repo.DramaEpisode(drama.ID, plan.EpisodeID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, &cloudAgentArgumentError{BadAuthRequest("这一集不存在：请用 drama_get_context 返回的 episodeId")}
			}
			return nil, err
		}
		segments, err := repo.DramaSegments(episode.ID)
		if err != nil {
			return nil, err
		}
		found, later := false, 0
		for _, segment := range segments {
			if segment.SegmentIndex == plan.SegmentIndex {
				found = true
			} else if segment.SegmentIndex > plan.SegmentIndex && segment.VideoResourceID != "" {
				later++
			}
		}
		if !found {
			return nil, &cloudAgentArgumentError{BadAuthRequest("剧情段不存在：请用 drama_get_context 返回的 index")}
		}
		item.TargetNodeTitle = fmt.Sprintf("第 %d 集第 %d 段", episode.Number, plan.SegmentIndex+1)
		item.Summary = fmt.Sprintf("把视频《%s》设为第 %d 集第 %d 段的当前视频", nodeTitle, episode.Number, plan.SegmentIndex+1)
		item.Details = []string{"旧视频保留在版本记录中；已有成片会重新合成"}
		parallel := false
		if productionRow, err := repo.DramaProduction(drama.ID); err == nil {
			parallel = parseDramaSettings(productionRow.SettingsJSON).parallelVideo()
		}
		if args.Cascade && later > 0 && !parallel {
			item.Details = append(item.Details, fmt.Sprintf("后续 %d 段已生成的视频会重新排队生成以保证衔接，按实际用量计费", later))
		} else {
			item.Details = append(item.Details, "只换本段，后续段保持不变")
		}
	}
	plan.Preview = cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "确认采用到短剧",
		Description: fmt.Sprintf("Agent 准备把画布上的%s采用到短剧《%s》。只改短剧版本，不修改画布；批准后才会执行。", item.NodeTypeLabel, truncateRunes(drama.Name, 60)),
		Items:       []cloudAgentApprovalPreviewItem{item},
	}
	return plan, nil
}

func cloudAgentPreviewDramaAdopt(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentDramaAdopt(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

// applyCloudAgentDramaAdopt 在 Agent 检查点事务内写入短剧版本。段视频的尾帧抽取是存储 IO，
// 不能放在事务里，交给短剧调度循环补做；不写画布，因此不登记画布撤销记录。
func applyCloudAgentDramaAdopt(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, _ RuntimePolicySetting, _ ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentDramaAdopt(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	service := &Service{repo: repo}
	var outcome map[string]any
	if plan.CastID != "" {
		outcome, err = service.SetDramaCastImage(userID, plan.DramaID, plan.CastID, SetDramaCastImageRequest{ResourceID: plan.ResourceID, RestyleSegments: plan.Args.RestyleSegments, Source: "canvas", TaskID: plan.TaskID})
	} else {
		outcome, err = service.adoptDramaSegmentVideoDeferred(userID, plan.DramaID, plan.EpisodeID, plan.SegmentIndex, AdoptDramaSegmentVideoRequest{ResourceID: plan.ResourceID, TaskID: plan.TaskID, Cascade: plan.Args.Cascade})
	}
	if err != nil {
		return nil, err
	}
	applied := plan.Preview
	applied.Status, applied.Title = "applied", "已采用到短剧"
	applied.Description = strings.TrimSuffix(plan.Preview.Items[0].Summary, "。") + "。"
	receipt := map[string]any{"dramaProjectId": plan.DramaID, "nodeId": plan.Args.NodeID, "summary": applied.Description, "preview": applied}
	for _, key := range []string{"affectedSegments", "requeued", "paused", "unchanged"} {
		if value, ok := outcome[key]; ok {
			receipt[key] = value
		}
	}
	if plan.CastID != "" {
		receipt["castId"] = plan.CastID
	} else {
		receipt["episodeId"], receipt["segmentIndex"] = plan.EpisodeID, plan.SegmentIndex
		receipt["note"] = "尾帧与成片合成由短剧调度在制作运行时完成；制作暂停时请提醒用户继续制作"
	}
	return receipt, nil
}
