package platform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

const maxAPICallPayloadBytes = 128 << 10
const maxAPICallPayloadSourceBytes = 1 << 20

// SanitizeAPICallPayload 保留排障所需报文，同时阻止密钥和大段内嵌媒体进入日志库。
func SanitizeAPICallPayload(data []byte, contentType string) string {
	if len(data) == 0 {
		return ""
	}
	mediaType, params, _ := mime.ParseMediaType(contentType)
	if mediaType == "" {
		mediaType, _, _ = mime.ParseMediaType(http.DetectContentType(data))
	}
	if mediaType == "multipart/form-data" && params["boundary"] != "" {
		return sanitizeMultipartPayload(bytes.NewReader(data), params["boundary"])
	}
	if len(data) > maxAPICallPayloadSourceBytes {
		return fmt.Sprintf("[报文过大，已省略，共 %d 字节]", len(data))
	}
	if json.Valid(data) {
		var payload any
		if json.Unmarshal(data, &payload) == nil {
			formatted, err := json.MarshalIndent(sanitizeAPICallJSON(payload, ""), "", "  ")
			if err == nil {
				return truncateAPICallPayload(string(formatted))
			}
		}
	}
	if strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "video/") || strings.HasPrefix(mediaType, "audio/") || mediaType == "application/octet-stream" {
		return fmt.Sprintf("[%s 二进制报文，共 %d 字节]", kernel.DefaultString(mediaType, "未知类型"), len(data))
	}
	return truncateAPICallPayload(string(data))
}

func RequestPayloadForLog(req *http.Request) string {
	if req == nil || req.GetBody == nil {
		return ""
	}
	body, err := req.GetBody()
	if err != nil {
		return ""
	}
	defer body.Close()
	mediaType, params, _ := mime.ParseMediaType(req.Header.Get("Content-Type"))
	if mediaType == "multipart/form-data" && params["boundary"] != "" {
		return sanitizeMultipartPayload(body, params["boundary"])
	}
	data, err := io.ReadAll(io.LimitReader(body, maxAPICallPayloadSourceBytes+1))
	if err != nil {
		return ""
	}
	if len(data) > maxAPICallPayloadSourceBytes {
		return fmt.Sprintf("[请求报文过大，已省略，超过 %d 字节]", maxAPICallPayloadSourceBytes)
	}
	return SanitizeAPICallPayload(data, req.Header.Get("Content-Type"))
}

func sanitizeMultipartPayload(source io.Reader, boundary string) string {
	reader := multipart.NewReader(source, boundary)
	fields := make(map[string]any)
	for partIndex := 0; partIndex < 100; partIndex++ {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "[multipart 请求报文无法解析]"
		}
		name := part.FormName()
		if part.FileName() != "" {
			size, _ := io.Copy(io.Discard, part)
			fields[name] = map[string]any{"fileName": part.FileName(), "contentType": part.Header.Get("Content-Type"), "size": size}
		} else {
			content, _ := io.ReadAll(io.LimitReader(part, maxAPICallPayloadBytes+1))
			fields[name] = sanitizeAPICallJSON(string(content), name)
		}
		part.Close()
	}
	formatted, _ := json.MarshalIndent(fields, "", "  ")
	return truncateAPICallPayload(string(formatted))
}

func sanitizeAPICallJSON(value any, key string) any {
	normalizedKey := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
	for _, secretKey := range []string{"apikey", "accesstoken", "authorization", "password", "secret"} {
		if strings.Contains(normalizedKey, secretKey) {
			return "[REDACTED]"
		}
	}
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for childKey, childValue := range typed {
			result[childKey] = sanitizeAPICallJSON(childValue, childKey)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, childValue := range typed {
			result[index] = sanitizeAPICallJSON(childValue, key)
		}
		return result
	case string:
		if strings.HasPrefix(typed, "data:") {
			mediaType := strings.TrimPrefix(strings.SplitN(typed, ";", 2)[0], "data:")
			return fmt.Sprintf("[内嵌媒体 %s，共 %d 字符]", kernel.DefaultString(mediaType, "未知类型"), len(typed))
		}
		if strings.Contains(normalizedKey, "base64") || strings.Contains(normalizedKey, "b64") {
			return fmt.Sprintf("[内嵌编码数据，共 %d 字符]", len(typed))
		}
		if sanitizedURL, ok := sanitizeAPICallURL(typed); ok {
			return sanitizedURL
		}
		return typed
	default:
		return value
	}
}

func sanitizeAPICallURL(value string) (string, bool) {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return "", false
	}
	query := parsed.Query()
	for key := range query {
		normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "_", ""), "-", ""))
		if strings.Contains(normalized, "token") || strings.Contains(normalized, "signature") || strings.Contains(normalized, "apikey") || normalized == "key" {
			query.Set(key, "[REDACTED]")
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), true
}

func truncateAPICallPayload(value string) string {
	if len(value) <= maxAPICallPayloadBytes {
		return value
	}
	return value[:maxAPICallPayloadBytes] + fmt.Sprintf("\n[报文已截断，原始长度 %d 字节]", len(value))
}
