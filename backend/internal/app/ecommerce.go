package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type EcommerceReference struct {
	ResourceID string `json:"resourceId"`
	Role       string `json:"role"`
	CatalogID  string `json:"catalogId,omitempty"`
	Name       string `json:"name,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
}

type EcommerceSku struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	Spec       string `json:"spec"`
	Packaging  string `json:"packaging"`
	Claims     string `json:"claims"`
	Price      string `json:"price"`
	ResourceID string `json:"resourceId,omitempty"`
	Count      int    `json:"count"`
}

type EcommerceDraft struct {
	ProductName              string                    `json:"productName"`
	Category                 string                    `json:"category"`
	Brand                    string                    `json:"brand"`
	Description              string                    `json:"description"`
	Claims                   string                    `json:"claims"`
	Materials                string                    `json:"materials"`
	Colors                   string                    `json:"colors"`
	Specifications           string                    `json:"specifications"`
	Packaging                string                    `json:"packaging"`
	Dimensions               string                    `json:"dimensions"`
	Audience                 string                    `json:"audience"`
	Scene                    string                    `json:"scene"`
	PricePosition            string                    `json:"pricePosition"`
	LockedDetails            string                    `json:"lockedDetails"`
	Platform                 string                    `json:"platform"`
	Region                   string                    `json:"region"`
	ImageType                string                    `json:"imageType"`
	Count                    int                       `json:"count"`
	Language                 string                    `json:"language"`
	NoText                   bool                      `json:"noText"`
	AgentModel               string                    `json:"agentModel"`
	ImageModel               string                    `json:"imageModel"`
	Ratio                    string                    `json:"ratio"`
	Resolution               string                    `json:"resolution"`
	Style                    string                    `json:"style"`
	StylePrompt              string                    `json:"stylePrompt"`
	Fidelity                 string                    `json:"fidelity"`
	Instruction              string                    `json:"instruction"`
	SkillIDs                 []string                  `json:"skillIds,omitempty"`
	ModelEnabled             bool                      `json:"modelEnabled"`
	PrimaryModelResourceID   string                    `json:"primaryModelResourceId,omitempty"`
	PlanningTaskID           string                    `json:"planningTaskId,omitempty"`
	DirectionsTaskID         string                    `json:"directionsTaskId,omitempty"`
	CreativeRecommendationID string                    `json:"creativeRecommendationId,omitempty"`
	CreativeDirectionID      string                    `json:"creativeDirectionId,omitempty"`
	TypeOptions              map[string]string         `json:"typeOptions,omitempty"`
	CloneOptions             map[string]string         `json:"cloneOptions,omitempty"`
	CreativeOptions          *EcommerceCreativeOptions `json:"creativeOptions,omitempty"`
	ReferenceMode            string                    `json:"referenceMode,omitempty"`
	LayoutReferenceID        string                    `json:"layoutReferenceId,omitempty"`
	References               []EcommerceReference      `json:"references"`
	LayoutReferences         []EcommerceReference      `json:"layoutReferences"`
	Skus                     []EcommerceSku            `json:"skus"`
}

type SaveEcommerceProjectRequest struct {
	Revision int64                `json:"revision"`
	Name     string               `json:"name"`
	Draft    EcommerceDraft       `json:"draft"`
	Plan     *model.EcommercePlan `json:"plan,omitempty"`
	// Round-aware clients opt in explicitly. Legacy clients leave these empty
	// and keep the original whole-plan contract byte for byte.
	HistoryMode   string `json:"historyMode,omitempty"`
	AdvanceRound  bool   `json:"advanceRound,omitempty"`
	ActiveRoundID string `json:"activeRoundId,omitempty"`
}

type DeleteEcommerceProjectsRequest struct {
	IDs           []string `json:"ids"`
	All           bool     `json:"all"`
	ExpectedTotal *int64   `json:"expectedTotal"`
}

// EcommerceSkillPrompt reads only installed, active skills owned by this user.
func (s *Service) EcommerceSkillPrompt(userID string, ids []string) (string, error) {
	if len(ids) > 8 {
		return "", BadAuthRequest("每轮最多选择 8 个 Skills")
	}
	seen := make(map[string]bool, len(ids))
	parts := make([]string, 0, len(ids))
	total := 0
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return "", BadAuthRequest("技能 ID 不能为空或重复")
		}
		seen[id] = true
		skill, err := s.SkillDetail(userID, id)
		if err != nil {
			return "", err
		}
		if !skill.IsAdded || skill.Status != 1 {
			return "", BadAuthRequest("只能使用已安装且启用的技能")
		}
		file, err := s.SkillPackageFile(userID, id, "SKILL.md")
		if err != nil {
			return "", err
		}
		body, err := s.ecommerceSkillContext(userID, id, file)
		if err != nil {
			return "", err
		}
		latest, err := s.SkillDetail(userID, id)
		if err != nil {
			return "", err
		}
		if !latest.IsAdded || latest.Status != 1 || latest.VersionID != skill.VersionID || latest.ContentHash != skill.ContentHash {
			return "", creationConflict("技能在读取时已更新，请重新策划")
		}
		total += len(body)
		if total > 32000 {
			return "", BadAuthRequest("所选技能正文超过策划上下文上限，请减少选择")
		}
		parts = append(parts, fmt.Sprintf("技能 %q（版本 %s）：\n%s", skill.SkillName, skill.VersionID, body))
	}
	return strings.Join(parts, "\n\n"), nil
}

func (s *Service) CreateEcommerceProject(userID string) (*model.EcommerceProject, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	project := &model.EcommerceProject{ID: newID(), UserID: userID, Name: "未命名商品", Status: "draft", DraftJSON: "{}", PlanJSON: "{}", ActiveRoundID: newID(), Revision: 1}
	if err := s.repo.CreateEcommerceProject(project); err != nil {
		return nil, err
	}
	return project, nil
}

func (s *Service) EcommerceProject(userID, id string) (*model.EcommerceProject, error) {
	return s.EcommerceProjectView(userID, id, false)
}

// EcommerceProjectView optionally returns only the bounded active round. This
// is a read-only projection: legacy inline history is never converted here.
func (s *Service) EcommerceProjectView(userID, id string, activeOnly bool) (*model.EcommerceProject, error) {
	project, err := s.repo.EcommerceProject(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("电商项目不存在")
	}
	if err == nil {
		s.refreshEcommerceStatus(userID, project)
		var draft EcommerceDraft
		if json.Unmarshal([]byte(project.DraftJSON), &draft) == nil && draft.DirectionsTaskID == "" && draft.CreativeDirectionID == "" {
			if task, taskErr := s.repo.EcommerceDirectionsTask(userID, id, project.CreatedAt); taskErr == nil {
				var input struct {
					Metadata map[string]json.RawMessage `json:"metadata"`
				}
				var source EcommerceDraft
				if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
					raw := input.Metadata["ecommerceDraft"]
					if json.Unmarshal(raw, &source) == nil {
						source.DirectionsTaskID, source.PlanningTaskID = "", ""
						current := draft
						current.DirectionsTaskID, current.PlanningTaskID = "", ""
						a, _ := json.Marshal(source)
						b, _ := json.Marshal(current)
						if string(a) == string(b) {
							draft.DirectionsTaskID = task.ID
							raw, _ = json.Marshal(draft)
							project.DraftJSON = string(raw)
						}
					}
				}
			}
		}
	}
	if err == nil {
		if activeOnly {
			project.PlanJSON = ecommerceActivePlanJSON(project.PlanJSON)
		} else if project.ActiveRoundID != "" {
			// Bounded compatibility view: clients that do not request the active
			// plan still see the newest rounds, never the full history.
			project.PlanJSON = s.ecommercePlanWithRecentRounds(userID, project)
		}
		if count, countErr := s.repo.EcommerceRoundCount(userID, project.ID); countErr == nil {
			project.RoundCount = count
		}
		s.fillEcommerceCoverTasks(userID, project)
	}
	return project, err
}

func ecommerceActivePlanJSON(planJSON string) string {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(planJSON), &plan) != nil || len(plan.PreviousImages) == 0 {
		return planJSON
	}
	plan.PreviousImages = nil
	raw, err := json.Marshal(plan)
	if err != nil {
		return planJSON
	}
	return string(raw)
}

// ecommercePlanWithRecentRounds keeps old clients working: they get the active
// plan plus a bounded page of newer history instead of the whole archive.
func (s *Service) ecommercePlanWithRecentRounds(userID string, project *model.EcommerceProject) string {
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil {
		return project.PlanJSON
	}
	plan.PreviousImages = nil
	rounds, _, err := s.repo.EcommerceRoundPage(userID, project.ID, ecommerceRoundPageDefault, 0)
	if err != nil {
		return project.PlanJSON
	}
	previous := make([]model.EcommercePlanTask, 0)
	for i := len(rounds) - 1; i >= 0; i-- {
		var archived model.EcommercePlan
		if json.Unmarshal([]byte(rounds[i].PlanJSON), &archived) != nil {
			continue
		}
		for _, image := range archived.Images {
			image.RoundID = rounds[i].ID
			previous = append(previous, image)
		}
	}
	if len(previous) > 0 {
		plan.PreviousImages = previous
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return project.PlanJSON
	}
	return string(raw)
}

func (s *Service) fillEcommerceCoverTasks(userID string, project *model.EcommerceProject) {
	if project == nil {
		return
	}
	ids := make([]string, 0, 4)
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) == nil {
		for _, image := range plan.Images {
			if image.TaskID != "" {
				ids = append(ids, image.TaskID)
			}
		}
	}
	if len(ids) < 4 {
		if more, err := s.repo.EcommerceRoundCoverTaskIDs(userID, project.ID, 4-len(ids)); err == nil {
			ids = append(ids, more...)
		}
	}
	project.CoverTaskIDs = ids
}

func (s *Service) EcommerceProjects(userID string) ([]model.EcommerceProject, error) {
	projects, err := s.repo.EcommerceProjects(userID)
	if err != nil {
		return nil, err
	}
	for index := range projects {
		s.refreshEcommerceStatus(userID, &projects[index])
		s.fillEcommerceListMeta(userID, &projects[index])
	}
	return projects, nil
}

func (s *Service) EcommerceProjectPage(userID string, page, pageSize int) ([]model.EcommerceProject, int64, error) {
	projects, total, err := s.repo.EcommerceProjectPage(userID, page, pageSize)
	if err != nil {
		return nil, 0, err
	}
	for index := range projects {
		s.refreshEcommerceStatus(userID, &projects[index])
		s.fillEcommerceListMeta(userID, &projects[index])
	}
	return projects, total, nil
}

func (s *Service) fillEcommerceListMeta(userID string, project *model.EcommerceProject) {
	if count, err := s.repo.EcommerceRoundCount(userID, project.ID); err == nil {
		project.RoundCount = count
	}
	s.fillEcommerceCoverTasks(userID, project)
}

func (s *Service) DeleteEcommerceProjects(userID string, req DeleteEcommerceProjectsRequest) (int64, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return 0, err
	}
	if req.ExpectedTotal == nil || *req.ExpectedTotal < 1 || (req.All && len(req.IDs) != 0) || (!req.All && (len(req.IDs) == 0 || len(req.IDs) > 1000)) {
		return 0, BadAuthRequest("删除项目参数无效")
	}
	if !req.All {
		if *req.ExpectedTotal != int64(len(req.IDs)) {
			return 0, BadAuthRequest("删除项目数量无效")
		}
		seen := make(map[string]bool, len(req.IDs))
		for _, id := range req.IDs {
			if id == "" || len(id) > 64 || seen[id] {
				return 0, BadAuthRequest("项目 ID 为空、重复或过长")
			}
			seen[id] = true
		}
	}
	deleted, err := s.repo.DeleteEcommerceProjects(userID, req.IDs, req.All, *req.ExpectedTotal)
	if errors.Is(err, repository.ErrEcommerceProjectSelectionChanged) {
		return 0, creationConflict("项目列表已变化，请刷新后重新确认删除")
	}
	return deleted, err
}
func (s *Service) SaveEcommerceProject(userID, id string, req SaveEcommerceProjectRequest) (*model.EcommerceProject, error) {
	if err := s.RequireFeature(FeatureEcommerce); err != nil {
		return nil, err
	}
	project, err := s.EcommerceProject(userID, id)
	if err != nil {
		return nil, err
	}
	if req.Revision != project.Revision {
		return nil, BadAuthRequest("项目已在其他窗口更新，请刷新后重试")
	}
	if req.Draft.Count < 1 || req.Draft.Count > 30 {
		return nil, BadAuthRequest("生成数量须为1到30张")
	}
	if len(req.Draft.References)+len(req.Draft.LayoutReferences) > 24 || len(req.Draft.Skus) > 30 {
		return nil, BadAuthRequest("参考图片或SKU数量超出限制")
	}
	if len(req.Draft.SkillIDs) > 8 {
		return nil, BadAuthRequest("每轮最多选择 8 个 Skills")
	}
	if err := validateEcommerceCreativeOptions(req.Draft.CreativeOptions); err != nil {
		return nil, err
	}
	if err := s.validateEcommerceReferenceDraft(userID, &req.Draft, req.Plan != nil); err != nil {
		return nil, err
	}
	if len(req.Draft.TypeOptions) > 16 {
		return nil, BadAuthRequest("创作类型参数超出限制")
	}
	for key, value := range req.Draft.TypeOptions {
		if len(key) > 80 || len(value) > 4000 {
			return nil, BadAuthRequest("创作类型参数过长")
		}
	}
	if len(strings.TrimSpace(req.Draft.ProductName)) > 160 || len(req.Draft.Instruction) > 8000 {
		return nil, BadAuthRequest("商品名称或策划要求过长")
	}
	if req.Draft.CreativeRecommendationID != "" || req.Draft.CreativeDirectionID != "" {
		selection, err := s.repo.EcommerceRecommendation(userID, req.Draft.CreativeRecommendationID)
		if err != nil || selection.SelectedDirectionID == "" || selection.SelectedDirectionID != req.Draft.CreativeDirectionID {
			return nil, BadAuthRequest("所选创意方向不存在或不属于当前用户")
		}
	}
	if req.Draft.Platform == "" || req.Draft.ImageType == "" {
		return nil, BadAuthRequest("请选择平台和图片类型")
	}
	for _, ref := range append(append([]EcommerceReference{}, req.Draft.References...), req.Draft.LayoutReferences...) {
		if !validEcommerceReferenceRole(ref.Role) {
			return nil, BadAuthRequest("参考图片用途无效")
		}
		resource, e := s.repo.ResourceForUser(userID, ref.ResourceID)
		if e != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("参考图片不存在或不可用")
		}
	}
	if req.Draft.ModelEnabled && req.Draft.PrimaryModelResourceID != "" {
		found := false
		for _, ref := range req.Draft.References {
			if ref.Role == "model" && ref.ResourceID == req.Draft.PrimaryModelResourceID {
				found = true
				break
			}
		}
		if !found {
			return nil, BadAuthRequest("主模特必须属于已添加的模特参考图")
		}
	}
	for _, sku := range req.Draft.Skus {
		if sku.Count < 0 || sku.Count > 30 {
			return nil, BadAuthRequest("SKU生成数量无效")
		}
		if sku.ResourceID != "" {
			resource, e := s.repo.ResourceForUser(userID, sku.ResourceID)
			if e != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
				return nil, BadAuthRequest("SKU参考图不存在或不可用")
			}
			linked := false
			for _, ref := range req.Draft.References {
				if ref.Role == "sku" && ref.ResourceID == sku.ResourceID {
					linked = true
					break
				}
			}
			if !linked {
				return nil, BadAuthRequest("SKU参考图须加入商品参考图列表")
			}
		}
	}
	if req.Draft.PlanningTaskID != "" {
		task, e := s.repo.TaskForUser(userID, req.Draft.PlanningTaskID)
		if e != nil || task.Type != "canvas_text" {
			return nil, BadAuthRequest("策划任务不存在或不属于当前用户")
		}
	}
	if req.Draft.DirectionsTaskID != "" {
		task, e := s.repo.TaskForUser(userID, req.Draft.DirectionsTaskID)
		var input struct {
			Metadata struct {
				ProjectID string `json:"ecommerceProjectId"`
				Stage     string `json:"stage"`
			} `json:"metadata"`
		}
		if e != nil || task.Type != "canvas_text" || json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.ProjectID != id || input.Metadata.Stage != "creative-directions" {
			return nil, BadAuthRequest("商品分析任务不存在或不属于当前项目")
		}
	}
	roundMode := req.HistoryMode == "rounds"
	if req.HistoryMode != "" && !roundMode {
		return nil, BadAuthRequest("不支持的保存历史模式")
	}
	if req.Plan != nil {
		if roundMode {
			if len(req.Plan.PreviousImages) > 0 {
				return nil, BadAuthRequest("历史轮次由服务端单独保存，请刷新页面后重试")
			}
			seen := map[string]bool{}
			for _, image := range req.Plan.Images {
				if image.ID == "" || seen[image.ID] {
					return nil, BadAuthRequest("画布图片ID重复或为空")
				}
				seen[image.ID] = true
			}
		} else {
			if len(req.Plan.Images) == 0 && len(req.Plan.PreviousImages) == 0 {
				return nil, BadAuthRequest("策划图片不能为空")
			}
			if len(req.Plan.PreviousImages)+len(req.Plan.Images) > 500 {
				return nil, BadAuthRequest("当前画布已达500张历史图片，请新建项目继续")
			}
			seen := map[string]bool{}
			for _, image := range append(append([]model.EcommercePlanTask{}, req.Plan.PreviousImages...), req.Plan.Images...) {
				if image.ID == "" || seen[image.ID] {
					return nil, BadAuthRequest("画布图片ID重复或为空")
				}
				seen[image.ID] = true
			}
			for _, image := range req.Plan.PreviousImages {
				if len(image.SourceDraft) > 128<<10 {
					return nil, BadAuthRequest("历史图片参数快照过长")
				}
				task, err := s.repo.TaskForUser(userID, image.TaskID)
				if image.TaskID == "" || err != nil || task.Type != "canvas_image" {
					return nil, BadAuthRequest("历史生成任务不存在或不属于当前用户")
				}
			}
		}
	}
	if req.Plan != nil && len(req.Plan.Images) > 0 {
		if err := s.validateEcommercePlan(userID, req.Plan); err != nil {
			return nil, err
		}
		if err := s.validateEcommerceReferencePlan(userID, req.Draft, req.Plan); err != nil {
			return nil, err
		}
		if len(req.Plan.Images) != req.Draft.Count {
			return nil, BadAuthRequest("策划图片数量与当前设置不一致，请重新策划")
		}
		if req.Draft.ImageType == "sku" {
			counts := make(map[string]int, len(req.Draft.Skus))
			for _, sku := range req.Draft.Skus {
				if sku.ID == "" || strings.TrimSpace(sku.Name) == "" {
					return nil, BadAuthRequest("SKU名称或ID不能为空")
				}
				if _, exists := counts[sku.ID]; exists {
					return nil, BadAuthRequest("SKU ID不能重复")
				}
				counts[sku.ID] = 0
			}
			for _, image := range req.Plan.Images {
				if _, exists := counts[image.SkuID]; !exists {
					return nil, BadAuthRequest("SKU策划图未关联有效SKU")
				}
				counts[image.SkuID]++
			}
			for _, sku := range req.Draft.Skus {
				if counts[sku.ID] != sku.Count {
					return nil, BadAuthRequest("SKU策划张数与商品设置不一致")
				}
			}
		}
	}
	draftJSON, err := json.Marshal(req.Draft)
	if err != nil {
		return nil, err
	}
	planJSON := []byte("{}")
	if req.Plan != nil {
		planJSON, err = json.Marshal(req.Plan)
		if err != nil {
			return nil, err
		}
	}
	project.Name = strings.TrimSpace(req.Name)
	if project.Name == "" {
		project.Name = strings.TrimSpace(req.Draft.ProductName)
	}
	if project.Name == "" {
		project.Name = "未命名商品"
	}
	if len(project.Name) > 160 {
		return nil, BadAuthRequest("项目名称过长")
	}
	project.DraftJSON = string(draftJSON)
	project.PlanJSON = string(planJSON)
	project.Status = "draft"
	if req.Draft.PlanningTaskID != "" {
		project.Status = "planning"
	} else if req.Plan != nil {
		project.Status = "awaiting_confirmation"
	}
	s.refreshEcommerceStatus(userID, project)
	if roundMode {
		err = s.repo.SaveEcommerceProjectRounds(project, req.Revision, repository.EcommerceRoundsSaveOptions{
			RoundMode:     true,
			AdvanceRound:  req.AdvanceRound,
			ActiveRoundID: req.ActiveRoundID,
		})
		if errors.Is(err, repository.ErrEcommerceRoundConflict) {
			return nil, creationConflict("项目已在其他窗口更新，请刷新后重试")
		}
		if err != nil {
			return nil, err
		}
		if count, countErr := s.repo.EcommerceRoundCount(userID, project.ID); countErr == nil {
			project.RoundCount = count
		}
		return project, nil
	}
	if err := s.repo.SaveEcommerceProject(project, req.Revision); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("项目已更新，请刷新后重试")
		}
		return nil, err
	}
	return project, nil
}

func (s *Service) refreshEcommerceStatus(userID string, project *model.EcommerceProject) {
	var draft EcommerceDraft
	if json.Unmarshal([]byte(project.DraftJSON), &draft) != nil {
		return
	}
	if draft.PlanningTaskID != "" {
		if task, err := s.repo.TaskForUser(userID, draft.PlanningTaskID); err == nil {
			switch task.Status {
			case model.TaskStatusFailed:
				project.Status = "failed"
			case model.TaskStatusCancelled:
				project.Status = "cancelled"
			default:
				project.Status = "planning"
			}
		}
		return
	}
	if draft.DirectionsTaskID != "" && draft.CreativeDirectionID == "" {
		if task, err := s.repo.TaskForUser(userID, draft.DirectionsTaskID); err == nil {
			switch task.Status {
			case model.TaskStatusFailed:
				project.Status = "failed"
			case model.TaskStatusCancelled:
				project.Status = "cancelled"
			case model.TaskStatusSucceeded:
				project.Status = "awaiting_confirmation"
			default:
				project.Status = "planning"
			}
			return
		}
	}
	var plan model.EcommercePlan
	if json.Unmarshal([]byte(project.PlanJSON), &plan) != nil || len(plan.Images) == 0 {
		project.Status = "draft"
		return
	}
	queued, running, succeeded, failed, cancelled := 0, 0, 0, 0, 0
	for _, image := range plan.Images {
		if image.TaskID == "" {
			continue
		}
		task, err := s.repo.TaskForUser(userID, image.TaskID)
		if err != nil {
			continue
		}
		switch task.Status {
		case model.TaskStatusSucceeded:
			succeeded++
		case model.TaskStatusFailed:
			failed++
		case model.TaskStatusCancelled:
			cancelled++
		case model.TaskStatusRunning:
			running++
		default:
			queued++
		}
	}
	switch {
	case succeeded == len(plan.Images):
		project.Status = "completed"
	case running > 0:
		project.Status = "running"
	case queued > 0:
		project.Status = "queued"
	case succeeded > 0 && failed+cancelled > 0:
		project.Status = "partial_success"
	case failed > 0:
		project.Status = "failed"
	case cancelled > 0:
		project.Status = "cancelled"
	default:
		project.Status = "awaiting_confirmation"
	}
}

func validEcommerceReferenceRole(role string) bool {
	switch role {
	case "primary", "detail", "sku", "style", "logo", "package", "competitor", "model":
		return true
	}
	return false
}

func (s *Service) validateEcommercePlan(userID string, plan *model.EcommercePlan) error {
	if len(plan.InputSignature) > 128000 {
		return BadAuthRequest("策划参数快照过长")
	}
	if len(plan.Images) < 1 || len(plan.Images) > 30 {
		return BadAuthRequest("策划图片数量须为1到30张")
	}
	if strings.TrimSpace(plan.ProductSummary) == "" || strings.TrimSpace(plan.VisualStrategy) == "" {
		return BadAuthRequest("策划缺少商品分析或视觉策略")
	}
	seen := make(map[string]bool, len(plan.Images))
	seenTasks := make(map[string]bool, len(plan.Images))
	for index, image := range plan.Images {
		if image.ID == "" || seen[image.ID] {
			return BadAuthRequest(fmt.Sprintf("第%d张图片的策划ID无效", index+1))
		}
		seen[image.ID] = true
		if image.ImageType == "" || image.Platform == "" || image.Language == "" || image.Goal == "" || image.Theme == "" || image.Composition == "" || image.MainVisual == "" || image.Fidelity == "" || image.Prompt == "" || image.ImageModel == "" || image.Ratio == "" || image.Resolution == "" {
			return BadAuthRequest(fmt.Sprintf("第%d张图片的策划字段不完整", index+1))
		}
		if len(image.Prompt) > 32000 {
			return BadAuthRequest("图片提示词过长")
		}
		if image.TaskID == "" {
			if ecommerceagent.PlatformNoText(image.Platform, image.ImageType, "") && strings.TrimSpace(image.Copy) != "" {
				return BadAuthRequest(fmt.Sprintf("第%d张按所选平台采用无新增文字方案，请清空文案后再生成", index+1))
			}
			if phrase := ecommerceagent.RestrictedListingPhrase(image.Copy); phrase != "" {
				return BadAuthRequest(fmt.Sprintf("第%d张文案含高风险宣传词「%s」，请改为有依据的具体描述", index+1, phrase))
			}
		}
		if image.TaskID != "" {
			if seenTasks[image.TaskID] {
				return BadAuthRequest("同一生成任务不能绑定多张策划图")
			}
			seenTasks[image.TaskID] = true
			task, err := s.repo.TaskForUser(userID, image.TaskID)
			if err != nil || task.Type != "canvas_image" {
				return BadAuthRequest("生成任务不存在或不属于当前用户")
			}
		}
	}
	return nil
}
