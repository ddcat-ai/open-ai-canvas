package hostupdate

import (
	"strconv"
	"strings"
)

type versionPart struct {
	core []int
	pre  []string
}

func IsReleaseVersion(raw string) bool {
	_, ok := parseVersion(raw)
	return ok
}

func CompareVersions(left, right string) int {
	a, aok := parseVersion(left)
	b, bok := parseVersion(right)
	if aok && bok {
		return compareParsedVersions(a, b)
	}
	// sha-5509b17、latest 等非正式标签不能按字典序和 v1.5.0 比，否则会被当成更新而不让升级。
	if !aok && bok {
		return -1
	}
	if aok && !bok {
		return 1
	}
	return strings.Compare(strings.TrimSpace(left), strings.TrimSpace(right))
}

func compareParsedVersions(a, b versionPart) int {
	for index := 0; index < len(a.core) || index < len(b.core); index++ {
		left, right := 0, 0
		if index < len(a.core) {
			left = a.core[index]
		}
		if index < len(b.core) {
			right = b.core[index]
		}
		if left < right {
			return -1
		}
		if left > right {
			return 1
		}
	}
	if len(a.pre) == 0 && len(b.pre) > 0 {
		return 1
	}
	if len(a.pre) > 0 && len(b.pre) == 0 {
		return -1
	}
	for index := 0; index < len(a.pre) || index < len(b.pre); index++ {
		if index >= len(a.pre) {
			return -1
		}
		if index >= len(b.pre) {
			return 1
		}
		if compared := comparePreIdentifier(a.pre[index], b.pre[index]); compared != 0 {
			return compared
		}
	}
	return 0
}

// comparePreIdentifier 比较单个预发布标识符。
// 纯数字按数值比较；形如 r10 / r9 的「字母前缀 + 数字后缀」先比前缀再比数值，
// 否则字典序会把 r10 判成小于 r9，导致 r10 这类版本被更新页面当作旧版本而无法升级。
func comparePreIdentifier(left, right string) int {
	leftNumber, leftErr := strconv.Atoi(left)
	rightNumber, rightErr := strconv.Atoi(right)
	switch {
	case leftErr == nil && rightErr == nil:
		return compareInts(leftNumber, rightNumber)
	case leftErr == nil && rightErr != nil:
		return -1
	case leftErr != nil && rightErr == nil:
		return 1
	}
	leftPrefix, leftDigits := splitTrailingDigits(left)
	rightPrefix, rightDigits := splitTrailingDigits(right)
	if compared := strings.Compare(leftPrefix, rightPrefix); compared != 0 {
		return compared
	}
	switch {
	case leftDigits == "" && rightDigits == "":
		return strings.Compare(left, right)
	case leftDigits == "":
		return -1
	case rightDigits == "":
		return 1
	}
	leftValue, leftOK := strconv.Atoi(leftDigits)
	rightValue, rightOK := strconv.Atoi(rightDigits)
	if leftOK == nil && rightOK == nil {
		return compareInts(leftValue, rightValue)
	}
	return strings.Compare(leftDigits, rightDigits)
}

// splitTrailingDigits 把 "r10" 拆成 ("r", "10")；没有数字后缀时返回 ("r10", "")。
func splitTrailingDigits(value string) (string, string) {
	index := len(value)
	for index > 0 {
		character := value[index-1]
		if character < '0' || character > '9' {
			break
		}
		index--
	}
	return value[:index], value[index:]
}

func compareInts(left, right int) int {
	switch {
	case left < right:
		return -1
	case left > right:
		return 1
	default:
		return 0
	}
}

func parseVersion(raw string) (versionPart, bool) {
	value := strings.TrimPrefix(strings.TrimSpace(raw), "v")
	value = strings.SplitN(value, "+", 2)[0]
	parts := strings.SplitN(value, "-", 2)
	core := strings.Split(parts[0], ".")
	if len(core) < 3 {
		return versionPart{}, false
	}
	coreNumbers := make([]int, len(core))
	for index, value := range core {
		number, err := strconv.Atoi(value)
		if err != nil {
			return versionPart{}, false
		}
		coreNumbers[index] = number
	}
	parsed := versionPart{core: coreNumbers}
	if len(parts) == 2 && parts[1] != "" {
		parsed.pre = strings.FieldsFunc(parts[1], func(r rune) bool { return r == '.' || r == '-' })
	}
	return parsed, true
}
