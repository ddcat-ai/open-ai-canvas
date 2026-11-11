package protocol

import (
	"fmt"
	"strings"
)

// StandardImageSizeEncoding identifies transport shape from the actual create
// endpoint. Plugin IDs and configured capability values are not wire contracts.
func StandardImageSizeEncoding(create string) string {
	path := strings.TrimSuffix(strings.SplitN(create, "?", 2)[0], "/")
	if strings.HasSuffix(path, "/images/generations") || strings.HasSuffix(path, "/images/edits") {
		return "pixels"
	}
	if strings.Contains(path, "/models/") && strings.HasSuffix(path, ":generateContent") {
		return "ratio"
	}
	return ""
}

// Supplement only recognized standard interfaces. Explicit template fields,
// including conditional/transform expressions, remain authoritative.
func completeCommonImageRequest(spec RequestSpec, operation ManifestOperation, request GenerationRequest) (RequestSpec, error) {
	if request.Capability != CapabilityImage || request.ImageParameters == nil {
		return spec, nil
	}
	body, ok := spec.Body.(map[string]any)
	if !ok {
		body = nil
	}
	encoding := StandardImageSizeEncoding(spec.Path)
	openAI, gemini := encoding == "pixels", encoding == "ratio"
	mapped := map[string]bool{}
	set := func(target string, value any) bool {
		if manifestDeclaresImageField(operation, target) {
			return true
		}
		if body == nil {
			return false
		}
		parts := strings.Split(target, ".")
		current := body
		for _, part := range parts[:len(parts)-1] {
			if child, exists := current[part]; exists {
				object, valid := child.(map[string]any)
				if !valid {
					return false
				}
				current = object
			} else {
				object := map[string]any{}
				current[part], current = object, object
			}
		}
		key := parts[len(parts)-1]
		if _, exists := current[key]; !exists {
			current[key] = value
		}
		return true
	}
	// A raw adapter call has no saved presets available for conversion. Reject
	// mismatched shapes instead of sending them under a standard API field.
	if openAI && strings.Contains(request.AspectRatio, ":") && !manifestDeclaresImageField(operation, "size") || gemini && strings.Contains(request.AspectRatio, "x") && !manifestDeclaresImageField(operation, "generationConfig.imageConfig.aspectRatio") {
		return RequestSpec{}, fmt.Errorf("图片参数 size 缺少目标接口的 %s 尺寸转换", encoding)
	}
	names := map[string]bool{}
	for name := range request.ImageParameters {
		names[name] = true
	}
	if request.AspectRatio != "" {
		names["size"] = true
	}
	for name := range names {
		if openAI {
			switch name {
			case "size":
				if request.AspectRatio != "" {
					mapped[name] = set("size", request.AspectRatio)
				}
			case "quality":
				if request.Quality != "" {
					mapped[name] = set("quality", request.Quality)
				}
			case "count":
				if request.ImageCount > 0 {
					mapped[name] = set("n", request.ImageCount)
				}
			case "transparentBackground":
				background := "opaque"
				if request.Extra["transparentBackground"] == "true" {
					background = "transparent"
				}
				mapped[name] = set("background", background)
			}
		} else if gemini {
			switch name {
			case "size":
				if request.AspectRatio != "" && request.AspectRatio != "auto" {
					mapped[name] = set("generationConfig.imageConfig.aspectRatio", request.AspectRatio)
				}
			case "imageResolution":
				if request.Resolution != "" && request.Resolution != "auto" {
					mapped[name] = set("generationConfig.imageConfig.imageSize", strings.ToUpper(request.Resolution))
				}
			}
		}
	}
	for name := range names {
		field, common := CommonImageParameter(name)
		if !common || mapped[name] {
			continue
		}
		value := request.ImageParameters[name]
		if name == "size" {
			value = request.AspectRatio
		}
		if value == nil || value == "" || value == "auto" || value == false || (name == "count" && request.ImageCount <= 1) {
			continue
		}
		path := "request." + field.Binding
		if name == "transparentBackground" {
			path = "request.extra.transparentBackground"
		}
		if manifestConsumesImageValue(operation, path, "request.imageParameters."+name) {
			continue
		}
		// A pixel preset already incorporates resolution into the actual size.
		if name == "imageResolution" && strings.Contains(request.AspectRatio, "x") && (mapped["size"] || manifestConsumesImageValue(operation, "request.aspectRatio")) {
			continue
		}
		return RequestSpec{}, fmt.Errorf("图片参数 %s 缺少当前协议的可执行映射", name)
	}
	return spec, nil
}

func manifestDeclaresImageField(operation ManifestOperation, path string) bool {
	if _, exists := operation.Fields[path]; exists && operation.Body == nil {
		return true
	}
	var contains func(any, []string) bool
	contains = func(value any, parts []string) bool {
		if len(parts) == 0 {
			return true
		}
		node, ok := value.(map[string]any)
		if !ok {
			return false
		}
		if child, exists := node[parts[0]]; exists && contains(child, parts[1:]) {
			return true
		}
		if conditional, ok := node["$if"].(map[string]any); ok && (contains(conditional["then"], parts) || contains(conditional["else"], parts)) {
			return true
		}
		if merged, ok := node["$merge"].([]any); ok {
			for _, child := range merged {
				if contains(child, parts) {
					return true
				}
			}
		}
		if child, exists := node["$omitEmpty"]; exists {
			return contains(child, parts)
		}
		return false
	}
	return contains(operation.Body, strings.Split(path, "."))
}

func manifestConsumesImageValue(operation ManifestOperation, paths ...string) bool {
	var consumes func(any) bool
	consumes = func(value any) bool {
		switch node := value.(type) {
		case map[string]any:
			if ref, ok := node["$ref"].(string); ok {
				for _, path := range paths {
					if ref == path {
						return true
					}
				}
			}
			for _, child := range node {
				if consumes(child) {
					return true
				}
			}
		case []any:
			for _, child := range node {
				if consumes(child) {
					return true
				}
			}
		case string:
			trimmed := strings.TrimSpace(node)
			if strings.HasPrefix(trimmed, "${") && strings.HasSuffix(trimmed, "}") {
				ref := strings.TrimSpace(trimmed[2 : len(trimmed)-1])
				for _, path := range paths {
					if ref == path {
						return true
					}
				}
			}
		}
		return false
	}
	if consumes(operation.Body) || consumes(operation.Query) {
		return true
	}
	if operation.Body == nil {
		for _, field := range operation.Fields {
			ref := strings.TrimSpace(strings.SplitN(field, "|", 2)[0])
			for _, path := range paths {
				if ref == path {
					return true
				}
			}
		}
	}
	return false
}
