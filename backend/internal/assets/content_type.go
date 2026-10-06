package assets

import (
	"mime"
	"strings"
)

// InlineMediaType excludes active XML images such as SVG. Other documents and
// unknown formats remain uploadable, but must use controlled attachment delivery.
func InlineMediaType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	if err != nil || strings.HasSuffix(mediaType, "+xml") || mediaType == "image/svg" {
		return false
	}
	return strings.HasPrefix(mediaType, "image/") || strings.HasPrefix(mediaType, "audio/") || strings.HasPrefix(mediaType, "video/")
}
