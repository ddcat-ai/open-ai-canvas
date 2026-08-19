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
)

const (
	tapNowShareURLPrefix   = "https://app.tapnow.media/api/conversation/v1/canvas-share/"
	tapNowMaxResponseBytes = 16 << 20
	tapNowMaxNodes         = 1000
	tapNowMaxConnections   = 5000
)

type TapNowImportRequest struct {
	ShareID string `json:"shareId"`
}

type TapNowImportResult struct {
	BatchID                 string                   `json:"batchId"`
	BatchCreatedAt          time.Time                `json:"batchCreatedAt"`
	ShareID                 string                   `json:"shareId"`
	ProjectName             string                   `json:"projectName"`
	Nodes                   []TapNowCanvasNode       `json:"nodes"`
	Connections             []TapNowCanvasConnection `json:"connections"`
	ImportedNodeCount       int                      `json:"importedNodeCount"`
	ImportedConnectionCount int                      `json:"importedConnectionCount"`
	SkippedNodes            []TapNowImportIssue      `json:"skippedNodes"`
	SkippedConnections      []TapNowImportIssue      `json:"skippedConnections"`
	Warnings                []TapNowImportWarning    `json:"warnings"`
	MultiResultNodeCount    int                      `json:"multiResultNodeCount"`
	ReusedFailedNodeCount   int                      `json:"reusedFailedNodeCount"`
	PlaceholderNodeCount    int                      `json:"placeholderNodeCount"`
}

type TapNowCanvasNode struct {
	ID            string               `json:"id"`
	Type          string               `json:"type"`
	Title         string               `json:"title"`
	X             float64              `json:"x"`
	Y             float64              `json:"y"`
	Width         float64              `json:"width"`
	Height        float64              `json:"height"`
	Content       string               `json:"content"`
	Prompt        string               `json:"prompt,omitempty"`
	Model         string               `json:"model,omitempty"`
	Size          string               `json:"size,omitempty"`
	Quality       string               `json:"quality,omitempty"`
	Seconds       string               `json:"seconds,omitempty"`
	VQuality      string               `json:"vquality,omitempty"`
	GenerateAudio string               `json:"generateAudio,omitempty"`
	NaturalWidth  int                  `json:"naturalWidth,omitempty"`
	NaturalHeight int                  `json:"naturalHeight,omitempty"`
	DurationMs    int64                `json:"durationMs,omitempty"`
	MimeType      string               `json:"mimeType,omitempty"`
	Status        string               `json:"status,omitempty"`
	ErrorDetails  string               `json:"errorDetails,omitempty"`
	Metadata      TapNowImportMetadata `json:"metadata"`
}

type TapNowImportMetadata struct {
	Provider   string `json:"provider"`
	ShareID    string `json:"shareId"`
	NodeID     string `json:"nodeId"`
	BatchID    string `json:"batchId"`
	SourceType string `json:"sourceType,omitempty"`
}

type TapNowCanvasConnection struct {
	ID           string `json:"id"`
	FromNodeID   string `json:"fromNodeId"`
	ToNodeID     string `json:"toNodeId"`
	FromHandleID string `json:"fromHandleId,omitempty"`
	ToHandleID   string `json:"toHandleId,omitempty"`
}

type TapNowImportIssue struct {
	ID     string `json:"id,omitempty"`
	Name   string `json:"name,omitempty"`
	Reason string `json:"reason"`
}

type TapNowImportWarning struct {
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

type tapNowEnvelope struct {
	Code    int             `json:"code"`
	Data    json.RawMessage `json:"data"`
	Msg     string          `json:"msg"`
	Message string          `json:"message"`
}

type tapNowDetail struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	Nodes       []tapNowRawNode       `json:"nodes"`
	Connections []tapNowRawConnection `json:"connections"`
}

type tapNowRawNode struct {
	ID        string          `json:"id"`
	ShortID   int64           `json:"short_id"`
	Type      string          `json:"type"`
	Data      json.RawMessage `json:"data"`
	DeletedAt string          `json:"deleted_at"`
	Position  struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
	} `json:"position"`
	Measured struct {
		Width  float64 `json:"width"`
		Height float64 `json:"height"`
	} `json:"measured"`
}

type tapNowRawConnection struct {
	ID           string         `json:"id"`
	Source       string         `json:"source"`
	Target       string         `json:"target"`
	SourceHandle string         `json:"sourceHandle"`
	TargetHandle string         `json:"targetHandle"`
	Data         map[string]any `json:"data"`
	DeletedAt    string         `json:"deleted_at"`
}

type tapNowNodeData struct {
	Title    string         `json:"title"`
	Prompt   string         `json:"prompt"`
	Text     string         `json:"text"`
	Src      string         `json:"src"`
	Options  []string       `json:"options"`
	Type     string         `json:"type"`
	Params   map[string]any `json:"params"`
	TaskInfo map[string]any `json:"taskInfo"`
	Metadata struct {
		URL      string  `json:"url"`
		Width    int     `json:"width"`
		Height   int     `json:"height"`
		Duration float64 `json:"duration"`
	} `json:"__metadata"`
	Error        string `json:"error"`
	FailedReason string `json:"failedReason"`
}

// 读取公开分享前先校验目标画布归属，避免把导入结果写入他人画布。
func (s *Service) ImportTapNow(userID, canvasProjectID, shareID string) (*TapNowImportResult, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	if userID == "" || canvasProjectID == "" {
		return nil, Unauthorized("请先打开已同步的故事创作画布")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasProjectID); err != nil {
		return nil, err
	}
	detail, normalizedShareID, err := fetchTapNowDetail(strings.TrimSpace(shareID))
	if err != nil {
		return nil, err
	}
	return adaptTapNowDetail(detail, normalizedShareID)
}

func fetchTapNowDetail(shareID string) (*tapNowDetail, string, error) {
	if !isTapNowShareID(shareID) {
		return nil, "", BadAuthRequest("TapNow 分享 ID 格式无效")
	}
	endpoint, err := url.Parse(tapNowShareURLPrefix + url.PathEscape(shareID))
	if err != nil {
		return nil, "", err
	}
	req, err := http.NewRequest(http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "application/json")
	ApplyDefaultOutboundHeaders(req)
	client := OutboundHTTPClient(20 * time.Second)
	client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return errors.New("TapNow API 不允许重定向")
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", errors.New("TapNow 请求失败，请检查网络或分享链接")
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, tapNowMaxResponseBytes+1))
	if err != nil {
		return nil, "", errors.New("读取 TapNow 响应失败")
	}
	if len(body) > tapNowMaxResponseBytes {
		return nil, "", errors.New("TapNow 画布响应过大")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("TapNow 请求失败（HTTP %d）", resp.StatusCode)
	}
	var envelope tapNowEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, "", errors.New("TapNow 响应格式无效")
	}
	if envelope.Code != 0 {
		msg := strings.TrimSpace(envelope.Msg)
		if msg == "" {
			msg = strings.TrimSpace(envelope.Message)
		}
		if msg == "" {
			msg = "TapNow 返回业务错误"
		}
		return nil, "", errors.New(msg)
	}
	var detail tapNowDetail
	if err := json.Unmarshal(envelope.Data, &detail); err != nil {
		return nil, "", errors.New("TapNow 画布数据格式无效")
	}
	return &detail, shareID, nil
}
