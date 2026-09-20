package prompts

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

//go:embed agent-system-policy.md agent-media-policy.md
var policyFiles embed.FS

type Policy struct {
	ID      string
	Version int
	Text    string
	Hash    string
}

func LoadAgentPolicies() (system Policy, media Policy, err error) {
	system, err = loadPolicy("agent-system-policy.md")
	if err != nil {
		return Policy{}, Policy{}, err
	}
	media, err = loadPolicy("agent-media-policy.md")
	if err != nil {
		return Policy{}, Policy{}, err
	}
	if system.ID != "cloud-agent-system" || media.ID != "cloud-agent-media" {
		return Policy{}, Policy{}, fmt.Errorf("agent policy identities are invalid")
	}
	return system, media, nil
}

func loadPolicy(path string) (Policy, error) {
	data, err := policyFiles.ReadFile(path)
	if err != nil {
		return Policy{}, fmt.Errorf("read agent policy %s: %w", path, err)
	}
	id, version, text, err := parsePolicyDocument(string(data))
	if err != nil {
		return Policy{}, fmt.Errorf("parse agent policy %s: %w", path, err)
	}
	normalized := fmt.Sprintf("id:%s\nversion:%d\n%s", id, version, text)
	sum := sha256.Sum256([]byte(normalized))
	return Policy{ID: id, Version: version, Text: text, Hash: hex.EncodeToString(sum[:])}, nil
}

func parsePolicyDocument(raw string) (string, int, string, error) {
	raw = strings.TrimSpace(raw)
	lines := strings.Split(raw, "\n")
	if len(lines) < 4 || strings.TrimSpace(lines[0]) != "---" {
		return "", 0, "", fmt.Errorf("missing metadata header")
	}
	end := -1
	metadata := map[string]string{}
	for index := 1; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		if line == "---" {
			end = index
			break
		}
		key, value, ok := strings.Cut(line, ":")
		key, value = strings.TrimSpace(key), strings.TrimSpace(value)
		if !ok || key == "" || value == "" {
			return "", 0, "", fmt.Errorf("invalid metadata line %q", line)
		}
		if key != "id" && key != "version" {
			return "", 0, "", fmt.Errorf("unsupported metadata field %q", key)
		}
		if _, exists := metadata[key]; exists {
			return "", 0, "", fmt.Errorf("duplicate metadata field %q", key)
		}
		metadata[key] = value
	}
	if end < 0 {
		return "", 0, "", fmt.Errorf("metadata header is not closed")
	}
	id := metadata["id"]
	if id == "" {
		return "", 0, "", fmt.Errorf("policy id is required")
	}
	version, err := strconv.Atoi(metadata["version"])
	if err != nil || version <= 0 {
		return "", 0, "", fmt.Errorf("policy version must be a positive integer")
	}
	text := strings.TrimSpace(strings.Join(lines[end+1:], "\n"))
	if text == "" {
		return "", 0, "", fmt.Errorf("policy body is empty")
	}
	return id, version, text, nil
}
