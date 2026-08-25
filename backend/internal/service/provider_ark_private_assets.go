package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"github.com/volcengine/volc-sdk-golang/base"
	"gorm.io/gorm"
)

const (
	arkPrivateAssetAPIVersion = "2024-01-01"
	arkPrivateAssetGroupType  = "AIGC"
	arkPrivateAssetStatusNew  = "creating"
	arkPrivateAssetStatusWait = "processing"
	arkPrivateAssetStatusLive = "active"
	arkPrivateAssetStatusFail = "failed"
	arkPrivateAssetPollLimit  = 3 * time.Minute
)

// Tests can inject a local control-plane server. Production derives the Ark
// control-plane address from the administrator's explicit Region setting.
var arkPrivateAssetAPIBaseURLOverride string

type taskExecutionIDContextKey struct{}

func withTaskExecutionID(ctx context.Context, taskID string) context.Context {
	return context.WithValue(ctx, taskExecutionIDContextKey{}, strings.TrimSpace(taskID))
}

func taskExecutionID(ctx context.Context) string {
	id, _ := ctx.Value(taskExecutionIDContextKey{}).(string)
	return strings.TrimSpace(id)
}

func withoutProviderAnalytics(ctx context.Context) context.Context {
	return context.WithValue(ctx, providerAnalyticsKey{}, providerAnalyticsContext{})
}

func (s *Service) prepareArkPrivateAssetReferences(ctx context.Context, userID string, input *canvasGenerationInput) error {
	if input == nil || !isArkPrivateAssetVideoConfig(input.Config) || !parseBool(input.Config.ArkPrivateAssetUpload, true) {
		return nil
	}
	hasOwnedReference := false
	for _, reference := range input.ReferenceImages {
		if arkPrivateAssetResourceID(reference) != "" {
			hasOwnedReference = true
			break
		}
	}
	if !hasOwnedReference {
		return nil
	}
	settingRecord, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return err
	}
	automaticSyncEnabled, err := arkPrivateAssetAutomaticSyncEnabled(setting)
	if err != nil {
		return err
	}
	if !automaticSyncEnabled {
		return nil
	}
	if taskID := taskExecutionID(ctx); taskID != "" {
		_ = s.repo.UpdateTaskProgress(taskID, "同步方舟可信素材", 36)
	}
	for index := range input.ReferenceImages {
		reference := &input.ReferenceImages[index]
		if strings.HasPrefix(strings.TrimSpace(reference.URL), "asset://") {
			continue
		}
		resourceID := arkPrivateAssetResourceID(*reference)
		if resourceID == "" {
			continue
		}
		resource, err := s.Resource(userID, resourceID)
		if err != nil {
			return fmt.Errorf("读取方舟参考素材失败：%w", err)
		}
		if resource.Status != model.ResourceStatusReady {
			return errors.New("方舟参考素材尚未上传完成")
		}
		if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(resource.MimeType)), "image/") {
			return errors.New("方舟可信素材库当前只支持上传图片参考素材")
		}
		assetID, err := s.ensureArkPrivateAsset(ctx, userID, resource, settingRecord, &setting)
		if err != nil {
			return err
		}
		reference.URL = "asset://" + assetID
		reference.DataURL = ""
	}
	if taskID := taskExecutionID(ctx); taskID != "" {
		_ = s.repo.UpdateTaskProgress(taskID, "调用生成模型", 40)
	}
	return nil
}

func isArkPrivateAssetVideoConfig(config providerConfig) bool {
	return config.InterfaceType == string(model.ChannelInterfaceVolcengineArkVideo) || isArkPlanVideoConfig(config)
}

func arkPrivateAssetAutomaticSyncEnabled(setting arkPrivateAssetSettingValue) (bool, error) {
	// 可信素材同步是可选增强能力。管理员未启用时保持原始参考 URL，
	// 继续执行常规火山方舟视频请求。
	if !setting.Enabled {
		return false, nil
	}
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return false, errors.New("方舟可信素材库尚未配置，请由管理员在方舟素材库设置中填写启用的 IAM AK/SK")
	}
	return true, nil
}

func arkPrivateAssetResourceID(reference providerMedia) string {
	if !strings.HasPrefix(reference.StorageKey, "resource:") {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(reference.StorageKey, "resource:"))
}

type ArkPrivateAssetSyncResult struct {
	ResourceID string `json:"resourceId"`
	Status     string `json:"status"`
}

// SyncResourceToArkPrivateAsset is the explicit user action for preloading a
// reference image. It keeps the same team-scoped ownership and review rules as
// the task worker, so clients cannot submit arbitrary URLs to Ark.
func (s *Service) SyncResourceToArkPrivateAsset(ctx context.Context, actor *model.User, resourceID string) (*ArkPrivateAssetSyncResult, error) {
	resourceID = strings.TrimSpace(resourceID)
	if resourceID == "" {
		return nil, BadAuthRequest("请选择要同步的图片素材")
	}
	resource, err := s.Resource(actor.ID, resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("图片素材不存在或无权访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("图片素材尚未上传完成")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(resource.MimeType)), "image/") {
		return nil, BadAuthRequest("方舟可信素材库当前只支持上传图片素材")
	}
	settingRecord, setting, err := s.readArkPrivateAssetSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return nil, BadAuthRequest("方舟可信素材库尚未配置，请由管理员在方舟素材库设置中填写启用的 IAM AK/SK")
	}
	if _, err := s.ensureArkPrivateAsset(ctx, actor.ID, resource, settingRecord, &setting); err != nil {
		return nil, err
	}
	return &ArkPrivateAssetSyncResult{ResourceID: resource.ID, Status: arkPrivateAssetStatusLive}, nil
}

func (s *Service) ensureArkPrivateAsset(ctx context.Context, userID string, resource *model.Resource, settingRecord *model.SystemSetting, setting *arkPrivateAssetSettingValue) (string, error) {
	binding, err := s.repo.ArkPrivateAssetBinding(resource.ID, setting.ProjectName)
	if err == nil {
		if shouldResumeArkPrivateAssetPolling(binding) {
			// 素材已创建成功，只是旧版 GetAsset 参数错误导致轮询失败；恢复轮询，
			// 不重新上传素材，也不会创建重复的方舟资产。
			binding.Status = arkPrivateAssetStatusWait
			binding.Error = ""
			if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
				return "", err
			}
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
		if !shouldRetryArkPrivateAssetBinding(binding) {
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
		// 早期字段解析未识别方舟返回的 Id。仅重试尚未创建素材或素材组的记录，
		// 审核拒绝等真实业务失败仍保持终态，避免重复上传。
		binding.Status = arkPrivateAssetStatusNew
		binding.Error = ""
		if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
			return "", err
		}
	}
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", err
		}
		binding = &model.ArkPrivateAssetBinding{
			ID:          newID(),
			UserID:      userID,
			ResourceID:  resource.ID,
			ProjectName: setting.ProjectName,
			Status:      arkPrivateAssetStatusNew,
		}
		created, err := s.repo.CreateArkPrivateAssetBinding(binding)
		if err != nil {
			return "", err
		}
		if !created {
			binding, err = s.repo.ArkPrivateAssetBinding(resource.ID, setting.ProjectName)
			if err != nil {
				return "", err
			}
			return s.waitForArkPrivateAsset(ctx, binding, setting)
		}
	}

	groupID, err := s.ensureArkPrivateAssetGroup(ctx, settingRecord, setting)
	if err != nil {
		return "", s.failArkPrivateAssetBinding(binding, err)
	}
	binding.AssetGroupID = groupID
	resourceURL, err := s.directResourceURL(resource, time.Now().Add(time.Hour))
	if err != nil {
		return "", s.failArkPrivateAssetBinding(binding, fmt.Errorf("生成方舟素材临时地址失败：%w", err))
	}
	response, err := callArkPrivateAssetAPI(ctx, *setting, "CreateAsset", map[string]interface{}{
		"GroupId":     groupID,
		"URL":         resourceURL,
		"AssetType":   "Image",
		"Name":        "ark-private-asset-" + resource.ID,
		"ProjectName": setting.ProjectName,
	})
	if err != nil {
		return "", s.failArkPrivateAssetBinding(binding, fmt.Errorf("上传方舟可信素材失败：%w", err))
	}
	assetID := arkPrivateAssetResponseField(response, "AssetId", "AssetID", "asset_id", "Id", "ID", "id")
	if assetID == "" {
		return "", s.failArkPrivateAssetBinding(binding, errors.New("方舟素材库没有返回素材 ID"))
	}
	binding.ArkAssetID = assetID
	binding.Status = arkPrivateAssetStatusWait
	binding.Error = ""
	if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
		return "", err
	}
	return s.waitForArkPrivateAsset(ctx, binding, setting)
}

func (s *Service) ensureArkPrivateAssetGroup(ctx context.Context, settingRecord *model.SystemSetting, setting *arkPrivateAssetSettingValue) (string, error) {
	if strings.TrimSpace(setting.DefaultGroupID) != "" {
		return setting.DefaultGroupID, nil
	}
	response, err := callArkPrivateAssetAPI(ctx, *setting, "CreateAssetGroup", map[string]interface{}{
		"Name":        "ark-private-assets",
		"Description": "自动导入的方舟可信素材",
		"GroupType":   arkPrivateAssetGroupType,
		"ProjectName": setting.ProjectName,
	})
	if err != nil {
		return "", fmt.Errorf("创建方舟素材组失败：%w", err)
	}
	groupID := arkPrivateAssetResponseField(response, "GroupId", "GroupID", "group_id", "Id", "ID", "id")
	if groupID == "" {
		return "", errors.New("方舟素材库没有返回素材组 ID")
	}
	setting.DefaultGroupID = groupID
	if settingRecord == nil {
		settingRecord = &model.SystemSetting{Key: arkPrivateAssetSettingKey}
	}
	if err := s.saveArkPrivateAssetSetting(settingRecord, *setting); err != nil {
		return "", err
	}
	return groupID, nil
}

func shouldRetryArkPrivateAssetBinding(binding *model.ArkPrivateAssetBinding) bool {
	if binding == nil || strings.ToLower(strings.TrimSpace(binding.Status)) != arkPrivateAssetStatusFail || binding.AssetGroupID != "" || binding.ArkAssetID != "" {
		return false
	}
	return strings.Contains(binding.Error, "方舟素材库没有返回素材组 ID") || strings.Contains(binding.Error, "方舟素材库没有返回素材 ID")
}

func shouldResumeArkPrivateAssetPolling(binding *model.ArkPrivateAssetBinding) bool {
	if binding == nil || strings.ToLower(strings.TrimSpace(binding.Status)) != arkPrivateAssetStatusFail || binding.AssetGroupID == "" || binding.ArkAssetID == "" {
		return false
	}
	return strings.Contains(binding.Error, "MissingParameter.Id")
}

func (s *Service) waitForArkPrivateAsset(ctx context.Context, binding *model.ArkPrivateAssetBinding, setting *arkPrivateAssetSettingValue) (string, error) {
	deadline := time.Now().Add(arkPrivateAssetPollLimit)
	for time.Now().Before(deadline) {
		switch strings.ToLower(strings.TrimSpace(binding.Status)) {
		case arkPrivateAssetStatusLive:
			if strings.TrimSpace(binding.ArkAssetID) == "" {
				return "", errors.New("方舟可信素材记录缺少素材 ID")
			}
			return binding.ArkAssetID, nil
		case arkPrivateAssetStatusFail:
			return "", fmt.Errorf("方舟可信素材审核失败：%s", defaultString(binding.Error, "请更换拥有使用权的虚拟人物素材后重试"))
		}
		if binding.ArkAssetID != "" {
			response, err := callArkPrivateAssetAPI(ctx, *setting, "GetAsset", map[string]interface{}{
				"Id":          binding.ArkAssetID,
				"ProjectName": setting.ProjectName,
			})
			if err != nil {
				return "", fmt.Errorf("查询方舟可信素材审核状态失败：%w", err)
			}
			status := strings.ToLower(arkPrivateAssetResponseField(response, "Status", "status"))
			switch status {
			case "active":
				binding.Status = arkPrivateAssetStatusLive
				binding.Error = ""
				if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
					return "", err
				}
				return binding.ArkAssetID, nil
			case "failed":
				message := arkPrivateAssetResponseField(response, "ErrorMessage", "Message", "message")
				binding.Status = arkPrivateAssetStatusFail
				binding.Error = defaultString(message, "方舟未通过素材审核")
				if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
					return "", err
				}
				return "", fmt.Errorf("方舟可信素材审核失败：%s", binding.Error)
			case "":
				return "", errors.New("方舟可信素材状态缺失")
			}
		}
		if err := sleepContext(ctx, 2*time.Second); err != nil {
			return "", err
		}
		latest, err := s.repo.ArkPrivateAssetBinding(binding.ResourceID, binding.ProjectName)
		if err != nil {
			return "", err
		}
		binding = latest
	}
	return "", errors.New("方舟可信素材审核超时，请稍后重新提交视频任务")
}

func (s *Service) failArkPrivateAssetBinding(binding *model.ArkPrivateAssetBinding, reason error) error {
	binding.Status = arkPrivateAssetStatusFail
	binding.Error = reason.Error()
	if err := s.repo.SaveArkPrivateAssetBinding(binding); err != nil {
		return err
	}
	return reason
}

func callArkPrivateAssetAPI(ctx context.Context, setting arkPrivateAssetSettingValue, action string, payload map[string]interface{}) (map[string]interface{}, error) {
	// 素材库控制面调用不是模型生成；不能继承视频任务的请求审计或账单上下文，
	// 否则创建素材组、上传素材和审核查询会被误记为可计费的视频调用。
	ctx = withoutProviderAnalytics(ctx)
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	baseURL, err := arkPrivateAssetControlPlaneURL(setting.Region)
	if err != nil {
		return nil, err
	}
	endpoint, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	query := endpoint.Query()
	query.Set("Action", action)
	query.Set("Version", arkPrivateAssetAPIVersion)
	endpoint.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	credentials := base.Credentials{
		AccessKeyID:     setting.AccessKeyID,
		SecretAccessKey: setting.AccessKeySecret,
		Region:          setting.Region,
		Service:         "ark",
	}
	var response map[string]interface{}
	if err := doJSON(credentials.Sign(req), &response); err != nil {
		return nil, err
	}
	if metadata, ok := response["ResponseMetadata"].(map[string]interface{}); ok {
		if upstream, ok := metadata["Error"].(map[string]interface{}); ok {
			code := stringField(upstream, "Code")
			message := stringField(upstream, "Message")
			return nil, errors.New(defaultString(strings.TrimSpace(strings.Trim(strings.Join([]string{code, message}, " "), " ")), "方舟素材库请求失败"))
		}
	}
	return response, nil
}

func arkPrivateAssetControlPlaneURL(region string) (string, error) {
	if override := strings.TrimSpace(arkPrivateAssetAPIBaseURLOverride); override != "" {
		return override, nil
	}
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "" {
		return "", errors.New("方舟素材库未配置 Region")
	}
	for _, char := range region {
		if !(char >= 'a' && char <= 'z') && !(char >= '0' && char <= '9') && char != '-' {
			return "", errors.New("方舟素材库 Region 格式无效")
		}
	}
	return "https://ark." + region + ".volcengineapi.com", nil
}

func arkPrivateAssetResponseField(response map[string]interface{}, keys ...string) string {
	for _, source := range arkPrivateAssetResponseMaps(response) {
		for _, key := range keys {
			if value := strings.TrimSpace(fmt.Sprint(source[key])); value != "" && value != "<nil>" {
				return value
			}
		}
	}
	return ""
}

func arkPrivateAssetResponseMaps(response map[string]interface{}) []map[string]interface{} {
	result := []map[string]interface{}{response}
	for _, key := range []string{"Result", "Asset", "Group", "Data"} {
		if value, ok := response[key].(map[string]interface{}); ok {
			result = append(result, value)
			for _, nestedKey := range []string{"Asset", "Group", "Data"} {
				if nested, ok := value[nestedKey].(map[string]interface{}); ok {
					result = append(result, nested)
				}
			}
		}
	}
	return result
}
