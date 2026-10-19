package app

import (
	"context"
	"encoding/json"
	"errors"
	"image"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const generatedBrowserGrace = 45 * time.Second

var generatedTransferSlots = make(chan struct{}, 2)

func (s *Service) prepareGeneratedImageResult(ctx context.Context, task *model.Task, result map[string]any) (map[string]any, error) {
	if task.MediaRecoveryJSON != "" || result["mode"] != "image" {
		return result, nil
	}
	images := creationMaps(result["images"])
	if typed, ok := result["images"].([]map[string]string); ok {
		for _, item := range typed {
			copy := map[string]any{}
			for key, value := range item {
				copy[key] = value
			}
			images = append(images, copy)
		}
	}
	references := make([]protocol.MediaReference, 0, len(images))
	hasURL := false
	for _, image := range images {
		if stringValue(image["storageKey"]) != "" {
			return result, nil
		}
		address := firstNonEmpty(stringValue(image["url"]), stringValue(image["dataUrl"]))
		reference := protocol.MediaReference{MIMEType: stringValue(image["mimeType"])}
		if strings.HasPrefix(address, "https://") || strings.HasPrefix(address, "http://") {
			reference.URL, hasURL = address, true
		} else {
			reference.DataURL = address
		}
		references = append(references, reference)
	}
	if !hasURL {
		return result, nil
	}
	ctx = context.WithValue(withProviderAnalytics(ctx, s, *task), mediaExecutionTaskKey{}, *task)
	prepared, _, err := recoverProtocolMedia(ctx, providerConfig{}, "image", references)
	return prepared, err
}

// The resource identity is immediately usable; the encrypted transfer outbox owns persistence.
func (s *Service) registerGeneratedURL(task *model.Task, index int, reference protocol.MediaReference) (*model.Resource, error) {
	if _, err := ValidateOutboundURL(reference.URL); err != nil {
		return nil, err
	}
	if existing, err := s.resourceForUploadKey(task.UserID, mediaUploadKey(task.ID, index)); err != nil || existing != nil {
		return existing, err
	}
	setting, settingID, oss, err := s.activeResourceOSSSetting(task.UserID)
	if err != nil {
		return nil, err
	}
	source, err := s.encryptSettingSecret(reference.URL)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	mimeType := reference.MIMEType
	if !strings.HasPrefix(mimeType, "image/") {
		mimeType = "image/png"
	}
	resource := &model.Resource{ID: newID(), UserID: task.UserID, Kind: "image", Status: model.ResourceStatusReady,
		Provider: "local", MimeType: mimeType, ObjectKey: localObjectKey(task.UserID, "image", "generated", mimeType, now),
		UploadKey: mediaUploadKey(task.ID, index), SourceTaskID: task.ID, TransferPending: true, CreatedAt: now, UpdatedAt: now}
	if oss {
		resource.Provider, resource.Endpoint, resource.Bucket, resource.StorageSettingID = setting.Provider, setting.Endpoint, setting.Bucket, settingID
		resource.ObjectKey = ossObjectKey(setting, task.UserID, "image", "generated", mimeType, now)
	}
	transfer := &model.ResourceTransfer{ResourceID: resource.ID, UserID: task.UserID, SourceURL: source,
		NextAttemptAt: now.Add(generatedBrowserGrace), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateResourceTransfer(resource, transfer); err != nil {
		if existing, lookupErr := s.resourceForUploadKey(task.UserID, resource.UploadKey); lookupErr == nil && existing != nil {
			return existing, nil
		}
		return nil, err
	}
	return resource, nil
}

func (s *Service) generatedResourceSource(resource *model.Resource) (string, error) {
	if !resource.TransferPending || resource.Status != model.ResourceStatusReady || resource.SourceTaskID == "" {
		return "", BadAuthRequest("资源没有待保存的生成结果")
	}
	transfer, err := s.repo.ResourceTransfer(resource.UserID, resource.ID)
	if err != nil {
		return "", err
	}
	source, err := s.decryptSettingSecret(transfer.SourceURL)
	if err != nil {
		return "", err
	}
	if _, err := ValidateOutboundURL(source); err != nil {
		return "", err
	}
	return source, nil
}

func (s *Service) generatedResourceAccess(resource *model.Resource, options ResourceAccessOptions) (*ResourceAccess, error) {
	options, err := assets.NormalizeAccessOptions(options, true)
	if err != nil {
		return nil, err
	}
	source, err := s.generatedResourceSource(resource)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	expires := now.Add(30 * time.Second)
	if !options.ExpiresAt.IsZero() && options.ExpiresAt.Before(expires) {
		expires = options.ExpiresAt
	}
	if !expires.After(now) {
		return nil, Forbidden("资源授权已过期")
	}
	refresh := now.Add(min(5*time.Second, expires.Sub(now)*4/5))
	return &ResourceAccess{ResourceID: resource.ID, RequestedVariant: options.Variant, ActualVariant: assets.VariantOriginal,
		URL: source, Delivery: assets.DeliveryUpstream, IssuedAt: now, ExpiresAt: &expires, RefreshAt: refresh,
		Revision: "upstream:" + resource.ID, FallbackReason: "upstream_pending_save"}, nil
}

func (s *Service) startResourceTransferWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			s.drainResourceTransfers(ctx, 2)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) drainResourceTransfers(ctx context.Context, limit int) {
	transfers, err := s.repo.DueResourceTransfers(limit)
	if err != nil {
		return
	}
	for _, transfer := range transfers {
		if ctx.Err() != nil || s.IsDraining() {
			return
		}
		select {
		case generatedTransferSlots <- struct{}{}:
		default:
			return
		}
		owner := "server:" + newID()
		claimed, err := s.repo.ClaimResourceTransfer(transfer.UserID, transfer.ResourceID, owner, time.Now().Add(8*time.Minute), "")
		if err != nil || !claimed {
			<-generatedTransferSlots
			continue
		}
		started := s.runWorkerTask(func() {
			defer func() { <-generatedTransferSlots }()
			var abandoned generatedBrowserUpload
			if json.Unmarshal([]byte(transfer.UploadJSON), &abandoned) == nil && abandoned.UploadID != "" {
				_ = s.ReleaseChunkUploadSession(transfer.UserID, abandoned.UploadID)
			}
			if err := s.saveGeneratedResourceFallback(ctx, transfer.UserID, transfer.ResourceID, owner); err != nil {
				// Do not persist network errors containing temporary URL credentials.
				delay := min(time.Minute*time.Duration(1<<min(transfer.Attempts, 6)), time.Hour)
				_ = s.repo.RetryResourceTransfer(transfer.ResourceID, owner, "后台保存未完成，等待重试", time.Now().Add(delay))
			}
		})
		if !started {
			<-generatedTransferSlots
			_ = s.repo.RetryResourceTransfer(transfer.ResourceID, owner, "等待后台保存", time.Now())
			return
		}
	}
}

func (s *Service) saveGeneratedResourceFallback(ctx context.Context, userID, id, owner string) error {
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) || (!resourceIsPendingTransfer(resource) && err == nil) {
		return s.repo.RemoveResourceTransfer(id, owner)
	}
	if err != nil {
		return err
	}
	source, err := s.generatedResourceSource(resource)
	if err != nil {
		return err
	}
	task, err := s.repo.TaskForUser(userID, resource.SourceTaskID)
	if err != nil {
		return err
	}
	inputJSON, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(inputJSON), &input); err != nil {
		return err
	}
	config := input.Config
	if resolved, resolveErr := s.resolveProviderConfig(config); resolveErr == nil {
		config = resolved
	}
	tempName, mimeType, err := s.downloadTaskMedia(withProviderAnalytics(ctx, s, *task), config, source, "image")
	if err != nil {
		return err
	}
	path := s.mediaTempPath(tempName)
	defer os.Remove(path)
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	configImage, _, err := image.DecodeConfig(file)
	if err != nil || configImage.Width <= 0 || configImage.Height <= 0 {
		return errors.New("生成图片尺寸无效")
	}
	width, height := configImage.Width, configImage.Height
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	day, err := s.reserveGeneratedResourceQuota(userID, info.Size())
	if err != nil {
		return err
	}
	saved := false
	defer func() {
		if saved {
			s.commitUserUploadQuota(userID, info.Size())
		} else {
			s.releaseUserUploadQuota(userID, day, info.Size())
		}
	}()
	resource.ObjectKey += "." + strings.ReplaceAll(owner, ":", "-")
	if err := s.repo.TrackResourceTransferObject(resource, owner, time.Now().Add(25*time.Minute)); err != nil {
		return err
	}
	resource.MimeType, resource.Size, resource.Width, resource.Height = mimeType, info.Size(), width, height
	resource.ETag, err = s.storeTaskMediaObject(resource, "generated", file)
	if err != nil {
		return err
	}
	policy, err := s.RuntimePolicy()
	if err == nil {
		err = s.repo.PublishResourceTransfer(resource, owner, "", gigabytes(policy.Resource.StoredFileGB), megabytes(policy.Resource.DailyUploadMB))
	}
	if err != nil {
		_ = s.deleteResourceObjectAtKey(userID, resource)
		return err
	}
	saved = true
	return nil
}

func resourceIsPendingTransfer(resource *model.Resource) bool {
	return resource != nil && resource.TransferPending && resource.Status == model.ResourceStatusReady
}

func (s *Service) openGeneratedResource(resource *model.Resource) (*ResourceStream, error) {
	source, err := s.generatedResourceSource(resource)
	if err != nil {
		return nil, err
	}
	body, err := openRemoteResource(source)
	if err != nil {
		return nil, err
	}
	return &ResourceStream{Resource: resource, Body: body, StatusCode: http.StatusOK, ContentLength: -1}, nil
}
