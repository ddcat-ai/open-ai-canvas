package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	libTVSettingKey       = "libtv"
	libTVDetailURL        = "https://api.liblib.tv/api/canvas/project/detail"
	libTVMaxResponseBytes = 8 << 20
)

type LibTVSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	Token      string `json:"token"`
	ClearToken bool   `json:"clearToken"`
}

type PublicLibTVSetting struct {
	Enabled   bool      `json:"enabled"`
	HasToken  bool      `json:"hasToken"`
	UpdatedAt time.Time `json:"updatedAt,omitempty"`
}

type libTVSettingValue struct {
	Enabled bool   `json:"enabled"`
	Token   string `json:"token"`
}

type LibTVImportRequest struct {
	UUID string `json:"uuid"`
}

type LibTVImportResult struct {
	BatchID                 string                  `json:"batchId"`
	BatchCreatedAt          time.Time               `json:"batchCreatedAt"`
	ProjectUUID             string                  `json:"projectUuid"`
	ProjectName             string                  `json:"projectName"`
	Nodes                   []LibTVCanvasNode       `json:"nodes"`
	Connections             []LibTVCanvasConnection `json:"connections"`
	ImportedNodeCount       int                     `json:"importedNodeCount"`
	ImportedConnectionCount int                     `json:"importedConnectionCount"`
	SkippedNodes            []LibTVImportIssue      `json:"skippedNodes"`
	SkippedConnections      []LibTVImportIssue      `json:"skippedConnections"`
	Warnings                []LibTVImportWarning    `json:"warnings"`
	MultiResultNodeCount    int                     `json:"multiResultNodeCount"`
	StaleNodeCount          int                     `json:"staleNodeCount"`
	ReusedFailedNodeCount   int                     `json:"reusedFailedNodeCount"`
	PlaceholderNodeCount    int                     `json:"placeholderNodeCount"`
	ConvertedSpecialCount   int                     `json:"convertedSpecialCount"`
}

type LibTVCanvasNode struct {
	ID            string              `json:"id"`
	Type          string              `json:"type"`
	Title         string              `json:"title"`
	X             float64             `json:"x"`
	Y             float64             `json:"y"`
	Width         float64             `json:"width"`
	Height        float64             `json:"height"`
	Content       string              `json:"content"`
	Prompt        string              `json:"prompt,omitempty"`
	Model         string              `json:"model,omitempty"`
	NaturalWidth  int                 `json:"naturalWidth,omitempty"`
	NaturalHeight int                 `json:"naturalHeight,omitempty"`
	DurationMs    int64               `json:"durationMs,omitempty"`
	MimeType      string              `json:"mimeType,omitempty"`
	Status        string              `json:"status,omitempty"`
	ErrorDetails  string              `json:"errorDetails,omitempty"`
	Metadata      LibTVImportMetadata `json:"metadata"`
}

type LibTVImportMetadata struct {
	Provider         string `json:"provider"`
	ProjectUUID      string `json:"projectUuid"`
	NodeKey          string `json:"nodeKey"`
	BatchID          string `json:"batchId"`
	SourceType       string `json:"sourceType,omitempty"`
	StyleAssetUUID   string `json:"styleAssetUuid,omitempty"`
	StyleVersionUUID string `json:"styleVersionUuid,omitempty"`
	StyleName        string `json:"styleName,omitempty"`
}

type LibTVCanvasConnection struct {
	ID         string `json:"id"`
	FromNodeID string `json:"fromNodeId"`
	ToNodeID   string `json:"toNodeId"`
}

type LibTVImportIssue struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Reason string `json:"reason"`
}

type LibTVImportWarning struct {
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

type libTVEnvelope struct {
	Code int             `json:"code"`
	Data json.RawMessage `json:"data"`
	Msg  string          `json:"msg"`
}

type libTVDetail struct {
	ProjectMeta struct {
		UUID      string `json:"uuid"`
		Name      string `json:"name"`
		Effective struct {
			CanRead bool `json:"canRead"`
			CanCopy bool `json:"canCopy"`
		} `json:"effective"`
	} `json:"projectMeta"`
	NodeList       []libTVRawNode       `json:"nodeList"`
	ConnectionList []libTVRawConnection `json:"connectionList"`
}

type libTVRawNode struct {
	NodeKey  string `json:"nodeKey"`
	Name     string `json:"name"`
	Data     string `json:"data"`
	Position struct {
		X string `json:"positionX"`
		Y string `json:"positionY"`
	} `json:"position"`
	Measured struct {
		Width  string `json:"width"`
		Height string `json:"height"`
	} `json:"measured"`
	TaskInfo struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale bool `json:"isStale"`
}

type libTVRawConnection struct {
	ConnectionID string `json:"connectionId"`
	Source       string `json:"source"`
	Target       string `json:"target"`
}

type libTVNodeData struct {
	Type             string         `json:"type"`
	URL              []string       `json:"url"`
	CoverURL         string         `json:"coverUrl"`
	StyleAssetUUID   string         `json:"styleAssetUuid"`
	StyleVersionUUID string         `json:"styleVersionUuid"`
	StyleName        string         `json:"styleName"`
	Params           map[string]any `json:"params"`
	TaskInfo         struct {
		Status       int    `json:"status"`
		FailedReason string `json:"failedReason"`
	} `json:"taskInfo"`
	IsStale      bool `json:"isStale"`
	ResourceMeta struct {
		Items []struct {
			Width       int     `json:"width"`
			Height      int     `json:"height"`
			DurationSec float64 `json:"durationSec"`
		} `json:"items"`
	} `json:"_resourceMeta"`
}

func (s *Service) AdminLibTVSetting(actor *model.User) (*PublicLibTVSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	return publicLibTVSetting(setting, value), nil
}

func (s *Service) UpdateLibTVSetting(actor *model.User, req LibTVSettingRequest) (*PublicLibTVSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, current, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	token := strings.TrimSpace(req.Token)
	if req.ClearToken {
		token = ""
	} else if token == "" {
		token = current.Token
	}
	if req.Enabled && token == "" {
		return nil, BadAuthRequest("启用 LibTV 前请先配置 Token")
	}
	protected, err := s.encryptSettingSecret(token)
	if err != nil {
		return nil, err
	}
	valueJSON, err := json.Marshal(libTVSettingValue{Enabled: req.Enabled, Token: protected})
	if err != nil {
		return nil, err
	}
	setting := &model.SystemSetting{Key: libTVSettingKey, ValueJSON: string(valueJSON), UpdatedBy: actor.ID}
	if existing, lookupErr := s.repo.SystemSetting(libTVSettingKey); lookupErr == nil {
		setting.CreatedAt = existing.CreatedAt
	} else if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return nil, lookupErr
	}
	if err := s.repo.SaveSystemSetting(setting); err != nil {
		return nil, err
	}
	return publicLibTVSetting(setting, libTVSettingValue{Enabled: req.Enabled, Token: token}), nil
}

func (s *Service) TestLibTV(actor *model.User, projectUUID string) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return err
	}
	if value.Token == "" {
		return BadAuthRequest("尚未配置 LibTV Token")
	}
	_, err = s.fetchLibTVDetail(strings.TrimSpace(projectUUID), value.Token)
	return err
}

func (s *Service) ImportLibTV(userID, canvasProjectID, projectUUID string) (*LibTVImportResult, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	if userID == "" || canvasProjectID == "" {
		return nil, Unauthorized("请先打开已同步的" + s.appearanceBrandName() + "画布")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		return nil, err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	if !value.Enabled || value.Token == "" {
		return nil, BadAuthRequest("LibTV 尚未启用或未配置 Token")
	}
	detail, err := s.fetchLibTVDetail(strings.TrimSpace(projectUUID), value.Token)
	if err != nil {
		return nil, err
	}
	return adaptLibTVDetail(detail)
}

func (s *Service) readLibTVSetting() (*model.SystemSetting, libTVSettingValue, error) {
	setting, err := s.repo.SystemSetting(libTVSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, libTVSettingValue{}, nil
	}
	if err != nil {
		return nil, libTVSettingValue{}, err
	}
	value := libTVSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, value, errors.New("LibTV 配置格式无效")
	}
	if value.Token != "" {
		plain, err := s.decryptSettingSecret(value.Token)
		if err != nil {
			return nil, value, err
		}
		value.Token = plain
	}
	return setting, value, nil
}

func publicLibTVSetting(setting *model.SystemSetting, value libTVSettingValue) *PublicLibTVSetting {
	result := &PublicLibTVSetting{Enabled: value.Enabled, HasToken: strings.TrimSpace(value.Token) != ""}
	if setting != nil {
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func (s *Service) fetchLibTVDetail(projectUUID, token string) (*libTVDetail, error) {
	projectUUID = strings.TrimSpace(projectUUID)
	if !isLibTVProjectUUID(projectUUID) {
		return nil, BadAuthRequest("LibTV 画布 UUID 格式无效")
	}
	u, err := url.Parse(libTVDetailURL)
	if err != nil {
		return nil, err
	}
	query := u.Query()
	query.Set("uuid", projectUUID)
	u.RawQuery = query.Encode()
	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("token", token)
	ApplyDefaultOutboundHeaders(req)
	client := OutboundHTTPClient(20 * time.Second)
	// Token 是 LibTV 专用凭证，禁止重定向以避免自定义请求头被带到其他主机。
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("LibTV API 不允许重定向")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, errors.New("LibTV 请求失败，请检查网络或 Token")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, libTVMaxResponseBytes+1))
	if err != nil {
		return nil, errors.New("读取 LibTV 响应失败")
	}
	if len(body) > libTVMaxResponseBytes {
		return nil, errors.New("LibTV 响应过大")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("LibTV 请求失败（HTTP %d）", resp.StatusCode)
	}
	var envelope libTVEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, errors.New("LibTV 响应格式无效")
	}
	if envelope.Code != 0 {
		msg := strings.TrimSpace(envelope.Msg)
		if msg == "" {
			msg = "LibTV 返回业务错误"
		}
		return nil, errors.New(msg)
	}
	var detail libTVDetail
	if err := json.Unmarshal(envelope.Data, &detail); err != nil {
		return nil, errors.New("LibTV 画布数据格式无效")
	}
	if strings.TrimSpace(detail.ProjectMeta.UUID) == "" {
		detail.ProjectMeta.UUID = projectUUID
	}
	if !detail.ProjectMeta.Effective.CanRead || !detail.ProjectMeta.Effective.CanCopy {
		return nil, errors.New("当前 LibTV 画布不允许复制")
	}
	return &detail, nil
}
