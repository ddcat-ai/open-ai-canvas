package protocol

import (
	"encoding/base64"
	"encoding/json"
	"mime"
	"net/url"
	"strings"
)

// Normalized text parts are an additive manifest view. Legacy messages and
// provider-native Agent payloads remain unchanged; manifests own wire encoding.
func manifestTextValues(messages []any, request GenerationRequest) ([]any, map[string]any) {
	if len(request.Images)+len(request.Videos)+len(request.Audios)+len(request.Inputs) > 0 {
		messages = append([]any(nil), messages...)
		content := make([]any, 0)
		hasLegacyCurrent := strings.TrimSpace(request.Prompt) != ""
		if hasLegacyCurrent {
			content = append(content, map[string]any{"type": "text", "text": request.Prompt})
		}
		groups := []struct {
			kind  string
			media []MediaReference
		}{{"image", request.Images}, {"video", request.Videos}, {"audio", request.Audios}}
		for _, group := range groups {
			for _, media := range group.media {
				value := defaultValue(media.URL, media.DataURL)
				hasLegacyCurrent = hasLegacyCurrent || value != ""
				content = append(content, map[string]any{"type": group.kind + "_url", group.kind + "_url": map[string]any{"url": value}})
			}
		}
		if len(request.Images)+len(request.Videos)+len(request.Audios) == 0 {
			for _, media := range request.Inputs {
				kind := media.Kind
				if kind != "image" && kind != "video" && kind != "audio" {
					content = append(content, map[string]any{"type": "unknown"})
					continue
				}
				content = append(content, map[string]any{"type": kind + "_url", kind + "_url": map[string]any{"url": defaultValue(media.URL, media.DataURL)}})
			}
		}
		if hasLegacyCurrent {
			messages = messages[:len(messages)-1]
		}
		messages = append(messages, map[string]any{"role": "user", "content": content})
	}
	mediaTypes := map[string]string{}
	for _, group := range [][]MediaReference{request.Images, request.Videos, request.Audios, request.Inputs} {
		for _, media := range group {
			if media.MIMEType != "" {
				mediaTypes[defaultValue(media.URL, media.DataURL)] = media.MIMEType
			}
		}
	}
	result := make([]any, 0, len(messages))
	allParts := make([]any, 0)
	types := make([]any, 0)
	seen := map[string]bool{}
	invalid, remoteImages, remoteVideos, remoteAudios := 0, 0, 0, 0
	for _, raw := range messages {
		message, _ := raw.(map[string]any)
		content := message["content"]
		encoded, err := json.Marshal(content)
		if err == nil {
			err = json.Unmarshal(encoded, &content)
		}
		if err != nil {
			content = map[string]any{"type": "unknown"}
		}
		parts := make([]any, 0)
		var text strings.Builder
		for _, rawPart := range manifestArray(content) {
			part := manifestTextPart(rawPart)
			part["raw"] = rawPart
			if part["isInline"] == false && part["mimeType"] == "" {
				if mediaType := mediaTypes[manifestString(part["value"])]; mediaType != "" {
					parsed, _, err := mime.ParseMediaType(mediaType)
					part["mimeType"], part["format"] = parsed, manifestTextMediaFormat(parsed)
					if err != nil || !strings.HasPrefix(parsed, manifestString(part["type"])+"/") {
						part["valid"] = false
					}
				}
			}
			parts = append(parts, part)
			allParts = append(allParts, part)
			kind, _ := part["type"].(string)
			if !seen[kind] {
				types = append(types, kind)
				seen[kind] = true
			}
			if part["valid"] != true {
				invalid++
			}
			if kind == "text" {
				text.WriteString(manifestString(part["text"]))
			}
			if part["isInline"] == false {
				switch kind {
				case "image":
					remoteImages++
				case "video":
					remoteVideos++
				case "audio":
					remoteAudios++
				}
			}
		}
		result = append(result, map[string]any{"role": message["role"], "parts": parts, "text": text.String()})
	}
	return result, map[string]any{"parts": allParts, "types": types, "invalidCount": invalid, "remoteImageCount": remoteImages, "remoteVideoCount": remoteVideos, "remoteAudioCount": remoteAudios}
}

func manifestTextPart(value any) map[string]any {
	if text, ok := value.(string); ok {
		return map[string]any{"type": "text", "text": text, "valid": true}
	}
	block, ok := value.(map[string]any)
	if !ok {
		return map[string]any{"type": "unknown", "valid": false}
	}
	kind, _ := block["type"].(string)
	if kind == "text" || kind == "input_text" || kind == "output_text" {
		text, valid := block["text"].(string)
		return map[string]any{"type": "text", "text": text, "valid": valid}
	}
	var reference, mimeType string
	switch kind {
	case "image_url", "input_image":
		kind = "image"
		reference = manifestTextMediaURL(block["image_url"])
	case "video_url", "input_video":
		kind = "video"
		reference = manifestTextMediaURL(block["video_url"])
	case "audio_url":
		kind = "audio"
		reference = manifestTextMediaURL(block["audio_url"])
	case "image", "video", "audio":
		source, _ := block["source"].(map[string]any)
		if source["type"] == "base64" {
			mimeType, _ = source["media_type"].(string)
			reference = "data:" + mimeType + ";base64," + manifestString(source["data"])
		} else if source["type"] == "url" {
			reference, _ = source["url"].(string)
		}
	case "input_audio":
		kind = "audio"
		audio, _ := block["input_audio"].(map[string]any)
		format := manifestString(audio["format"])
		if format == "mp3" {
			mimeType = "audio/mpeg"
		} else if format == "wav" {
			mimeType = "audio/wav"
		}
		reference = "data:" + mimeType + ";base64," + manifestString(audio["data"])
	default:
		if kind == "" {
			kind = "unknown"
		}
		return map[string]any{"type": kind, "valid": false}
	}
	part := map[string]any{"type": kind, "value": reference, "mimeType": mimeType, "data": "", "format": "", "isInline": false, "valid": false}
	if strings.HasPrefix(reference, "data:") {
		part["isInline"] = true
		mediaType, data, valid := manifestSplitDataURL(reference)
		if !valid {
			return part
		}
		mediaType, _, err := mime.ParseMediaType(mediaType)
		if err != nil || !strings.HasPrefix(mediaType, kind+"/") {
			return part
		}
		decoded, err := base64.StdEncoding.Strict().DecodeString(data)
		if err != nil || len(decoded) == 0 {
			return part
		}
		part["mimeType"], part["data"], part["format"], part["valid"] = mediaType, data, manifestTextMediaFormat(mediaType), true
		return part
	}
	u, err := url.Parse(reference)
	if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "gs") {
		return part
	}
	// This projection never fetches media. URL access and ownership remain host responsibilities.
	part["valid"] = true
	if mediaType, _ := block["mimeType"].(string); mediaType != "" {
		parsed, _, err := mime.ParseMediaType(mediaType)
		if err != nil || !strings.HasPrefix(parsed, kind+"/") {
			part["valid"] = false
			return part
		}
		part["mimeType"], part["format"] = parsed, manifestTextMediaFormat(parsed)
	}
	return part
}

func manifestTextMediaURL(value any) string {
	if text, ok := value.(string); ok {
		return text
	}
	object, _ := value.(map[string]any)
	text, _ := object["url"].(string)
	return text
}

func manifestTextMediaFormat(mediaType string) string {
	switch mediaType {
	case "image/jpeg":
		return "jpeg"
	case "image/png":
		return "png"
	case "image/gif":
		return "gif"
	case "image/webp":
		return "webp"
	case "audio/mpeg":
		return "mp3"
	case "audio/wav", "audio/x-wav":
		return "wav"
	case "audio/ogg":
		return "ogg"
	case "audio/flac", "audio/x-flac":
		return "flac"
	case "audio/mp4":
		return "mp4"
	case "audio/aac":
		return "aac"
	case "audio/webm":
		return "webm"
	case "video/mp4":
		return "mp4"
	case "video/webm":
		return "webm"
	case "video/quicktime":
		return "mov"
	case "video/mpeg":
		return "mpeg"
	case "video/x-matroska":
		return "mkv"
	case "video/x-msvideo":
		return "avi"
	case "video/x-flv":
		return "flv"
	case "video/3gpp":
		return "three_gp"
	}
	return ""
}
