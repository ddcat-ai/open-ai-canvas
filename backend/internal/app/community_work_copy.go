package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) CopyCommunityWork(ctx context.Context, actor *model.User, id string) (*CommunityWorkProject, error) {
	if err := communityActor(actor); err != nil {
		return nil, err
	}
	if err := s.RequireStorageWritable(actor.ID); err != nil {
		return nil, err
	}
	work, err := s.accessibleCommunityWork(nil, id, true)
	if err != nil {
		return nil, err
	}
	if work.ProjectID == "" {
		return nil, kernel.NotFound("该作品未公开制作画布")
	}
	var project map[string]any
	if err = json.Unmarshal([]byte(work.SnapshotJSON), &project); err != nil {
		return nil, kernel.NewAppError(500, "作品制作快照无法读取")
	}
	refs := map[string]string{}
	rewriteCommunitySnapshot(project, func(resourceID string) string {
		refs[resourceID] = resourceID
		return "resource:" + resourceID
	})
	ids := make([]string, 0, len(refs))
	for resourceID := range refs {
		ids = append(ids, resourceID)
	}
	sort.Strings(ids)
	for _, resourceID := range ids {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if _, err := s.accessibleCommunityWork(nil, id, true); err != nil {
			return nil, err
		}
		resource, err := s.repo.CommunityWorkResource(work.ID, resourceID)
		if errors.Is(err, gorm.ErrRecordNotFound) || (err == nil && (resource.UserID != work.UserID || resource.Status != model.ResourceStatusReady || resource.Size <= 0)) {
			return nil, kernel.NewAppError(409, "制作素材已失效，请刷新作品后重试")
		}
		if err != nil {
			return nil, err
		}
		if actor.ID == work.UserID {
			continue
		}
		copied, err := s.copyCommunityResource(ctx, actor.ID, work.ID, resource)
		if err != nil {
			return nil, err
		}
		refs[resourceID] = copied.ID
	}
	project = rewriteCommunitySnapshot(project, func(resourceID string) string { return "resource:" + refs[resourceID] }).(map[string]any)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	project["id"], project["title"], project["revision"] = kernel.NewID(), work.Title, int64(0)
	project["createdAt"], project["updatedAt"] = now, now
	delete(project, "projectId")
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	quotaCheck := func(repo *repository.Repository, kind string, creating bool, deltaBytes int64) error {
		usage, err := repo.UserStructuredStorageUsage(actor.ID)
		if err != nil {
			return err
		}
		return validateStructuredStorageQuotaWithPolicy(usage, kind, creating, deltaBytes, policy.Resource)
	}
	createdAssets := 0
	// Lock the publication through the canvas commit so a withdrawal or replacement
	// cannot race the final save. Resource copying stays outside the transaction.
	err = s.repo.Transaction(func(repo *repository.Repository) error {
		latest, err := repo.CommunityWork(work.ID, true)
		if err != nil {
			return err
		}
		if latest.Status != model.CommunityWorkPublished || latest.Revision != work.Revision {
			return kernel.NewAppError(409, "作品已更新或撤回，请刷新后重试")
		}
		if err := validateCommunityPublication(repo, latest); err != nil {
			return err
		}
		current, err := repo.User(actor.ID)
		if err != nil {
			return err
		}
		if err := communityActor(current); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		domain := canvas.New(repo, communityCopyCanvasHost{canvasHost: canvasHost{svc: s}, repo: repo, quotaCheck: quotaCheck})
		createdAssets, err = ensureCommunityCanvasAssets(repo, domain, actor.ID, work.ID, project)
		if err != nil {
			return err
		}
		data, err := json.Marshal(project)
		if err != nil {
			return err
		}
		if _, err := domain.UpsertUserCanvasProject(actor.ID, data); err != nil {
			return err
		}
		saved, err := domain.UserCanvasProject(actor.ID, project["id"].(string))
		if err != nil {
			return err
		}
		return json.Unmarshal(saved, &project)
	})
	if err != nil {
		return nil, err
	}
	s.recordActivity(actor.ID, "canvas", 1)
	if createdAssets > 0 {
		s.recordActivity(actor.ID, "asset", createdAssets)
	}
	return &CommunityWorkProject{Project: project}, nil
}

type communityCopyCanvasHost struct {
	canvasHost
	repo       *repository.Repository
	quotaCheck func(*repository.Repository, string, bool, int64) error
}

func (h communityCopyCanvasHost) StructuredQuota(_ string, kind string, creating bool, deltaBytes int64) error {
	return h.quotaCheck(h.repo, kind, creating, deltaBytes)
}

// The activity is recorded only after the enclosing publication transaction commits.
func (h communityCopyCanvasHost) RecordActivity(string, string, int) {}

func ensureCommunityCanvasAssets(repo *repository.Repository, domain *canvas.Service, userID, workID string, project map[string]any) (int, error) {
	created := 0
	nodes, _ := project["nodes"].([]any)
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		kind := kernel.StringValue(node["type"])
		if kind != "image" && kind != "video" && kind != "audio" {
			continue
		}
		metadata, _ := node["metadata"].(map[string]any)
		resourceID := assets.ResourceID(kernel.StringValue(metadata["content"]))
		if resourceID == "" {
			continue
		}
		resource, err := repo.ResourceForUser(userID, resourceID)
		if err != nil {
			return 0, err
		}
		if resource.Status != model.ResourceStatusReady || resource.Kind != kind {
			return 0, kernel.NewAppError(409, "制作素材类型已变化，请刷新作品后重试")
		}
		digest := sha256.Sum256([]byte(userID + ":" + workID + ":" + resourceID))
		assetID := fmt.Sprintf("community-%x", digest[:16])
		existing, err := repo.AssetForUser(userID, assetID)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, err
		}
		if existing != nil {
			refs := assets.DocumentReferencedIDs(existing.PayloadJSON, map[string]struct{}{resourceID: {}})
			if _, matches := refs[resourceID]; !matches {
				assetID, existing = kernel.NewID(), nil
			}
		}
		if existing == nil {
			locator := assets.FileURL(resource.ID)
			data := map[string]any{"storageKey": "resource:" + resource.ID, "width": resource.Width, "height": resource.Height, "bytes": resource.Size, "mimeType": resource.MimeType, "durationMs": resource.DurationMs}
			cover := ""
			if kind == "image" {
				data["dataUrl"], cover = locator, locator
			} else {
				data["url"] = locator
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			payload, err := json.Marshal(map[string]any{"id": assetID, "kind": kind, "title": kernel.DefaultString(kernel.StringValue(node["title"]), kernel.StringValue(project["title"])), "coverUrl": cover, "tags": []string{}, "data": data, "createdAt": now, "updatedAt": now})
			if err != nil {
				return 0, err
			}
			if _, err := domain.UpsertUserAsset(userID, payload); err != nil {
				return 0, err
			}
			created++
		}
		metadata["assetId"], metadata["storageKey"] = assetID, "resource:"+resourceID
	}
	return created, nil
}

func (s *Service) copyCommunityResource(ctx context.Context, userID, workID string, source *model.Resource) (*model.Resource, error) {
	identity := "community-work:" + workID + ":" + source.ID
	key := normalizedResourceUploadKey([]string{identity})
	existing, err := s.resourceForUploadKey(userID, key)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	_, body, err := s.OpenResource(source.UserID, source.ID)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	dir := filepath.Join(s.dataDir, "tmp", "community-copy")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	file, err := os.CreateTemp(dir, "media-*")
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
	written, err := io.Copy(file, io.LimitReader(communityCopyReader{ctx: ctx, reader: body}, source.Size+1))
	if err != nil {
		return nil, err
	}
	if written != source.Size {
		return nil, kernel.NewAppError(409, "制作素材大小已变化，请刷新作品后重试")
	}
	name := fmt.Sprintf("community-%s%s", source.ID, filepath.Ext(source.ObjectKey))
	return s.UploadResourceFile(userID, name, written, source.Kind, source.Width, source.Height, source.DurationMs, file, identity)
}

type communityCopyReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r communityCopyReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
