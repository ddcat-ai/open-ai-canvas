package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"path/filepath"
	"strings"
	"time"
)

const maxReferenceBytes int64 = 64 << 20

type outputItem struct {
	Filename  string
	Subfolder string
	Type      string
	Kind      string
}

func uploadReferences(comfy string, payload jsonMap) (map[string]string, error) {
	files := map[string]string{}
	for _, group := range []any{payload["referenceImages"], payload["referenceVideos"], payload["referenceAudios"], payload["mask"]} {
		values := sliceValue(group)
		if len(values) == 0 && group != nil {
			values = []any{group}
		}
		for _, raw := range values {
			media, ok := mapValue(raw)
			if !ok {
				continue
			}
			data, mimeType, err := mediaBytes(media)
			if err != nil {
				return nil, err
			}
			if len(data) == 0 {
				continue
			}
			name := safeName(firstNonEmpty(stringValue(media["id"]), randomID())) + extensionForMime(mimeType)
			uploadedName, err := uploadComfyMedia(comfy, name, mimeType, data)
			if err != nil {
				return nil, err
			}
			if id := stringValue(media["id"]); id != "" {
				files[id] = uploadedName
			}
		}
	}
	return files, nil
}

func mediaBytes(media jsonMap) ([]byte, string, error) {
	dataURL := stringValue(media["dataUrl"])
	mimeType := firstNonEmpty(stringValue(media["mimeType"]), stringValue(media["type"]))
	if strings.HasPrefix(dataURL, "data:") {
		comma := strings.IndexByte(dataURL, ',')
		if comma < 0 {
			return nil, "", errors.New("参考素材 data URL 格式无效")
		}
		header := dataURL[5:comma]
		if mimeType == "" {
			mimeType = strings.Split(header, ";")[0]
		}
		data, err := base64.StdEncoding.DecodeString(dataURL[comma+1:])
		if err != nil {
			return nil, "", errors.New("参考素材 data URL 编码无效")
		}
		if int64(len(data)) > maxReferenceBytes {
			return nil, "", errors.New("参考素材超过 64MB")
		}
		return data, firstNonEmpty(mimeType, "application/octet-stream"), nil
	}
	remoteURL := stringValue(media["url"])
	if remoteURL == "" {
		return nil, "", nil
	}
	if err := assertPublicRemoteURL(remoteURL); err != nil {
		return nil, "", err
	}
	client := publicMediaClient()
	response, err := client.Get(remoteURL)
	if err != nil {
		return nil, "", fmt.Errorf("下载远程参考素材失败：%w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", fmt.Errorf("下载远程参考素材失败 HTTP %d", response.StatusCode)
	}
	if response.ContentLength > maxReferenceBytes {
		return nil, "", errors.New("远程参考素材超过 64MB")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxReferenceBytes+1))
	if err != nil {
		return nil, "", err
	}
	if int64(len(data)) > maxReferenceBytes {
		return nil, "", errors.New("远程参考素材超过 64MB")
	}
	if mimeType == "" {
		mimeType = strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	}
	return data, firstNonEmpty(mimeType, "application/octet-stream"), nil
}

func uploadComfyMedia(comfy, name, mimeType string, data []byte) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "image", "filename": name}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	request, err := http.NewRequest(http.MethodPost, comfy+"/upload/image", body)
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := comfyHTTP.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	dataResponse, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("ComfyUI 上传参考素材失败 HTTP %d: %.500s", response.StatusCode, dataResponse)
	}
	var payload jsonMap
	if json.Unmarshal(dataResponse, &payload) != nil {
		return "", errors.New("ComfyUI 上传响应不是有效 JSON")
	}
	uploadedName := stringValue(payload["name"])
	if uploadedName == "" {
		return "", errors.New("ComfyUI 上传响应缺少文件名")
	}
	return uploadedName, nil
}

func assertPublicRemoteURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return errors.New("远程参考素材只允许无凭证的 HTTP/HTTPS 公网地址")
	}
	hostname := strings.ToLower(strings.Trim(parsed.Hostname(), "[]"))
	if hostname == "localhost" || strings.HasSuffix(hostname, ".localhost") || strings.HasSuffix(hostname, ".local") {
		return errors.New("拒绝访问本机或私网远程参考素材地址")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(context.Background(), hostname)
	if err != nil || len(addresses) == 0 {
		return errors.New("远程参考素材域名无法解析")
	}
	for _, address := range addresses {
		if isPrivateIP(address.IP) {
			return errors.New("拒绝访问解析到本机或私网的远程参考素材地址")
		}
	}
	return nil
}

func publicMediaClient() *http.Client {
	transport := &http.Transport{DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil || len(addresses) == 0 {
			return nil, errors.New("远程参考素材域名无法解析")
		}
		for _, candidate := range addresses {
			if isPrivateIP(candidate.IP) {
				return nil, errors.New("拒绝访问解析到本机或私网的远程参考素材地址")
			}
		}
		dialer := &net.Dialer{Timeout: 15 * time.Second}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].IP.String(), port))
	}}
	return &http.Client{
		Timeout:   2 * time.Minute,
		Transport: transport,
		CheckRedirect: func(request *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("远程参考素材重定向次数过多")
			}
			return assertPublicRemoteURL(request.URL.String())
		},
	}
}

func isPrivateIP(ip net.IP) bool {
	if ip == nil || ip.IsUnspecified() || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsMulticast() {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4[0] == 0 || (ipv4[0] == 100 && ipv4[1] >= 64 && ipv4[1] <= 127) || (ipv4[0] == 192 && ipv4[1] == 0) || (ipv4[0] == 198 && (ipv4[1] == 18 || ipv4[1] == 19)) || ipv4[0] >= 224
	}
	return false
}

func collectResult(comfy, mode string, history jsonMap) (jsonMap, error) {
	outputs := make([]outputItem, 0)
	root, _ := mapValue(history["outputs"])
	for _, nodeOutput := range root {
		collectOutputItems(nodeOutput, "", &outputs)
	}
	if len(outputs) == 0 {
		return nil, errors.New("ComfyUI 没有返回可下载产物")
	}
	images := make([]any, 0)
	var video, audio jsonMap
	for _, item := range outputs {
		query := url.Values{"filename": {item.Filename}, "subfolder": {item.Subfolder}, "type": {firstNonEmpty(item.Type, "output")}}
		response, err := comfyHTTP.Get(comfy + "/view?" + query.Encode())
		if err != nil {
			continue
		}
		data, readErr := io.ReadAll(io.LimitReader(response.Body, 64<<20))
		response.Body.Close()
		if readErr != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
			continue
		}
		mimeType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
		if mimeType == "" || mimeType == "application/octet-stream" {
			mimeType = mimeForName(item.Filename)
		}
		value := jsonMap{"dataUrl": "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), "mimeType": mimeType, "bytes": len(data), "name": item.Filename}
		switch item.Kind {
		case "video":
			video = value
		case "audio":
			audio = value
		case "image":
			images = append(images, value)
		}
	}
	if mode == "video" && video != nil {
		return jsonMap{"mode": "video", "video": video}, nil
	}
	if mode == "audio" && audio != nil {
		return jsonMap{"mode": "audio", "audio": audio}, nil
	}
	if len(images) > 0 {
		return jsonMap{"mode": "image", "images": images}, nil
	}
	if video != nil {
		return jsonMap{"mode": "video", "video": video}, nil
	}
	if audio != nil {
		return jsonMap{"mode": "audio", "audio": audio}, nil
	}
	return nil, errors.New("ComfyUI 产物下载失败")
}

func collectOutputItems(value any, forcedKind string, output *[]outputItem) {
	if items := sliceValue(value); len(items) > 0 {
		for _, child := range items {
			collectOutputItems(child, forcedKind, output)
		}
		return
	}
	item, ok := mapValue(value)
	if !ok {
		return
	}
	if filename := stringValue(item["filename"]); filename != "" {
		kind := forcedKind
		if kind == "" {
			kind = outputKind(filename)
		}
		if kind != "other" {
			*output = append(*output, outputItem{Filename: filename, Subfolder: stringValue(item["subfolder"]), Type: firstNonEmpty(stringValue(item["type"]), "output"), Kind: kind})
		}
		return
	}
	for key, child := range item {
		kind := ""
		switch key {
		case "videos":
			kind = "video"
		case "audio", "audios":
			kind = "audio"
		case "images", "gifs", "files":
			kind = forcedKind
		}
		collectOutputItems(child, kind, output)
	}
}

func safeName(value string) string {
	var result strings.Builder
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '_' || character == '-' {
			result.WriteRune(character)
		}
		if result.Len() >= 64 {
			break
		}
	}
	if result.Len() == 0 {
		return "reference"
	}
	return result.String()
}

func extensionForMime(value string) string {
	lower := strings.ToLower(value)
	switch {
	case strings.Contains(lower, "jpeg"):
		return ".jpg"
	case strings.Contains(lower, "webp"):
		return ".webp"
	case strings.Contains(lower, "video"):
		return ".mp4"
	case strings.Contains(lower, "audio"):
		return ".wav"
	default:
		return ".png"
	}
}

func mimeForName(value string) string {
	extension := strings.ToLower(filepath.Ext(value))
	switch extension {
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mp4", ".m4v", ".mkv":
		return "video/mp4"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".flac":
		return "audio/flac"
	case ".m4a", ".aac":
		return "audio/mp4"
	case ".mp3":
		return "audio/mpeg"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	default:
		return "image/png"
	}
}

func outputKind(value string) string {
	extension := strings.ToLower(filepath.Ext(value))
	if stringIn(extension, ".mp4", ".webm", ".mov", ".m4v", ".mkv") {
		return "video"
	}
	if stringIn(extension, ".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac") {
		return "audio"
	}
	if stringIn(extension, ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp") {
		return "image"
	}
	return "other"
}
