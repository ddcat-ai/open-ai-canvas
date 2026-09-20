package assets

import "strings"

func FileURL(id string) string {
	return "/api/resources/" + id + "/file"
}

func IsFileURL(value string) bool {
	return IDFromFileURL(value) != ""
}

func IDFromFileURL(value string) string {
	const prefix = "/api/resources/"
	value = strings.TrimSpace(value)
	index := strings.Index(value, prefix)
	if index < 0 {
		return ""
	}
	remainder := value[index+len(prefix):]
	if remainder == "" {
		return ""
	}
	if end := strings.IndexAny(remainder, "/?#"); end >= 0 {
		remainder = remainder[:end]
	}
	return remainder
}

func ResourceID(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "resource:") {
		return ValidID(strings.TrimPrefix(value, "resource:"))
	}
	return ValidID(IDFromFileURL(value))
}

func ValidID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 80 {
		return ""
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return ""
		}
	}
	return value
}
