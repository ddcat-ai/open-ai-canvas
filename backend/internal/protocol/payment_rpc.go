package protocol

import (
	"path"
	"strings"
)

func PaymentRPCBackendCandidates(entry, goos, goarch string) []string {
	entry = strings.TrimSuffix(strings.TrimSpace(entry), ".exe")
	goos = strings.TrimSpace(goos)
	goarch = strings.TrimSpace(goarch)
	if entry == "" || goos == "" || goarch == "" || path.Clean(entry) != entry || !strings.HasPrefix(entry, "backend/") {
		return nil
	}
	base := path.Base(entry)
	dir := path.Dir(entry)
	tagged := entry + "-" + goos + "-" + goarch
	nested := dir + "/" + goos + "-" + goarch + "/" + base
	candidates := make([]string, 0, 6)
	if goos == "windows" {
		candidates = append(candidates, tagged+".exe", nested+".exe", entry+".exe")
	}
	candidates = append(candidates, tagged, nested, entry)
	return uniqueStrings(candidates)
}

func HasAnyPaymentRPCBackend(entry string, files map[string][]byte) bool {
	entry = strings.TrimSuffix(strings.TrimSpace(entry), ".exe")
	if entry == "" {
		return false
	}
	if _, ok := files[entry]; ok {
		return true
	}
	if _, ok := files[entry+".exe"]; ok {
		return true
	}
	prefix := entry + "-"
	nestedRoot := path.Dir(entry) + "/"
	base := path.Base(entry)
	for name := range files {
		if strings.HasPrefix(name, prefix) {
			return true
		}
		rest, ok := strings.CutPrefix(name, nestedRoot)
		if !ok {
			continue
		}
		slash := strings.IndexByte(rest, '/')
		if slash <= 0 {
			continue
		}
		leaf := rest[slash+1:]
		if leaf == base || leaf == base+".exe" {
			return true
		}
	}
	return false
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
