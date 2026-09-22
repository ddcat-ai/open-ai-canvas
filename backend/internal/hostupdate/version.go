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
		an, aerr := strconv.Atoi(a.pre[index])
		bn, berr := strconv.Atoi(b.pre[index])
		switch {
		case aerr == nil && berr == nil && an < bn:
			return -1
		case aerr == nil && berr == nil && an > bn:
			return 1
		case aerr == nil && berr != nil:
			return -1
		case aerr != nil && berr == nil:
			return 1
		case a.pre[index] < b.pre[index]:
			return -1
		case a.pre[index] > b.pre[index]:
			return 1
		}
	}
	return 0
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
