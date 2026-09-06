package protocol

import (
	"encoding/base64"
	"strings"
)

// Only inline raster images are accepted. Prose, links and HTML must not become
// downloadable results, and provider text must never be echoed in an error.
func markdownDataImages(text string) []any {
	images := make([]any, 0)
	seen := map[string]bool{}
	for _, match := range manifestMDImageRegex.FindAllStringSubmatch(text, 32) {
		value := match[1]
		header, payload, ok := strings.Cut(value, ",")
		if !ok || payload == "" || seen[value] {
			continue
		}
		switch header {
		case "data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64", "data:image/gif;base64":
		default:
			continue
		}
		if _, err := base64.StdEncoding.Strict().DecodeString(payload); err != nil {
			continue
		}
		seen[value] = true
		images = append(images, map[string]any{"dataUrl": value})
	}
	return images
}
