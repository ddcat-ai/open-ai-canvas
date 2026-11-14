package app

import (
	"regexp"
	"strings"
)

const liteRemoteProviderPrefix = "peekreel-lite:"

var liteRemoteChannelIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,48}$`)

func isLiteRemoteProviderID(value string) bool {
	_, ok := liteRemoteChannelID(value)
	return ok
}

func liteRemoteChannelID(value string) (string, bool) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, liteRemoteProviderPrefix) {
		return "", false
	}
	id := strings.TrimPrefix(value, liteRemoteProviderPrefix)
	return id, liteRemoteChannelIDPattern.MatchString(id)
}
