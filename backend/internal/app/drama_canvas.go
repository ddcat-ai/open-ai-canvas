package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// 短剧与精修画布打通：短剧是事实源与调度方，画布是精修台。
// 短剧 → 画布：前端按需投送设定、剧情段与成片，媒体节点需要素材记录（DramaCanvasAssets）。
// 画布 → 短剧：只认显式采用（设定图走 SetDramaCastImage，段视频走 AdoptDramaSegmentVideo），写成一个新版本。
// 画布上生成任务的花费计入作品预算与已用积分。

const (
	dramaTakeUploadPrompt = "用户上传"
	dramaTakeCanvasPrompt = "画布采用"
	dramaCanvasAssetLimit = 64
	dramaTakeListLimit    = 50
	// 一次登记最多为几个尺寸未知的媒体补探测，以及补探测的总时长上限。
	dramaCanvasDimensionRepairLimit   = 8
	dramaCanvasDimensionRepairTimeout = 45 * time.Second
)

// DramaCanvas 返回作品最近使用的精修画布；没有时 canvasId 为空，由前端新建画布并写入关联。
func (s *Service) DramaCanvas(userID, projectID string) (map[string]any, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	canvases, err := s.repo.ProjectCanvasSummaries(userID, project.ID)
	if err != nil {
		return nil, err
	}
	canvasID := ""
	if len(canvases) > 0 {
		canvasID = canvases[0].ID
	}
	return map[string]any{"canvasId": canvasID, "canvasCount": len(canvases)}, nil
}

// dramaCanvasAssetID 让同一资源只登记一个素材：重复投送、重复打开画布都复用这条记录。
func dramaCanvasAssetID(resourceID string) string {
	return "drama-" + resourceID
}

// DramaCanvasAssets 为投送到画布的短剧媒体登记素材记录，并挂到短剧项目的素材库。画布保存要求媒体节点由当前用户的素材引用资源；
// 这里只建素材入口，不复制媒体，资源仍由短剧表持有（素材删除时会保留被短剧使用的资源）。
// 重复登记是幂等的，同时为旧版本登记的素材补项目归属、项目链接与真实尺寸。
func (s *Service) DramaCanvasAssets(userID, projectID string, req DramaCanvasAssetsRequest) (map[string]any, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if len(req.Resources) == 0 || len(req.Resources) > dramaCanvasAssetLimit {
		return nil, BadAuthRequest(fmt.Sprintf("每次登记 1–%d 个媒体", dramaCanvasAssetLimit))
	}
	inputs := make([]DramaCanvasAssetInput, 0, len(req.Resources))
	resourceIDs := make([]string, 0, len(req.Resources))
	seen := map[string]bool{}
	for _, input := range req.Resources {
		id := strings.TrimSpace(input.ResourceID)
		if id == "" || utf8.RuneCountInString(id) > 36 {
			return nil, BadAuthRequest("媒体资源 ID 无效")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		input.ResourceID = id
		inputs = append(inputs, input)
		resourceIDs = append(resourceIDs, id)
	}
	resources, err := s.repo.ResourcesForUserIDs(userID, resourceIDs)
	if err != nil {
		return nil, err
	}
	resourceByID := make(map[string]model.Resource, len(resources))
	for _, resource := range resources {
		resourceByID[resource.ID] = resource
	}
	assetIDs := make([]string, 0, len(inputs))
	for _, input := range inputs {
		assetIDs = append(assetIDs, dramaCanvasAssetID(input.ResourceID))
	}
	existing, err := s.repo.AssetsForUserIDs(userID, assetIDs)
	if err != nil {
		return nil, err
	}
	existingByID := make(map[string]*model.Asset, len(existing))
	for index := range existing {
		existingByID[existing[index].ID] = &existing[index]
	}
	links, err := s.repo.ProjectAssetLinks(project.ID)
	if err != nil {
		return nil, err
	}
	linked := make(map[string]bool, len(links))
	for _, link := range links {
		linked[link.AssetID] = true
	}
	// 尺寸未知的媒体按需补探测；数量与总时长有界，没轮到的在下次投送时继续。
	repairCtx, cancelRepair := context.WithTimeout(context.Background(), dramaCanvasDimensionRepairTimeout)
	defer cancelRepair()
	repairBudget := dramaCanvasDimensionRepairLimit
	items := make([]map[string]string, 0, len(inputs))
	for _, input := range inputs {
		// 不存在、未就绪或不是图片/视频的资源不登记，也不让整批失败：历史版本可能已不可用，
		// 由前端决定缺少哪些媒体时仍可投送（历史版本）、哪些必须中止（当前媒体与参考图）。
		resource, ok := resourceByID[input.ResourceID]
		if !ok || resource.Status != model.ResourceStatusReady {
			continue
		}
		kind := dramaResourceMediaKind(resource)
		if kind == "" {
			continue
		}
		if (resource.Width <= 0 || resource.Height <= 0) && repairBudget > 0 && repairCtx.Err() == nil {
			repairBudget--
			s.repairResourceDimensions(repairCtx, &resource)
		}
		assetID := dramaCanvasAssetID(resource.ID)
		if asset := existingByID[assetID]; asset == nil {
			created, err := dramaCanvasAsset(userID, project, resource, kind, input)
			if err != nil {
				return nil, err
			}
			// 素材与项目链接在同一事务内创建，不会留下“未关联项目”的短剧素材。
			if err := s.linkAssetToProject(created, project.ID, created.CreatedAt); err != nil {
				return nil, err
			}
			linked[assetID] = true
		} else if asset.Status != model.AssetVersionStatusArchived {
			// 旧版本登记的素材缺项目归属、尺寸被写成 1×1：补齐后再确保项目链接存在。用户归档的素材保持原样。
			if _, err := s.rewriteAssetPayload(asset, func(payload map[string]any) bool {
				return dramaCanvasAssetRepair(payload, project, resource)
			}); err != nil {
				return nil, err
			}
			if !linked[assetID] {
				if err := s.linkAssetToProject(asset, project.ID, time.Now()); err != nil {
					return nil, err
				}
				linked[assetID] = true
			}
		}
		items = append(items, map[string]string{"resourceId": resource.ID, "assetId": assetID})
	}
	return map[string]any{"assets": items}, nil
}

// dramaCanvasAssetRepair 为已登记的短剧素材补项目归属（projectIds/projectName）与真实尺寸；已正确的文档不改。
func dramaCanvasAssetRepair(payload map[string]any, project *model.Project, resource model.Resource) bool {
	changed := assetDataWithDimensions(payload, resource.Width, resource.Height)
	metadata, _ := payload["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
		payload["metadata"] = metadata
	}
	projectIDs := []string{}
	if values, ok := metadata["projectIds"].([]any); ok {
		for _, value := range values {
			if id, ok := value.(string); ok && strings.TrimSpace(id) != "" {
				projectIDs = append(projectIDs, id)
			}
		}
	}
	if !slices.Contains(projectIDs, project.ID) {
		metadata["projectIds"] = append(projectIDs, project.ID)
		changed = true
	}
	if name, _ := metadata["projectName"].(string); strings.TrimSpace(name) == "" && strings.TrimSpace(project.Name) != "" {
		metadata["projectName"] = project.Name
		changed = true
	}
	return changed
}

func dramaResourceMediaKind(resource model.Resource) string {
	switch {
	case strings.HasPrefix(resource.MimeType, "image/"):
		return "image"
	case strings.HasPrefix(resource.MimeType, "video/"):
		return "video"
	}
	return ""
}

// dramaCanvasAsset 生成与前端素材库同构的记录（data.storageKey 指向资源），画布保存的素材校验以此为准。
func dramaCanvasAsset(userID string, project *model.Project, resource model.Resource, kind string, input DramaCanvasAssetInput) (*model.Asset, error) {
	now := time.Now()
	title := truncateRunes(strings.TrimSpace(input.Title), 120)
	if title == "" {
		title = truncateRunes(project.Name, 80) + map[string]string{"image": " · 图片", "video": " · 视频"}[kind]
	}
	category := model.NormalizeAssetCategory(model.AssetCategory(strings.TrimSpace(input.Category)), kind)
	// 尺寸未知时如实写 0（调用方已尝试补探测）；素材合同允许视频为 0，图片在读取时由 ClientAssetPayload 兜底。
	width, height := max(resource.Width, 0), max(resource.Height, 0)
	storageKey := "resource:" + resource.ID
	fileURL := "/api/resources/" + resource.ID + "/file"
	data := map[string]any{"storageKey": storageKey, "mimeType": resource.MimeType, "bytes": resource.Size, "width": width, "height": height}
	coverURL := fileURL
	if kind == "image" {
		data["dataUrl"] = fileURL
	} else {
		data["url"] = fileURL
		coverURL = ""
		if resource.DurationMs > 0 {
			data["durationMs"] = resource.DurationMs
		}
	}
	id := dramaCanvasAssetID(resource.ID)
	payload, err := json.Marshal(map[string]any{
		"id": id, "kind": kind, "category": category, "status": model.AssetVersionStatusConfirmed,
		"title": title, "coverUrl": coverURL, "tags": []string{}, "source": "短剧",
		"createdAt": now.UTC().Format(time.RFC3339Nano), "updatedAt": now.UTC().Format(time.RFC3339Nano),
		"data":     data,
		"metadata": map[string]any{"source": "short-drama", "dramaProjectId": project.ID, "resourceKey": storageKey, "projectIds": []string{project.ID}, "projectName": project.Name},
	})
	if err != nil {
		return nil, err
	}
	return &model.Asset{ID: id, UserID: userID, Kind: kind, Category: category, Status: model.AssetVersionStatusConfirmed, Title: title, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}, nil
}

// DramaTakes 返回一个设定、剧情段或成片的版本记录，并标出当前采用的版本与来源。
func (s *Service) DramaTakes(userID, projectID, ownerID, kind string) (map[string]any, error) {
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	ownerID = strings.TrimSpace(ownerID)
	if ownerID == "" {
		return nil, BadAuthRequest("请指定要查看版本的对象")
	}
	current := ""
	switch kind {
	case "cast":
		cast, err := s.repo.DramaCast(project.ID, ownerID)
		if err != nil {
			return nil, err
		}
		current = cast.ImageResourceID
	case "video":
		segment, err := s.repo.DramaSegment(project.ID, ownerID)
		if err != nil {
			return nil, err
		}
		current = segment.VideoResourceID
	case "final":
		episode, err := s.repo.DramaEpisode(project.ID, ownerID)
		if err != nil {
			return nil, err
		}
		current = episode.FinalResourceID
	default:
		return nil, BadAuthRequest("版本类型无效")
	}
	takes, err := s.repo.DramaTakes(project.ID, ownerID, kind, dramaTakeListLimit)
	if err != nil {
		return nil, err
	}
	taskIDs := make([]string, 0, len(takes))
	for _, take := range takes {
		if take.TaskID != "" {
			taskIDs = append(taskIDs, take.TaskID)
		}
	}
	taskProjects, err := s.repo.TaskProjectIDs(userID, taskIDs)
	if err != nil {
		return nil, err
	}
	taskModels, err := s.repo.TaskModels(userID, taskIDs)
	if err != nil {
		return nil, err
	}
	views := make([]DramaTakeView, 0, len(takes))
	currentMarked := false
	for _, take := range takes {
		view := DramaTakeView{
			ID: take.ID, OwnerID: take.OwnerID, Kind: take.Kind, Version: take.Version, ResourceID: take.ResourceID, TaskID: take.TaskID,
			Prompt: truncateRunes(take.Prompt, 300), DurationMs: take.DurationMs, Source: dramaTakeSource(take, taskProjects, project.ID),
			CreatedAt: take.CreatedAt.Format(time.RFC3339), Model: taskModels[take.TaskID],
		}
		// 同一资源可能有多条版本记录（例如重复采用），只把最新一条标为当前。
		if !currentMarked && current != "" && take.ResourceID == current {
			view.Current, currentMarked = true, true
		}
		views = append(views, view)
	}
	return map[string]any{"takes": views, "currentResourceId": current}, nil
}

// dramaTakeSource 按产出任务所在位置区分来源：流水线任务挂在作品上，画布任务挂在画布上；无任务的是上传或画布采用。
func dramaTakeSource(take model.DramaTake, taskProjects map[string]string, dramaProjectID string) string {
	if take.TaskID == "" {
		if take.Prompt == dramaTakeCanvasPrompt {
			return "canvas"
		}
		return "upload"
	}
	if projectID, ok := taskProjects[take.TaskID]; ok && projectID != "" && projectID != dramaProjectID {
		return "canvas"
	}
	return "pipeline"
}

// dramaCanvasSourceTask 校验画布声明的来源任务：必须属于当前用户且结果里包含该资源，否则只按资源采用。
func (s *Service) dramaCanvasSourceTask(userID, taskID, resourceID string) *model.Task {
	taskID = strings.TrimSpace(taskID)
	if taskID == "" || utf8.RuneCountInString(taskID) > 36 {
		return nil
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil || task == nil || !strings.Contains(task.ResultJSON, resourceID) {
		return nil
	}
	return task
}

// dramaSegmentAdoption 是一次段视频采用的已校验输入；校验只读数据库，可在 Agent 检查点事务内执行。
type dramaSegmentAdoption struct {
	project    *model.Project
	production *model.DramaProduction
	episode    *model.DramaEpisode
	segment    model.DramaSegment
	resource   *model.Resource
	task       *model.Task
	cascade    bool
	unchanged  bool
	// reuseTake 为 true 时只切换当前视频，不新建版本记录（用于把历史版本设为当前）。
	reuseTake  bool
	durationMs int64
}

func (s *Service) prepareDramaSegmentAdoption(userID, projectID, episodeID string, index int, req AdoptDramaSegmentVideoRequest) (*dramaSegmentAdoption, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, strings.TrimSpace(episodeID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("这一集不存在")
		}
		return nil, err
	}
	rows, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	var segment *model.DramaSegment
	for i := range rows {
		if rows[i].SegmentIndex == index {
			segment = &rows[i]
			break
		}
	}
	if segment == nil {
		return nil, BadAuthRequest("剧情段不存在，可能已重新改编")
	}
	if req.ExpectedRevision != nil && *req.ExpectedRevision != segment.Revision {
		return nil, dramaSegmentChangedError()
	}
	resourceID := strings.TrimSpace(req.ResourceID)
	if resourceID == "" {
		return nil, BadAuthRequest("请选择要采用的视频")
	}
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("视频不存在或无权使用")
		}
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "video/") {
		return nil, BadAuthRequest("请选择已完成的视频")
	}
	// 并行出片的段不以上一段尾帧为首帧，换掉本段不影响后续段，级联重生成只会白白计费。
	cascade := req.Cascade && !parseDramaSettings(productionRow.SettingsJSON).parallelVideo()
	plan := &dramaSegmentAdoption{project: project, production: productionRow, episode: episode, segment: *segment, resource: resource, cascade: cascade, durationMs: resource.DurationMs}
	plan.task = s.dramaCanvasSourceTask(userID, req.TaskID, resource.ID)
	plan.unchanged = segment.VideoResourceID == resource.ID && segment.VideoStatus == model.DramaMediaReady
	return plan, nil
}

func dramaSegmentChangedError() *AppError {
	err := NewAppError(http.StatusConflict, "剧情段刚被修改，请刷新后再采用")
	err.Reason = ReasonDramaSegmentChanged
	return err
}

// AdoptDramaSegmentVideo 把画布上的视频采用为剧情段当前视频（HTTP 入口）。
// 写入只做数据库操作；随后在请求内抽尾帧并校准时长，失败或超时时由调度循环补做。
func (s *Service) AdoptDramaSegmentVideo(userID, projectID, episodeID string, index int, req AdoptDramaSegmentVideoRequest) (map[string]any, error) {
	plan, err := s.prepareDramaSegmentAdoption(userID, projectID, episodeID, index, req)
	if err != nil {
		return nil, err
	}
	result, err := s.applyDramaSegmentAdoption(plan, true)
	if err != nil || plan.unchanged {
		return result, err
	}
	segment, err := s.repo.DramaSegment(plan.project.ID, plan.segment.ID)
	if err != nil {
		return result, nil
	}
	if segment.VideoResourceID == plan.resource.ID && segment.TailFrameResourceID == "" {
		if backfillErr := s.backfillDramaSegmentTail(userID, *segment); backfillErr != nil {
			result["tailError"] = backfillErr.Error()
		}
		if refreshed, refreshErr := s.repo.DramaSegment(plan.project.ID, plan.segment.ID); refreshErr == nil {
			segment = refreshed
		}
	}
	result["tailPending"] = segment.TailFrameResourceID == "" && segment.VideoStatus == model.DramaMediaReady
	if segment.VideoStatus == model.DramaMediaFailed {
		result["videoError"] = segment.VideoError
	}
	result["videoSeconds"] = segment.VideoSeconds
	return result, nil
}

// RestoreDramaSegmentTake 把本段已有的视频版本设为当前播放版本。
// 复用采用写入（时长、尾帧、成片过期），但不新建版本记录、不删除其它版本、不级联后续段。
func (s *Service) RestoreDramaSegmentTake(userID, projectID, episodeID string, index int, req RestoreDramaSegmentTakeRequest) (map[string]any, error) {
	plan, err := s.prepareDramaSegmentTakeRestore(userID, projectID, episodeID, index, req)
	if err != nil {
		return nil, err
	}
	result, err := s.applyDramaSegmentAdoption(plan, true)
	if result != nil {
		if adopted, ok := result["adopted"].(bool); ok {
			result["restored"] = adopted
		}
	}
	if err != nil || plan.unchanged {
		return result, err
	}
	segment, err := s.repo.DramaSegment(plan.project.ID, plan.segment.ID)
	if err != nil {
		return result, nil
	}
	if segment.VideoResourceID == plan.resource.ID && segment.TailFrameResourceID == "" {
		if backfillErr := s.backfillDramaSegmentTail(userID, *segment); backfillErr != nil {
			result["tailError"] = backfillErr.Error()
		}
		if refreshed, refreshErr := s.repo.DramaSegment(plan.project.ID, plan.segment.ID); refreshErr == nil {
			segment = refreshed
		}
	}
	result["tailPending"] = segment.TailFrameResourceID == "" && segment.VideoStatus == model.DramaMediaReady
	if segment.VideoStatus == model.DramaMediaFailed {
		result["videoError"] = segment.VideoError
	}
	result["videoSeconds"] = segment.VideoSeconds
	return result, nil
}

func (s *Service) prepareDramaSegmentTakeRestore(userID, projectID, episodeID string, index int, req RestoreDramaSegmentTakeRequest) (*dramaSegmentAdoption, error) {
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, strings.TrimSpace(episodeID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("这一集不存在")
		}
		return nil, err
	}
	rows, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	var segment *model.DramaSegment
	for i := range rows {
		if rows[i].SegmentIndex == index {
			segment = &rows[i]
			break
		}
	}
	if segment == nil {
		return nil, BadAuthRequest("剧情段不存在，可能已重新改编")
	}
	if req.ExpectedRevision != nil && *req.ExpectedRevision != segment.Revision {
		return nil, dramaSegmentChangedError()
	}
	takeID := strings.TrimSpace(req.TakeID)
	if takeID == "" {
		return nil, BadAuthRequest("请选择要切换的版本")
	}
	take, err := s.repo.DramaTake(project.ID, takeID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("该版本不存在")
		}
		return nil, err
	}
	if take.OwnerID != segment.ID || take.Kind != "video" {
		return nil, BadAuthRequest("该版本不属于本段视频")
	}
	if take.ResourceID == "" {
		return nil, BadAuthRequest("该版本没有可播放的视频")
	}
	resource, err := s.repo.ResourceForUser(userID, take.ResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("视频不存在或无权使用")
		}
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "video/") {
		return nil, BadAuthRequest("请选择已完成的视频")
	}
	durationMs := resource.DurationMs
	if durationMs <= 0 {
		durationMs = take.DurationMs
	}
	plan := &dramaSegmentAdoption{project: project, production: productionRow, episode: episode, segment: *segment, resource: resource, cascade: false, reuseTake: true, durationMs: durationMs}
	if take.TaskID != "" {
		plan.task = s.dramaCanvasSourceTask(userID, take.TaskID, resource.ID)
	}
	plan.unchanged = segment.VideoResourceID == resource.ID && segment.VideoStatus == model.DramaMediaReady
	return plan, nil
}

// applyDramaSegmentAdoption 写入采用结果。resume=false 用于 Agent 检查点事务：不恢复暂停的制作（恢复会解析模型目录），
// 只唤醒调度；暂停中的作品在用户继续制作后补抽尾帧并重新合成。
func (s *Service) applyDramaSegmentAdoption(plan *dramaSegmentAdoption, resume bool) (map[string]any, error) {
	result := map[string]any{"adopted": false, "requeued": 0, "paused": plan.production.Status == model.DramaStatusPaused}
	if plan.unchanged {
		result["unchanged"] = true
		return result, nil
	}
	durationMs := plan.durationMs
	if durationMs <= 0 {
		durationMs = plan.resource.DurationMs
	}
	seconds := 0
	if durationMs > 0 {
		seconds = int((durationMs + 999) / 1000)
	}
	if !plan.reuseTake {
		take := &model.DramaTake{ID: newID(), ProjectID: plan.project.ID, OwnerID: plan.segment.ID, Kind: "video", ResourceID: plan.resource.ID, Prompt: dramaTakeCanvasPrompt, DurationMs: durationMs, CreatedAt: time.Now()}
		if plan.task != nil {
			take.TaskID, take.Prompt = plan.task.ID, truncateRunes(firstNonEmpty(strings.TrimSpace(plan.task.Prompt), dramaTakeCanvasPrompt), 2000)
		}
		if err := s.repo.CreateDramaTake(take); err != nil {
			return nil, err
		}
	}
	fields := map[string]any{"video_resource_id": plan.resource.ID, "video_seconds": seconds, "tail_frame_resource_id": "", "video_status": model.DramaMediaReady, "video_error": ""}
	adopted, requeued, err := s.repo.AdoptDramaSegmentVideo(plan.segment, fields, plan.cascade)
	if err != nil {
		return nil, err
	}
	if !adopted {
		return nil, dramaSegmentChangedError()
	}
	result["adopted"], result["requeued"] = true, requeued
	if requeued > 0 && resume {
		// 后续段重新生成是用户明确要求的花费：暂停或已完成的制作直接恢复（含预算与模型校验）。
		if err := s.requestDramaWork(plan.production); err != nil {
			result["resumeError"] = err.Error()
		}
	} else if err := s.reopenDrama(plan.production); err != nil {
		return nil, err
	}
	return result, nil
}

// adoptDramaSegmentVideoDeferred 供 Agent 检查点事务调用：只写数据库，尾帧与精确时长由调度循环补做。
func (s *Service) adoptDramaSegmentVideoDeferred(userID, projectID, episodeID string, index int, req AdoptDramaSegmentVideoRequest) (map[string]any, error) {
	plan, err := s.prepareDramaSegmentAdoption(userID, projectID, episodeID, index, req)
	if err != nil {
		return nil, err
	}
	return s.applyDramaSegmentAdoption(plan, false)
}

// backfillDramaSegmentTail 为已采用、尚缺尾帧的剧情段抽取尾帧并按实际时长校准进入成片的秒数。
// 抽取失败时把段标记为失败并写明原因，避免下一段一直等首帧；写回按段版本做 CAS。
func (s *Service) backfillDramaSegmentTail(userID string, segment model.DramaSegment) error {
	resource, err := s.repo.ResourceForUser(userID, segment.VideoResourceID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	var fields map[string]any
	if resource == nil || err != nil {
		fields = map[string]any{"video_status": model.DramaMediaFailed, "video_error": "采用的视频已不存在，请重新采用或重新生成本段"}
	} else if facts, inspectErr := s.inspectDramaVideo(userID, resource); inspectErr != nil {
		fields = map[string]any{"video_status": model.DramaMediaFailed, "video_error": truncateRunes("采用的视频处理失败："+inspectErr.Error(), 500)}
	} else {
		seconds := segment.VideoSeconds
		if facts.DurationMs > 0 {
			seconds = int((facts.DurationMs + 999) / 1000)
		}
		if seconds <= 0 {
			fields = map[string]any{"video_status": model.DramaMediaFailed, "video_error": "无法读取采用视频的时长，请重新采用或重新生成本段"}
		} else {
			fields = map[string]any{"tail_frame_resource_id": facts.TailResourceID, "video_seconds": seconds, "video_error": ""}
		}
	}
	_, err = s.repo.UpdateDramaSegmentRevision(segment.ID, segment.Revision, fields)
	return err
}

// dramaCanvasSpent 是关联到作品的画布上生成任务的预算占用：已结算按实收、未结算按冻结额、已退回不计。
func (s *Service) dramaCanvasSpent(production *model.DramaProduction) (int64, error) {
	totals, err := s.dramaBillingTotals(production)
	if err != nil {
		return 0, err
	}
	return totals.CanvasChargedMicrocredits + totals.CanvasHeldMicrocredits, nil
}

// dramaTotalSpent 是预算判断使用的作品总占用，与调度派发同一口径：流水线与画布精修的实收，加上所有未结算订单的冻结额。
func (s *Service) dramaTotalSpent(production *model.DramaProduction) (int64, error) {
	totals, err := s.dramaBillingTotals(production)
	if err != nil {
		return 0, err
	}
	return totals.ChargedMicrocredits() + totals.HeldMicrocredits(), nil
}

func (s *Service) dramaBudgetExhausted(production *model.DramaProduction) (bool, error) {
	if production.BudgetMicrocredits <= 0 {
		return false, nil
	}
	spent, err := s.dramaTotalSpent(production)
	if err != nil {
		return false, err
	}
	return spent >= production.BudgetMicrocredits, nil
}

// ensureDramaCanvasBudget 在画布任务创建时检查关联作品的预算；未关联短剧或不限预算时放行。
func (s *Service) ensureDramaCanvasBudget(projectID string) error {
	production, err := s.repo.DramaProduction(projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	exhausted, err := s.dramaBudgetExhausted(production)
	if err != nil {
		return err
	}
	if !exhausted {
		return nil
	}
	budgetErr := BadAuthRequest("这部短剧已达到预算上限（含画布精修花费），请在短剧设置里提高预算后再生成")
	budgetErr.Reason = ReasonDramaBudget
	return budgetErr
}

// dramaLinkedCanvas 判断画布是否关联到当前用户的短剧作品；Agent 只在这种画布上暴露短剧工具。
func dramaLinkedCanvas(repo *repository.Repository, canvas *model.CanvasProject) bool {
	if canvas == nil || strings.TrimSpace(canvas.ProjectID) == "" {
		return false
	}
	production, err := repo.DramaProduction(canvas.ProjectID)
	return err == nil && production != nil && production.UserID == canvas.UserID
}
