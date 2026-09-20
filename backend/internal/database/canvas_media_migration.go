package database

import (
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func migrateCanvasMediaGrants(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CanvasMediaGrant{}); err != nil {
		return err
	}
	var projects []model.CanvasProject
	if err := tx.Order("created_at, id").Find(&projects).Error; err != nil {
		return err
	}
	byID := make(map[string]model.CanvasProject, len(projects))
	for _, project := range projects {
		byID[project.ID] = project
		if err := backfillCanvasMediaGrants(tx, project, ""); err != nil {
			return err
		}
	}
	// Branch creation records an authorized content copy. Propagate only grants
	// already established for its source, intersected with its own documents.
	var branches []model.CanvasBranch
	if err := tx.Order("created_at, id").Find(&branches).Error; err != nil {
		return err
	}
	for _, branch := range branches {
		if project, exists := byID[branch.BranchCanvasID]; exists {
			if err := backfillCanvasMediaGrants(tx, project, branch.SourceCanvasID); err != nil {
				return err
			}
		}
	}
	return nil
}

func backfillCanvasMediaGrants(tx *gorm.DB, project model.CanvasProject, sourceID string) error {
	var history []model.CanvasSnapshot
	if err := tx.Where("canvas_id = ?", project.ID).Find(&history).Error; err != nil {
		return err
	}
	documents := make([]string, 0, len(history)+1)
	for _, snapshot := range history {
		documents = append(documents, snapshot.PayloadJSON)
	}
	documents = append(documents, project.PayloadJSON)
	refs := map[string]bool{}
	allResources, allAssets := map[string]struct{}{}, map[string]struct{}{}
	for index, raw := range documents {
		resourceIDs := map[string]struct{}{}
		if err := assets.CollectOwnedDocumentReferences(raw, resourceIDs); err != nil {
			return err
		}
		assetIDs, err := assets.DocumentAssetIDs(raw)
		if err != nil {
			return err
		}
		if len(assetIDs) > 0 {
			var records []model.Asset
			if err := tx.Where("id IN ?", assets.SortedIDs(assetIDs)).Find(&records).Error; err != nil {
				return err
			}
			for _, record := range records {
				if err := assets.CollectOwnedDocumentReferences(record.PayloadJSON, resourceIDs); err != nil {
					return err
				}
			}
		}
		current := index == len(documents)-1
		for id := range resourceIDs {
			allResources[id] = struct{}{}
			key := model.CanvasMediaResource + ":" + id
			refs[key] = refs[key] || current
		}
		for id := range assetIDs {
			allAssets[id] = struct{}{}
			key := model.CanvasMediaAsset + ":" + id
			refs[key] = refs[key] || current
		}
	}
	if len(refs) == 0 {
		return nil
	}
	var candidates []model.CanvasMediaGrant
	if sourceID != "" {
		if err := tx.Where("canvas_id = ?", sourceID).Find(&candidates).Error; err != nil {
			return err
		}
	} else {
		var resources []model.Resource
		if err := tx.Select("id").Where("user_id = ? AND status = ? AND id IN ?", project.UserID, model.ResourceStatusReady, assets.SortedIDs(allResources)).Find(&resources).Error; err != nil {
			return err
		}
		for _, resource := range resources {
			candidates = append(candidates, model.CanvasMediaGrant{Kind: model.CanvasMediaResource, ObjectID: resource.ID})
		}
		var records []model.Asset
		if err := tx.Select("id").Where("user_id = ? AND id IN ?", project.UserID, assets.SortedIDs(allAssets)).Find(&records).Error; err != nil {
			return err
		}
		for _, record := range records {
			candidates = append(candidates, model.CanvasMediaGrant{Kind: model.CanvasMediaAsset, ObjectID: record.ID})
		}
	}
	grants := make([]model.CanvasMediaGrant, 0)
	for _, candidate := range candidates {
		if current, exists := refs[candidate.Kind+":"+candidate.ObjectID]; exists {
			grants = append(grants, model.CanvasMediaGrant{CanvasID: project.ID, Kind: candidate.Kind, ObjectID: candidate.ObjectID, Current: current, GrantedBy: project.UserID, CreatedAt: time.Now().UTC()})
		}
	}
	if len(grants) == 0 {
		return nil
	}
	return tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(grants, 200).Error
}
