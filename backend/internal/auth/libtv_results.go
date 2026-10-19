package auth

import (
	"math"
	"strings"
)

// Resource metadata follows the original URL indices, even after invalid URLs are skipped.
func libTVImportMediaResults(kind string, urls []string, resources libTVTemplateResourceMeta, validateURL func(string) string) []LibTVMediaResult {
	results := make([]LibTVMediaResult, 0, len(urls))
	for index, raw := range urls {
		content := validateURL(raw)
		if content == "" {
			continue
		}
		item := LibTVMediaResult{SourceIndex: index, Content: content}
		if index < len(resources.Items) {
			resource := resources.Items[index]
			item.NaturalWidth, item.NaturalHeight = max(0, resource.Width), max(0, resource.Height)
			if libTVFinite(resource.DurationSec) && resource.DurationSec > 0 && resource.DurationSec <= 36000 {
				item.DurationMs = int64(math.Round(resource.DurationSec * 1000))
			}
			if strings.HasPrefix(resource.MimeType, kind+"/") {
				item.MimeType = resource.MimeType
			}
		}
		if item.MimeType == "" {
			item.MimeType = inferTapNowMime(kind, content, "")
		}
		results = append(results, item)
	}
	return results
}

func libTVSetPrimaryMedia(node *LibTVCanvasNode) {
	if len(node.Results) == 0 {
		return
	}
	primary := node.Results[0]
	node.Content, node.NaturalWidth, node.NaturalHeight = primary.Content, primary.NaturalWidth, primary.NaturalHeight
	node.DurationMs, node.MimeType = primary.DurationMs, primary.MimeType
}
