package app

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"io/fs"
	"sort"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/buildinfo"
)

// Embedded under backend/ so every existing production Docker build includes it.
//
//go:embed admin_assistant_skill
var assistantSkillFS embed.FS
var assistantSkillOnce sync.Once
var assistantSkillData []byte
var assistantSkillRelease AssistantSkillManifest
var assistantSkillError error

type AssistantSkillManifest struct {
	Name          string `json:"name"`
	Version       string `json:"version"`
	ServerVersion string `json:"serverVersion"`
	APIVersion    int    `json:"apiVersion"`
	SHA256        string `json:"sha256"`
	Size          int    `json:"size"`
	DownloadURL   string `json:"downloadUrl"`
}

func AssistantSkillPackage() (AssistantSkillManifest, []byte, error) {
	assistantSkillOnce.Do(func() {
		names := []string{}
		assistantSkillError = fs.WalkDir(assistantSkillFS, "admin_assistant_skill", func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() {
				names = append(names, path)
			}
			return nil
		})
		if assistantSkillError != nil {
			return
		}
		sort.Strings(names)
		var buf bytes.Buffer
		w := zip.NewWriter(&buf)
		for _, name := range names {
			data, err := assistantSkillFS.ReadFile(name)
			if err != nil {
				assistantSkillError = err
				return
			}
			h := &zip.FileHeader{Name: "canvas-admin/" + strings.TrimPrefix(name, "admin_assistant_skill/"), Method: zip.Deflate}
			h.SetModTime(time.Date(1980, 1, 1, 0, 0, 0, 0, time.UTC))
			h.SetMode(0644)
			entry, err := w.CreateHeader(h)
			if err != nil {
				assistantSkillError = err
				return
			}
			if _, err = entry.Write(data); err != nil {
				assistantSkillError = err
				return
			}
		}
		if err := w.Close(); err != nil {
			assistantSkillError = err
			return
		}
		assistantSkillData = buf.Bytes()
		hash := sha256.Sum256(assistantSkillData)
		digest := hex.EncodeToString(hash[:])
		version := digest[:16]
		assistantSkillRelease = AssistantSkillManifest{Name: "canvas-admin", Version: version, ServerVersion: buildinfo.Current().Version, APIVersion: 1, SHA256: digest, Size: len(assistantSkillData), DownloadURL: AssistantAPIPath + "/skill/releases/" + version + ".zip"}
	})
	return assistantSkillRelease, assistantSkillData, assistantSkillError
}
