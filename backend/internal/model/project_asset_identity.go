package model

import (
	"strings"
	"unicode"
)

// AssetCandidateNameKey removes presentation differences from a candidate name.
// The key is only an identity guard; the original name remains the display value.
func AssetCandidateNameKey(value string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			return unicode.ToLower(r)
		}
		return -1
	}, strings.TrimSpace(value))
}
