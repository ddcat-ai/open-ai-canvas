package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type OSSConnectionTestResult struct {
	OK           bool      `json:"ok"`
	Message      string    `json:"message,omitempty"`
	TestedAt     time.Time `json:"testedAt"`
	TestedDigest string    `json:"testedDigest"`
}

func (s *Service) TestAdminOSSSetting(actor *model.User, req OSSSettingRequest) (*OSSConnectionTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, current, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	return s.testOSSSetting("platform", "", actor.ID, req, current)
}

func (s *Service) TestUserOSSSetting(actor *model.User, req OSSSettingRequest) (*OSSConnectionTestResult, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	_, platform, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(strings.TrimSpace(req.Provider), s3Provider) && !platform.AllowUserS3 {
		return nil, Forbidden("平台管理员尚未允许个人 S3 兼容存储")
	}
	_, current, err := s.readUserOSSSetting(actor.ID)
	if err != nil {
		return nil, err
	}
	return s.testOSSSetting("user", actor.ID, actor.ID, req, current)
}

func (s *Service) testOSSSetting(scope string, ownerID string, actorID string, req OSSSettingRequest, current ossSettingValue) (*OSSConnectionTestResult, error) {
	req.Enabled = true
	value, err := ossSettingFromRequest(req, current)
	if err != nil {
		return nil, err
	}
	key := scope + ":" + actorID
	s.storageTestMu.Lock()
	if s.activeStorageTests == nil {
		s.activeStorageTests = make(map[string]bool)
	}
	if s.activeStorageTests[key] {
		s.storageTestMu.Unlock()
		return nil, NewAppError(http.StatusConflict, "对象存储连接测试正在进行")
	}
	s.activeStorageTests[key] = true
	s.storageTestMu.Unlock()
	defer func() {
		s.storageTestMu.Lock()
		delete(s.activeStorageTests, key)
		s.storageTestMu.Unlock()
	}()

	testKey := path.Join(value.PathPrefix, ".yingce-tests", scope, newID())
	payload := []byte("yingce-storage-test")
	if _, err := putOSSObject(value, testKey, "application/octet-stream", int64(len(payload)), bytes.NewReader(payload)); err != nil {
		return nil, err
	}
	stream, err := getOSSObjectRange(value, testKey, "bytes=0-3")
	var rangeErr error
	if err != nil {
		rangeErr = err
	} else {
		data, readErr := io.ReadAll(io.LimitReader(stream.body, 5))
		closeErr := stream.body.Close()
		if readErr != nil || closeErr != nil || string(data) != "ying" {
			rangeErr = errors.New("对象存储 Range 读取测试失败")
		}
	}
	if err := deleteOSSObject(value, testKey); err != nil {
		return nil, fmt.Errorf("对象存储删除测试失败：%w", err)
	}
	if rangeErr != nil {
		return nil, rangeErr
	}

	location, err := s.upsertStorageLocation(scope, ownerID, value)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	location.TestedDigest = storageTestDigest(value)
	location.TestedAt = &now
	if err := s.repo.SaveStorageLocation(location); err != nil {
		return nil, err
	}
	return &OSSConnectionTestResult{OK: true, Message: "连接测试通过", TestedAt: now, TestedDigest: location.TestedDigest}, nil
}

func (s *Service) upsertStorageLocation(scope string, ownerID string, value ossSettingValue) (*model.StorageLocation, error) {
	digest := storageLocationDigest(value)
	location, err := s.repo.StorageLocationByDigest(scope, ownerID, value.Provider, digest)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	stored, err := s.encryptOSSSettingSecrets(value)
	if err != nil {
		return nil, err
	}
	stored.Enabled = true
	stored.StorageLocationID = ""
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	if location == nil {
		location = &model.StorageLocation{ID: newID(), Scope: scope, OwnerID: ownerID, Provider: value.Provider, LocationDigest: digest, ValueJSON: string(encoded)}
		if err := s.repo.CreateStorageLocation(location); err != nil {
			return nil, err
		}
		return location, nil
	}
	location.ValueJSON = string(encoded)
	return location, nil
}

func (s *Service) storageLocationValue(id string) (*model.StorageLocation, ossSettingValue, error) {
	location, err := s.repo.StorageLocation(id)
	if err != nil {
		return nil, ossSettingValue{}, err
	}
	var value ossSettingValue
	if err := json.Unmarshal([]byte(location.ValueJSON), &value); err != nil {
		return nil, ossSettingValue{}, errors.New("对象存储位置配置格式无效")
	}
	if _, err := s.decryptOSSSettingSecrets(&value); err != nil {
		return nil, ossSettingValue{}, err
	}
	value.StorageLocationID = location.ID
	return location, normalizeOSSSetting(value), nil
}

func (s *Service) requireTestedS3Location(scope string, ownerID string, value ossSettingValue) (*model.StorageLocation, error) {
	location, err := s.repo.StorageLocationByDigest(scope, ownerID, s3Provider, storageLocationDigest(value))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("S3 关键配置尚未通过连接测试")
		}
		return nil, err
	}
	if location.TestedAt == nil || location.TestedDigest != storageTestDigest(value) {
		return nil, BadAuthRequest("S3 关键配置或凭据已变化，请重新连接测试")
	}
	return location, nil
}

func (s *Service) populateStorageLocationPublic(result *PublicOSSSetting, scope string, ownerID string, id string) error {
	count, err := s.repo.StorageLocationHistoryCount(scope, ownerID)
	if err != nil {
		return err
	}
	result.HistoryCount = count
	if id == "" {
		return nil
	}
	location, err := s.repo.StorageLocation(id)
	if err != nil {
		return err
	}
	result.TestedAt = location.TestedAt
	result.TestedDigest = location.TestedDigest
	result.ReferencedResourceCount, err = s.repo.StorageLocationResourceCount(id)
	return err
}

func deleteOSSObject(setting ossSettingValue, objectKey string) error {
	switch normalizeOSSSetting(setting).Provider {
	case s3Provider:
		return deleteS3Object(setting, objectKey)
	case tencentCOSProvider:
		return deleteTencentCOSObject(setting, objectKey)
	case qiniuKodoProvider:
		return deleteQiniuObject(setting, objectKey)
	default:
		return deleteAliyunOSSObject(setting, objectKey)
	}
}
