package canvas

import (
	"encoding/json"
	"errors"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type CanvasResourceRepairIssue struct {
	CanvasID   string                             `json:"canvasId"`
	References []assets.DocumentResourceReference `json:"missingResources"`
	Repaired   bool                               `json:"repaired"`
	Reason     string                             `json:"reason,omitempty"`
}

type CanvasResourceRepairReport struct {
	Apply      bool                        `json:"apply"`
	Scanned    int                         `json:"scanned"`
	Repairable int                         `json:"repairable"`
	Repaired   int                         `json:"repaired"`
	Unresolved int                         `json:"unresolved"`
	Issues     []CanvasResourceRepairIssue `json:"issues"`
}

// RepairCanvasResources is an explicit maintenance operation. It only removes
// invalid derived video previews, never original media, and retains the preimage.
// Each canvas commits independently with the normal ownership/revision checks.
func RepairCanvasResources(db *gorm.DB, apply bool) (CanvasResourceRepairReport, error) {
	report := CanvasResourceRepairReport{Apply: apply, Issues: []CanvasResourceRepairIssue{}}
	db = db.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
	repo := repository.New(db)
	svc := New(repo, nil)
	after := ""
	for {
		var rows []model.CanvasProject
		if err := db.Where("id > ?", after).Order("id ASC").Limit(100).Find(&rows).Error; err != nil {
			return report, errors.New("读取画布失败；此前已提交的修复保留，请按报告重试")
		}
		if len(rows) == 0 {
			return report, nil
		}
		for _, project := range rows {
			after = project.ID
			report.Scanned++
			issue := CanvasResourceRepairIssue{CanvasID: project.ID}
			raw, err := canvasProjectPayload(project)
			if err != nil {
				issue.Reason = "画布 JSON 无效，需人工核查"
				report.Issues = append(report.Issues, issue)
				report.Unresolved++
				continue
			}
			refs, err := assets.CollectDocumentResourceReferences(string(raw))
			if err != nil {
				return report, errors.New("收集资源引用失败")
			}
			ids := map[string]struct{}{}
			for _, ref := range refs {
				ids[ref.ResourceID] = struct{}{}
			}
			resources, err := repo.ResourcesForUserIDs(project.UserID, assets.SortedIDs(ids))
			if err != nil {
				return report, errors.New("读取资源状态失败；未把查询失败视为缺失")
			}
			for _, resource := range resources {
				if resource.Status == model.ResourceStatusReady {
					delete(ids, resource.ID)
				}
			}
			if len(ids) == 0 {
				continue
			}
			for _, ref := range refs {
				if _, missing := ids[ref.ResourceID]; missing {
					ref.Source = "current"
					issue.References = append(issue.References, ref)
				}
			}
			var payload map[string]json.RawMessage
			var nodes []map[string]json.RawMessage
			if json.Unmarshal(raw, &payload) != nil || json.Unmarshal(payload["nodes"], &nodes) != nil {
				issue.Reason = "节点数据无效，需人工核查"
			} else {
				for _, node := range nodes {
					var metadata map[string]json.RawMessage
					if json.Unmarshal(node["metadata"], &metadata) != nil || metadata["videoPreview"] == nil {
						continue
					}
					previewRefs, parseErr := assets.CollectDocumentResourceReferences(string(metadata["videoPreview"]))
					if parseErr != nil {
						continue
					}
					for _, ref := range previewRefs {
						if _, missing := ids[ref.ResourceID]; missing {
							delete(metadata, "videoPreview")
							node["metadata"], _ = json.Marshal(metadata)
							break
						}
					}
				}
				payload["nodes"], _ = json.Marshal(nodes)
				repaired, marshalErr := json.Marshal(payload)
				if marshalErr != nil {
					return report, marshalErr
				}
				if err := svc.ValidateCanvasMediaAssets(project.UserID, repaired); err != nil {
					issue.Reason = "仍有主媒体缺失或素材绑定错误；未修改画布，请恢复有效历史或重新上传"
				} else {
					report.Repairable++
					if apply {
						if _, err := svc.RepairUserCanvasProject(project.UserID, repaired); err != nil {
							issue.Reason = "修复保存失败（版本冲突或资源再次变化）；未覆盖，请重新扫描"
						} else {
							issue.Repaired = true
							report.Repaired++
						}
					}
				}
			}
			if issue.Reason != "" {
				report.Unresolved++
			}
			report.Issues = append(report.Issues, issue)
		}
	}
}
