// 生成结果（data URL / 远程地址）的持久化与远程下载。
//
// 远程下载经过出站地址校验（validateRemoteResourceURL），防止 SSRF。

package app

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path"
	"path/filepath"
	"strings"
	"time"
)

func localObjectKey(userID string, kind string, fileName string, mimeType string, now time.Time) string {
	ext := resourceFileExtension(fileName, mimeType, kind)
	return path.Join("users", safeObjectSegment(userID), kind, now.Format("2006/01/02"), newID()+ext)
}

func (s *Service) persistGeneratedMediaResult(userID string, result map[string]interface{}) (map[string]interface{}, error) {
	return s.persistGeneratedMediaResultMode(userID, result, false, true)
}

func (s *Service) persistLegacyGeneratedMediaResult(userID string, result map[string]interface{}) (map[string]interface{}, error) {
	return s.persistGeneratedMediaResultMode(userID, result, true, false)
}

func (s *Service) persistGeneratedMediaResultMode(userID string, result map[string]interface{}, skipInvalidDataURL bool, enforceQuota bool) (map[string]interface{}, error) {
	if result == nil {
		return map[string]interface{}{}, nil
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var normalized map[string]interface{}
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, err
	}
	value, err := s.persistGeneratedMediaValueMode(userID, normalized, skipInvalidDataURL, enforceQuota, "")
	if err != nil {
		return nil, err
	}
	return value.(map[string]interface{}), nil
}

func (s *Service) persistGeneratedMediaValue(userID string, value interface{}) (interface{}, error) {
	return s.persistGeneratedMediaValueMode(userID, value, false, true, "")
}

func (s *Service) persistGeneratedMediaValueMode(userID string, value interface{}, skipInvalidDataURL bool, enforceQuota bool, kindHint string) (interface{}, error) {
	switch item := value.(type) {
	case []interface{}:
		for index, child := range item {
			stored, err := s.persistGeneratedMediaValueMode(userID, child, skipInvalidDataURL, enforceQuota, kindHint)
			if err != nil {
				return nil, err
			}
			item[index] = stored
		}
		return item, nil
	case map[string]interface{}:
		kindHint = generatedMediaKind(item, kindHint)
		if raw := inlineMediaValue(item); raw != "" {
			mimeType, data, err := s.decodeDataURL(raw)
			if err != nil && !skipInvalidDataURL {
				return nil, err
			}
			if err == nil {
				if err := s.persistGeneratedMediaBytes(userID, item, raw, mimeType, data, enforceQuota); err != nil {
					return nil, err
				}
			}
		} else if enforceQuota {
			if raw := remoteMediaValue(item, kindHint); raw != "" {
				policy, err := s.RuntimePolicy()
				if err != nil {
					return nil, err
				}
				if err := s.persistGeneratedMediaRemote(userID, item, raw, kindHint, megabytes(policy.Resource.GeneratedFileMB)+1); err != nil {
					return nil, err
				}
			}
		}
		for key, child := range item {
			stored, err := s.persistGeneratedMediaValueMode(userID, child, skipInvalidDataURL, enforceQuota, generatedMediaKindForKey(key, kindHint))
			if err != nil {
				return nil, err
			}
			item[key] = stored
		}
		return item, nil
	default:
		return value, nil
	}
}

func (s *Service) persistGeneratedMediaBytes(userID string, item map[string]interface{}, raw string, mimeType string, data []byte, enforceQuota bool) error {
	kind := normalizeResourceKind("", mimeType)
	width, height := intValue(item["width"]), intValue(item["height"])
	if kind == "image" && (width <= 0 || height <= 0) {
		width, height = imageDimensions(data)
	}
	return s.persistGeneratedMediaReader(userID, item, raw, kind, mimeType, int64(len(data)), width, height, bytes.NewReader(data), enforceQuota)
}

func (s *Service) persistGeneratedMediaRemote(userID string, item map[string]interface{}, raw string, kindHint string, maxBytes int64) error {
	stream, err := openRemoteGeneratedMedia(raw, kindHint, maxBytes)
	if err != nil {
		return fmt.Errorf("生成内容下载失败：%w", err)
	}
	if stream.size < 0 || stream.mimeType == "application/octet-stream" {
		_ = stream.body.Close()
		payload, err := downloadRemoteResource(raw, maxBytes)
		if err != nil {
			return fmt.Errorf("生成内容下载失败：%w", err)
		}
		if kindHint != "" && !strings.HasPrefix(strings.ToLower(payload.mimeType), kindHint+"/") {
			return fmt.Errorf("生成内容类型不匹配：期望 %s，实际 %s", kindHint, payload.mimeType)
		}
		return s.persistGeneratedMediaBytes(userID, item, raw, payload.mimeType, payload.data, true)
	}
	defer stream.body.Close()
	return s.persistGeneratedMediaReader(userID, item, raw, kindHint, stream.mimeType, stream.size, intValue(item["width"]), intValue(item["height"]), stream.body, true)
}

func (s *Service) persistGeneratedMediaReader(userID string, item map[string]interface{}, raw string, kind string, mimeType string, size int64, width int, height int, body io.Reader, enforceQuota bool) error {
	quotaDay := ""
	if enforceQuota {
		var err error
		quotaDay, err = s.reserveGeneratedResourceQuota(userID, size)
		if err != nil {
			return err
		}
	}
	writeObject := s.storeResourceObject
	if enforceQuota {
		writeObject = s.storeTaskMediaObject
	}
	resource, stored, err := s.storeResourceWithWriter(userID, kind, "generated."+extensionFromMimeType(mimeType), mimeType, size, width, height, int64(intValue(item["durationMs"])), body, nil, false, writeObject)
	if err != nil {
		if enforceQuota {
			s.releaseUserUploadQuota(userID, quotaDay, size)
		}
		return fmt.Errorf("生成内容写入资源存储失败：%w", err)
	}
	if enforceQuota {
		if stored {
			s.commitUserUploadQuota(userID, size)
		} else {
			s.releaseUserUploadQuota(userID, quotaDay, size)
		}
	}
	resourceURL := resourceFileURL(resource.ID)
	for _, key := range []string{"dataUrl", "content", "url", "coverUrl"} {
		if text, ok := item[key].(string); ok && (text == raw || strings.HasPrefix(text, "blob:")) {
			item[key] = resourceURL
		}
	}
	if _, ok := item["dataUrl"]; ok {
		item["dataUrl"] = resourceURL
	}
	item["url"] = resourceURL
	item["storageKey"] = "resource:" + resource.ID
	item["resourceId"] = resource.ID
	item["bytes"] = resource.Size
	item["mimeType"] = resource.MimeType
	item["width"] = resource.Width
	item["height"] = resource.Height
	return nil
}

func generatedMediaKind(item map[string]interface{}, fallback string) string {
	for _, key := range []string{"kind", "mode", "mimeType"} {
		value, _ := item[key].(string)
		value = strings.ToLower(strings.TrimSpace(value))
		switch {
		case value == "image" || strings.HasPrefix(value, "image/"):
			return "image"
		case value == "video" || strings.HasPrefix(value, "video/"):
			return "video"
		case value == "audio" || strings.HasPrefix(value, "audio/"):
			return "audio"
		}
	}
	return fallback
}

func generatedMediaKindForKey(key string, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(key)) {
	case "image", "images":
		return "image"
	case "video", "videos":
		return "video"
	case "audio", "audios":
		return "audio"
	default:
		return fallback
	}
}

func remoteMediaValue(item map[string]interface{}, kindHint string) string {
	if kindHint != "image" && kindHint != "video" && kindHint != "audio" {
		return ""
	}
	for _, key := range []string{"dataUrl", "content", "url"} {
		if text, ok := item[key].(string); ok && isPublicMediaURL(strings.TrimSpace(text)) {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func inlineMediaValue(item map[string]interface{}) string {
	for _, key := range []string{"dataUrl", "content", "url", "coverUrl"} {
		if text, ok := item[key].(string); ok && (strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/")) {
			return text
		}
	}
	return ""
}

func (s *Service) decodeDataURL(value string) (string, []byte, error) {
	header, encoded, ok := strings.Cut(value, ",")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", nil, fmt.Errorf("%w：格式无效", errInvalidGeneratedDataURL)
	}
	mimeType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, fmt.Errorf("%w：base64 解码失败：%v", errInvalidGeneratedDataURL, err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", nil, err
	}
	if int64(len(data)) > megabytes(policy.Resource.GeneratedFileMB) {
		return "", nil, fmt.Errorf("单个生成资源超过 %dMB", policy.Resource.GeneratedFileMB)
	}
	return mimeType, data, nil
}

func intValue(value interface{}) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case int64:
		return int(number)
	default:
		return 0
	}
}

type remoteResourcePayload struct {
	url      string
	endpoint string
	fileName string
	mimeType string
	data     []byte
}

func downloadRemoteResource(rawURL string, maxBytes int64) (remoteResourcePayload, error) {
	parsed, err := validateRemoteResourceURL(rawURL)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	client := OutboundHTTPClient(90 * time.Second)
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return remoteResourcePayload{}, fmt.Errorf("远程资源下载失败：%s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return remoteResourcePayload{}, err
	}
	if int64(len(data)) >= maxBytes {
		return remoteResourcePayload{}, BadAuthRequest(fmt.Sprintf("远程资源必须小于 %s", formatStorageLimit(maxBytes)))
	}
	mimeType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	fileName := path.Base(parsed.Path)
	if fileName == "" || fileName == "." || !strings.Contains(fileName, ".") {
		fileName = "resource." + extensionFromMimeType(mimeType)
	}
	return remoteResourcePayload{url: parsed.String(), endpoint: parsed.Host, fileName: fileName, mimeType: mimeType, data: data}, nil
}

type remoteGeneratedMediaStream struct {
	body     io.ReadCloser
	size     int64
	mimeType string
}

func openRemoteGeneratedMedia(rawURL string, kindHint string, maxBytes int64) (remoteGeneratedMediaStream, error) {
	parsed, err := validateRemoteResourceURL(rawURL)
	if err != nil {
		return remoteGeneratedMediaStream{}, err
	}
	client := OutboundHTTPClient(90 * time.Second)
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return remoteGeneratedMediaStream{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return remoteGeneratedMediaStream{}, err
	}
	closeWithError := func(closeErr error) (remoteGeneratedMediaStream, error) {
		_ = resp.Body.Close()
		return remoteGeneratedMediaStream{}, closeErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return closeWithError(fmt.Errorf("远程资源下载失败：%s", resp.Status))
	}
	if resp.ContentLength == 0 {
		return closeWithError(errors.New("远程资源为空"))
	}
	if maxBytes > 0 && resp.ContentLength >= maxBytes {
		return closeWithError(BadAuthRequest(fmt.Sprintf("远程资源必须小于 %s", formatStorageLimit(maxBytes))))
	}
	mimeType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = mime.TypeByExtension(path.Ext(parsed.Path))
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	mimeType = strings.ToLower(mimeType)
	if kindHint != "" && mimeType != "application/octet-stream" && !strings.HasPrefix(mimeType, kindHint+"/") {
		return closeWithError(fmt.Errorf("生成内容类型不匹配：期望 %s，实际 %s", kindHint, mimeType))
	}
	return remoteGeneratedMediaStream{body: resp.Body, size: resp.ContentLength, mimeType: mimeType}, nil
}

func openRemoteResource(rawURL string) (io.ReadCloser, error) {
	parsed, err := validateRemoteResourceURL(rawURL)
	if err != nil {
		return nil, err
	}
	client := OutboundHTTPClient(90 * time.Second)
	resp, err := client.Get(parsed.String())
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, fmt.Errorf("远程资源读取失败：%s", resp.Status)
	}
	return resp.Body, nil
}

func validateRemoteResourceURL(rawURL string) (*url.URL, error) {
	return ValidateOutboundURL(rawURL)
}

func extensionFromMimeType(mimeType string) string {
	if strings.Contains(mimeType, "png") {
		return "png"
	}
	if strings.Contains(mimeType, "jpeg") {
		return "jpg"
	}
	if strings.Contains(mimeType, "webp") {
		return "webp"
	}
	if strings.Contains(mimeType, "gif") {
		return "gif"
	}
	if strings.Contains(mimeType, "mp4") {
		return "mp4"
	}
	if strings.Contains(mimeType, "webm") {
		return "webm"
	}
	if strings.Contains(mimeType, "mpeg") {
		return "mp3"
	}
	if strings.Contains(mimeType, "wav") {
		return "wav"
	}
	return "bin"
}

func resourceFileExtension(fileName string, mimeType string, kind string) string {
	if ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName))); ext != "" && ext != "." {
		return ext
	}
	cleanMimeType := strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if extensions, err := mime.ExtensionsByType(cleanMimeType); err == nil && len(extensions) > 0 {
		return strings.ToLower(extensions[0])
	}
	switch kind {
	case "image":
		return ".png"
	case "video":
		return ".mp4"
	case "audio":
		return ".mp3"
	default:
		return ".bin"
	}
}

func imageDimensions(data []byte) (int, int) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}
