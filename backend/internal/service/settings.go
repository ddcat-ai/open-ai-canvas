package service

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const ossSettingKey = "oss"
const encryptedSettingPrefix = "enc:v1:"

const (
	aliyunOSSProvider  = "aliyun"
	tencentCOSProvider = "tencent"
	qiniuKodoProvider  = "qiniu"
)

type OSSSettingRequest struct {
	Enabled         bool   `json:"enabled"`
	Provider        string `json:"provider"`
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
	CDNBaseURL      string `json:"cdnBaseUrl"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
}

type PublicOSSSetting struct {
	Enabled            bool      `json:"enabled"`
	Provider           string    `json:"provider"`
	Region             string    `json:"region"`
	Endpoint           string    `json:"endpoint"`
	CDNBaseURL         string    `json:"cdnBaseUrl"`
	Bucket             string    `json:"bucket"`
	AccessKeyID        string    `json:"accessKeyId"`
	HasAccessKeySecret bool      `json:"hasAccessKeySecret"`
	PublicBaseURL      string    `json:"publicBaseUrl"`
	PathPrefix         string    `json:"pathPrefix"`
	UpdatedBy          string    `json:"updatedBy"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type ossSettingValue struct {
	Enabled         bool   `json:"enabled"`
	Provider        string `json:"provider"`
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
	CDNBaseURL      string `json:"cdnBaseUrl"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
	// 平台切换云厂商后仍需读取历史资源，因此仅归档非当前厂商的访问密钥。
	ArchivedCredentials map[string]ossProviderCredentials `json:"archivedCredentials,omitempty"`
}

type ossProviderCredentials struct {
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
}

func (s *Service) AdminOSSSetting(actor *model.User) (*PublicOSSSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	public := publicOSSSetting(setting, value)
	return &public, nil
}

func (s *Service) UpdateOSSSetting(actor *model.User, req OSSSettingRequest) (*PublicOSSSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, currentValue, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	next, err := ossSettingFromRequest(req, currentValue)
	if err != nil {
		return nil, err
	}
	if !next.Enabled {
		if next.PublicBaseURL == "" {
			return nil, BadAuthRequest("服务器本地存储需要填写服务器访问地址")
		}
		if _, err := validatePublicResourceBaseURL(next.PublicBaseURL); err != nil {
			return nil, fmt.Errorf("服务器访问地址无效：%w", err)
		}
	}
	next = archiveOSSProviderCredentials(next, currentValue)
	stored, err := s.encryptOSSSettingSecrets(next)
	if err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{
		Key:       ossSettingKey,
		ValueJSON: string(valueJSON),
		UpdatedBy: actor.ID,
	}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	public := publicOSSSetting(&setting, next)
	return &public, nil
}

func (s *Service) UserOSSSetting(actor *model.User) (*PublicOSSSetting, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	setting, value, err := s.readUserOSSSetting(actor.ID)
	if err != nil {
		return nil, err
	}
	public := publicUserOSSSetting(setting, value)
	return &public, nil
}

func (s *Service) UpdateUserOSSSetting(actor *model.User, req OSSSettingRequest) (*PublicOSSSetting, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	_, currentValue, err := s.readUserOSSSetting(actor.ID)
	if err != nil {
		return nil, err
	}
	next, err := ossSettingFromRequest(req, currentValue)
	if err != nil {
		return nil, err
	}
	stored, err := s.encryptOSSSettingSecrets(next)
	if err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	// 配置按版本追加而不是覆盖，资源会固定引用创建时的版本。
	setting := model.UserOSSSetting{ID: newID(), UserID: actor.ID, Enabled: next.Enabled, ValueJSON: string(valueJSON)}
	if err := s.repo.CreateUserOSSSetting(&setting); err != nil {
		return nil, err
	}
	public := publicUserOSSSetting(&setting, next)
	return &public, nil
}

func (s *Service) readOSSSetting() (*model.SystemSetting, ossSettingValue, error) {
	setting, err := s.repo.SystemSetting(ossSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultOSSSetting(), nil
	}
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	value := defaultOSSSetting()
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, ossSettingValue{}, errors.New("平台 OSS 配置格式无效")
		}
	}
	needsMigration, err := s.decryptOSSSettingSecrets(&value)
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	if needsMigration {
		migrated, err := s.encryptOSSSettingSecrets(value)
		if err != nil {
			return nil, ossSettingValue{}, err
		}
		encoded, err := json.Marshal(migrated)
		if err != nil {
			return nil, ossSettingValue{}, err
		}
		setting.ValueJSON = string(encoded)
		if err := s.repo.SaveSystemSetting(setting); err != nil {
			return nil, ossSettingValue{}, err
		}
	}
	return setting, normalizeOSSSetting(value), nil
}

func (s *Service) readUserOSSSetting(userID string) (*model.UserOSSSetting, ossSettingValue, error) {
	setting, err := s.repo.LatestUserOSSSetting(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultOSSSetting(), nil
	}
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	value, err := s.userOSSSettingValue(setting)
	return setting, value, err
}

func (s *Service) readUserOSSSettingByID(userID string, id string) (*model.UserOSSSetting, ossSettingValue, error) {
	setting, err := s.repo.UserOSSSettingForUser(userID, id)
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	value, err := s.userOSSSettingValue(setting)
	return setting, value, err
}

func (s *Service) userOSSSettingValue(setting *model.UserOSSSetting) (ossSettingValue, error) {
	value := defaultOSSSetting()
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return ossSettingValue{}, errors.New("用户 OSS 配置格式无效")
		}
	}
	if _, err := s.decryptOSSSettingSecrets(&value); err != nil {
		return ossSettingValue{}, err
	}
	value.Enabled = setting.Enabled
	return normalizeOSSSetting(value), nil
}

func (s *Service) encryptOSSSettingSecrets(value ossSettingValue) (ossSettingValue, error) {
	var err error
	value.AccessKeySecret, err = s.encryptSettingSecret(value.AccessKeySecret)
	if err != nil {
		return ossSettingValue{}, err
	}
	value.ArchivedCredentials = cloneOSSProviderCredentials(value.ArchivedCredentials)
	for provider, credentials := range value.ArchivedCredentials {
		credentials.AccessKeySecret, err = s.encryptSettingSecret(credentials.AccessKeySecret)
		if err != nil {
			return ossSettingValue{}, err
		}
		value.ArchivedCredentials[provider] = credentials
	}
	return value, nil
}

func (s *Service) decryptOSSSettingSecrets(value *ossSettingValue) (bool, error) {
	needsMigration := value.AccessKeySecret != "" && !strings.HasPrefix(value.AccessKeySecret, encryptedSettingPrefix)
	secret, err := s.decryptSettingSecret(value.AccessKeySecret)
	if err != nil {
		return false, err
	}
	value.AccessKeySecret = secret
	value.ArchivedCredentials = cloneOSSProviderCredentials(value.ArchivedCredentials)
	for provider, credentials := range value.ArchivedCredentials {
		if credentials.AccessKeySecret != "" && !strings.HasPrefix(credentials.AccessKeySecret, encryptedSettingPrefix) {
			needsMigration = true
		}
		credentials.AccessKeySecret, err = s.decryptSettingSecret(credentials.AccessKeySecret)
		if err != nil {
			return false, err
		}
		value.ArchivedCredentials[provider] = credentials
	}
	return needsMigration, nil
}

func (s *Service) encryptSettingSecret(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	key, err := s.settingsEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nil, nonce, []byte(value), nil)
	return encryptedSettingPrefix + base64.RawStdEncoding.EncodeToString(append(nonce, ciphertext...)), nil
}

func (s *Service) decryptSettingSecret(value string) (string, error) {
	if !strings.HasPrefix(value, encryptedSettingPrefix) {
		return value, nil
	}
	payload, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(value, encryptedSettingPrefix))
	if err != nil {
		return "", errors.New("OSS 密钥密文格式无效")
	}
	key, err := s.settingsEncryptionKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(payload) < gcm.NonceSize() {
		return "", errors.New("OSS 密钥密文长度无效")
	}
	plaintext, err := gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
	if err != nil {
		return "", errors.New("OSS 密钥解密失败，请检查存储加密密钥")
	}
	return string(plaintext), nil
}

func (s *Service) settingsEncryptionKey() ([]byte, error) {
	path := filepath.Join(s.dataDir, ".settings-key")
	if data, err := os.ReadFile(path); err == nil && len(data) == 32 {
		return data, nil
	}
	if err := os.MkdirAll(s.dataDir, 0o750); err != nil {
		return nil, err
	}
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil, fmt.Errorf("读取存储加密密钥失败：%w", readErr)
		}
		if len(data) != 32 {
			return nil, errors.New("存储加密密钥长度无效")
		}
		return data, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(key); err != nil {
		_ = file.Close()
		return nil, err
	}
	if err := file.Close(); err != nil {
		return nil, err
	}
	return key, nil
}

func (s *Service) protectTaskSecrets(value interface{}) error {
	switch item := value.(type) {
	case map[string]interface{}:
		for key, child := range item {
			if isTaskSecretField(key) {
				secret, _ := child.(string)
				if secret != "" && secret != "system" && !strings.HasPrefix(secret, encryptedSettingPrefix) {
					encrypted, err := s.encryptSettingSecret(secret)
					if err != nil {
						return err
					}
					item[key] = encrypted
				}
				continue
			}
			if err := s.protectTaskSecrets(child); err != nil {
				return err
			}
		}
	case []interface{}:
		for _, child := range item {
			if err := s.protectTaskSecrets(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) decryptTaskInputJSON(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" || !strings.Contains(raw, encryptedSettingPrefix) {
		return raw, nil
	}
	var input interface{}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return "", err
	}
	if err := s.decryptTaskSecrets(input); err != nil {
		return "", err
	}
	encoded, err := json.Marshal(input)
	return string(encoded), err
}

func (s *Service) decryptTaskSecrets(value interface{}) error {
	switch item := value.(type) {
	case map[string]interface{}:
		for key, child := range item {
			if isTaskSecretField(key) {
				secret, _ := child.(string)
				if strings.HasPrefix(secret, encryptedSettingPrefix) {
					plain, err := s.decryptSettingSecret(secret)
					if err != nil {
						return err
					}
					item[key] = plain
				}
				continue
			}
			if err := s.decryptTaskSecrets(child); err != nil {
				return err
			}
		}
	case []interface{}:
		for _, child := range item {
			if err := s.decryptTaskSecrets(child); err != nil {
				return err
			}
		}
	}
	return nil
}

func isTaskSecretField(key string) bool {
	switch key {
	case "apiKey", "secretKey", "runningHubWalletApiKey", "runningHubUploadApiKey":
		return true
	default:
		return false
	}
}

func ossSettingFromRequest(req OSSSettingRequest, current ossSettingValue) (ossSettingValue, error) {
	next := normalizeOSSSetting(ossSettingValue{
		Enabled:         req.Enabled,
		Provider:        strings.TrimSpace(req.Provider),
		Region:          strings.TrimSpace(req.Region),
		Endpoint:        strings.TrimRight(strings.TrimSpace(req.Endpoint), "/"),
		CDNBaseURL:      strings.TrimRight(strings.TrimSpace(req.CDNBaseURL), "/"),
		Bucket:          strings.TrimSpace(req.Bucket),
		AccessKeyID:     strings.TrimSpace(req.AccessKeyID),
		AccessKeySecret: strings.TrimSpace(req.AccessKeySecret),
		PublicBaseURL:   strings.TrimRight(strings.TrimSpace(req.PublicBaseURL), "/"),
		PathPrefix:      strings.Trim(strings.TrimSpace(req.PathPrefix), "/"),
	})
	if next.Provider != aliyunOSSProvider && next.Provider != tencentCOSProvider && next.Provider != qiniuKodoProvider {
		return next, BadAuthRequest("仅支持阿里云 OSS、腾讯云 COS 和七牛云 Kodo")
	}
	current = normalizeOSSSetting(current)
	// 不同云厂商的密钥不能复用；只有继续使用同一厂商时，留空才表示保留原密钥。
	if next.AccessKeySecret == "" && next.Provider == current.Provider {
		next.AccessKeySecret = current.AccessKeySecret
	}
	if next.Enabled {
		if next.Bucket == "" {
			return next, BadAuthRequest("请填写对象存储 Bucket")
		}
		if next.Endpoint == "" {
			if next.Provider == tencentCOSProvider {
				return next, BadAuthRequest("请填写腾讯云 COS Region 或 Endpoint")
			}
			if next.Provider == qiniuKodoProvider {
				return next, BadAuthRequest("请填写七牛云 Kodo 上传 Endpoint")
			}
			return next, BadAuthRequest("请填写阿里云 OSS Endpoint")
		}
		if _, err := ValidateOutboundURL(next.Endpoint); err != nil {
			return next, err
		}
		if next.CDNBaseURL != "" {
			if _, err := ossCDNBaseURL(next.CDNBaseURL); err != nil {
				return next, BadAuthRequest(err.Error())
			}
			if _, err := ValidateOutboundURL(next.CDNBaseURL); err != nil {
				return next, err
			}
		}
		if next.AccessKeyID == "" {
			return next, BadAuthRequest("请填写访问密钥 AccessKey")
		}
		if next.AccessKeySecret == "" {
			return next, BadAuthRequest("请填写访问密钥 SecretKey")
		}
	}
	return next, nil
}

func archiveOSSProviderCredentials(next ossSettingValue, current ossSettingValue) ossSettingValue {
	next.ArchivedCredentials = cloneOSSProviderCredentials(current.ArchivedCredentials)
	if current.Provider != next.Provider && (current.AccessKeyID != "" || current.AccessKeySecret != "") {
		if next.ArchivedCredentials == nil {
			next.ArchivedCredentials = make(map[string]ossProviderCredentials)
		}
		next.ArchivedCredentials[current.Provider] = ossProviderCredentials{AccessKeyID: current.AccessKeyID, AccessKeySecret: current.AccessKeySecret}
	}
	delete(next.ArchivedCredentials, next.Provider)
	return next
}

func cloneOSSProviderCredentials(source map[string]ossProviderCredentials) map[string]ossProviderCredentials {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]ossProviderCredentials, len(source))
	for provider, credentials := range source {
		cloned[strings.ToLower(strings.TrimSpace(provider))] = ossProviderCredentials{
			AccessKeyID:     strings.TrimSpace(credentials.AccessKeyID),
			AccessKeySecret: strings.TrimSpace(credentials.AccessKeySecret),
		}
	}
	return cloned
}

func normalizeOSSSetting(value ossSettingValue) ossSettingValue {
	value.Provider = strings.ToLower(strings.TrimSpace(value.Provider))
	if value.Provider == "" {
		value.Provider = aliyunOSSProvider
	}
	value.Region = strings.TrimSpace(value.Region)
	value.Endpoint = strings.TrimRight(strings.TrimSpace(value.Endpoint), "/")
	if value.Provider == tencentCOSProvider && value.Endpoint == "" && value.Region != "" {
		value.Endpoint = "https://cos." + value.Region + ".myqcloud.com"
	}
	value.CDNBaseURL = strings.TrimRight(strings.TrimSpace(value.CDNBaseURL), "/")
	value.Bucket = strings.TrimSpace(value.Bucket)
	value.AccessKeyID = strings.TrimSpace(value.AccessKeyID)
	value.AccessKeySecret = strings.TrimSpace(value.AccessKeySecret)
	value.PublicBaseURL = strings.TrimRight(strings.TrimSpace(value.PublicBaseURL), "/")
	value.PathPrefix = strings.Trim(strings.TrimSpace(value.PathPrefix), "/")
	value.ArchivedCredentials = cloneOSSProviderCredentials(value.ArchivedCredentials)
	return value
}

func defaultOSSSetting() ossSettingValue {
	return ossSettingValue{Provider: aliyunOSSProvider}
}

func publicOSSSetting(setting *model.SystemSetting, value ossSettingValue) PublicOSSSetting {
	result := PublicOSSSetting{
		Enabled:            value.Enabled,
		Provider:           value.Provider,
		Region:             value.Region,
		Endpoint:           value.Endpoint,
		CDNBaseURL:         value.CDNBaseURL,
		Bucket:             value.Bucket,
		AccessKeyID:        value.AccessKeyID,
		HasAccessKeySecret: strings.TrimSpace(value.AccessKeySecret) != "",
		PublicBaseURL:      value.PublicBaseURL,
		PathPrefix:         value.PathPrefix,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func publicUserOSSSetting(setting *model.UserOSSSetting, value ossSettingValue) PublicOSSSetting {
	result := PublicOSSSetting{
		Enabled:            value.Enabled,
		Provider:           value.Provider,
		Region:             value.Region,
		Endpoint:           value.Endpoint,
		CDNBaseURL:         value.CDNBaseURL,
		Bucket:             value.Bucket,
		AccessKeyID:        value.AccessKeyID,
		HasAccessKeySecret: strings.TrimSpace(value.AccessKeySecret) != "",
		PublicBaseURL:      value.PublicBaseURL,
		PathPrefix:         value.PathPrefix,
	}
	if setting != nil {
		result.UpdatedBy = setting.UserID
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}
