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

type OSSSettingRequest struct {
	Enabled         bool   `json:"enabled"`
	Provider        string `json:"provider"`
	Region          string `json:"region"`
	Endpoint        string `json:"endpoint"`
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
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
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
	stored := next
	stored.AccessKeySecret, err = s.encryptSettingSecret(next.AccessKeySecret)
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
	stored := next
	stored.AccessKeySecret, err = s.encryptSettingSecret(next.AccessKeySecret)
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
	storedSecret := value.AccessKeySecret
	value.AccessKeySecret, err = s.decryptSettingSecret(value.AccessKeySecret)
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	if storedSecret != "" && !strings.HasPrefix(storedSecret, encryptedSettingPrefix) {
		migrated := value
		migrated.AccessKeySecret, err = s.encryptSettingSecret(value.AccessKeySecret)
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
	secret, err := s.decryptSettingSecret(value.AccessKeySecret)
	if err != nil {
		return ossSettingValue{}, err
	}
	value.AccessKeySecret = secret
	value.Enabled = setting.Enabled
	return normalizeOSSSetting(value), nil
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
			if key == "apiKey" {
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
			if key == "apiKey" {
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

func ossSettingFromRequest(req OSSSettingRequest, current ossSettingValue) (ossSettingValue, error) {
	next := ossSettingValue{
		Enabled:         req.Enabled,
		Provider:        strings.TrimSpace(req.Provider),
		Region:          strings.TrimSpace(req.Region),
		Endpoint:        strings.TrimRight(strings.TrimSpace(req.Endpoint), "/"),
		Bucket:          strings.TrimSpace(req.Bucket),
		AccessKeyID:     strings.TrimSpace(req.AccessKeyID),
		AccessKeySecret: strings.TrimSpace(req.AccessKeySecret),
		PublicBaseURL:   strings.TrimRight(strings.TrimSpace(req.PublicBaseURL), "/"),
		PathPrefix:      strings.Trim(strings.TrimSpace(req.PathPrefix), "/"),
	}
	if next.Provider == "" {
		next.Provider = "aliyun"
	}
	if next.Provider != "aliyun" {
		return next, BadAuthRequest("暂时只支持阿里云 OSS")
	}
	if next.AccessKeySecret == "" {
		next.AccessKeySecret = current.AccessKeySecret
	}
	if next.Enabled {
		if next.Bucket == "" {
			return next, BadAuthRequest("请填写 OSS Bucket")
		}
		if next.Endpoint == "" {
			return next, BadAuthRequest("请填写 OSS Endpoint")
		}
		if _, err := ValidateOutboundURL(next.Endpoint); err != nil {
			return next, err
		}
		if next.AccessKeyID == "" {
			return next, BadAuthRequest("请填写 AccessKey ID")
		}
		if next.AccessKeySecret == "" {
			return next, BadAuthRequest("请填写 AccessKey Secret")
		}
	}
	return next, nil
}

func normalizeOSSSetting(value ossSettingValue) ossSettingValue {
	value.Provider = strings.TrimSpace(value.Provider)
	if value.Provider == "" {
		value.Provider = "aliyun"
	}
	value.Region = strings.TrimSpace(value.Region)
	value.Endpoint = strings.TrimRight(strings.TrimSpace(value.Endpoint), "/")
	value.Bucket = strings.TrimSpace(value.Bucket)
	value.AccessKeyID = strings.TrimSpace(value.AccessKeyID)
	value.AccessKeySecret = strings.TrimSpace(value.AccessKeySecret)
	value.PublicBaseURL = strings.TrimRight(strings.TrimSpace(value.PublicBaseURL), "/")
	value.PathPrefix = strings.Trim(strings.TrimSpace(value.PathPrefix), "/")
	return value
}

func defaultOSSSetting() ossSettingValue {
	return ossSettingValue{Provider: "aliyun"}
}

func publicOSSSetting(setting *model.SystemSetting, value ossSettingValue) PublicOSSSetting {
	result := PublicOSSSetting{
		Enabled:            value.Enabled,
		Provider:           value.Provider,
		Region:             value.Region,
		Endpoint:           value.Endpoint,
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
