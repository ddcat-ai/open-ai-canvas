package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
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

// DramaCanvasAssets 为投送到画布的短剧媒体登记素材记录。画布保存要求媒体节点由当前用户的素材引用资源；
// 这里只建素材入口，不复制媒体，资源仍由短剧表持有（素材删除时会保留被短剧使用的资源）。
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
	known := make(map[string]bool, len(existing))
	for _, asset := range existing {
		known[asset.ID] = true
	}
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
		assetID := dramaCanvasAssetID(resource.ID)
		if !known[assetID] {
			asset, err := dramaCanvasAsset(userID, project, resource, kind, input)
			if err != nil {
				return nil, err
			}
			if err := s.repo.UpsertAsset(asset); err != nil {
				return nil, err
			}
			known[assetID] = true
		}
		items = append(items, map[string]string{"resourceId": resource.ID, "assetId": assetID})
	}
	return map[string]any{"assets": items}, nil
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
	width, height := resource.Width, resource.Height
	if width <= 0 {
		width = 1
	}
	if height <= 0 {
		height = 1
	}
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
		"metadata": map[string]any{"source": "short-drama", "dramaProjectId": project.ID, "resourceKey": storageKey},
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
	views := make([]DramaTakeView, 0, len(takes))
	currentMarked := false
	for _, take := range takes {
		view := DramaTakeView{
			ID: take.ID, OwnerID: take.OwnerID, Kind: take.Kind, Version: take.Version, ResourceID: take.ResourceID, TaskID: take.TaskID,
			Prompt: truncateRunes(take.Prompt, 300), DurationMs: take.DurationMs, Source: dramaTakeSource(take, taskProjects, project.ID),
			CreatedAt: take.CreatedAt.Format(time.RFC3339),
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
	plan := &dramaSegmentAdoption{project: project, production: productionRow, episode: episode, segment: *segment, resource: resource, cascade: cascade}
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

// applyDramaSegmentAdoption 写入采用结果。resume=false 用于 Agent 检查点事务：不恢复暂停的制作（恢复会解析模型目录），
// 只唤醒调度；暂停中的作品在用户继续制作后补抽尾帧并重新合成。
func (s *Service) applyDramaSegmentAdoption(plan *dramaSegmentAdoption, resume bool) (map[string]any, error) {
	result := map[string]any{"adopted": false, "requeued": 0, "paused": plan.production.Status == model.DramaStatusPaused}
	if plan.unchanged {
		result["unchanged"] = true
		return result, nil
	}
	durationMs := plan.resource.DurationMs
	seconds := 0
	if durationMs > 0 {
		seconds = int((durationMs + 999) / 1000)
	}
	take := &model.DramaTake{ID: newID(), ProjectID: plan.project.ID, OwnerID: plan.segment.ID, Kind: "video", ResourceID: plan.resource.ID, Prompt: dramaTakeCanvasPrompt, DurationMs: durationMs, CreatedAt: time.Now()}
	if plan.task != nil {
		take.TaskID, take.Prompt = plan.task.ID, truncateRunes(firstNonEmpty(strings.TrimSpace(plan.task.Prompt), dramaTakeCanvasPrompt), 2000)
	}
	if err := s.repo.CreateDramaTake(take); err != nil {
		return nil, err
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

// dramaCanvasSpent 是关联到作品的画布上生成任务的花费。
func (s *Service) dramaCanvasSpent(production *model.DramaProduction) (int64, error) {
	spends, err := s.repo.DramaCanvasSpends(production.UserID, []string{production.ProjectID})
	if err != nil {
		return 0, err
	}
	return spends[production.ProjectID], nil
}

// dramaTotalSpent 是预算判断使用的作品总花费：流水线已结算花费加画布精修花费。
func (s *Service) dramaTotalSpent(production *model.DramaProduction) (int64, error) {
	canvas, err := s.dramaCanvasSpent(production)
	if err != nil {
		return 0, err
	}
	return production.SpentMicrocredits + canvas, nil
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
