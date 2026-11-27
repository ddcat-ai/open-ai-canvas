// Package backup builds portable full-database archives. It never restores over
// the running database; recovery is performed offline into an empty instance.
package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

type Manifest struct {
	Version      int       `json:"version"`
	Database     string    `json:"database"`
	DatabaseFile string    `json:"databaseFile"`
	CreatedAt    time.Time `json:"createdAt"`
	Tables       []string  `json:"tables"`
	Files        []string  `json:"files"`
	Exclusions   []string  `json:"exclusions"`
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func Archive(ctx context.Context, output io.Writer, snapshot, dataDir string, manifest Manifest) error {
	gz := gzip.NewWriter(output)
	tw := tar.NewWriter(gz)
	add := func(source, name string) error {
		info, err := os.Lstat(source)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("备份文件必须是普通文件，不能是符号链接")
		}
		file, err := os.Open(source)
		if err != nil {
			return err
		}
		defer file.Close()
		opened, err := file.Stat()
		if err != nil {
			return err
		}
		if !os.SameFile(info, opened) {
			return errors.New("备份文件在读取时发生变化")
		}
		mode := int64(0600)
		if info.Mode().Perm()&0111 != 0 {
			mode = 0700
		}
		if err = tw.WriteHeader(&tar.Header{Name: name, Mode: mode, Size: info.Size(), ModTime: info.ModTime()}); err != nil {
			return err
		}
		if _, err = io.CopyN(tw, contextReader{ctx, file}, info.Size()); err != nil {
			return err
		}
		manifest.Files = append(manifest.Files, name)
		return nil
	}
	if err := add(snapshot, manifest.DatabaseFile); err != nil {
		return err
	}
	// Database-encrypted credentials require this key after moving servers.
	// Plugin files are not fully represented by the database.
	for _, relative := range []string{".settings-key", "plugin_registry.json", "plugin-packages"} {
		root := filepath.Join(dataDir, relative)
		if _, err := os.Lstat(root); os.IsNotExist(err) {
			if relative == ".settings-key" {
				return errors.New("配置解密文件缺失，备份已停止")
			}
			continue
		} else if err != nil {
			return err
		}
		if err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				return nil
			}
			name, err := filepath.Rel(dataDir, path)
			if err != nil {
				return err
			}
			return add(path, "data/"+filepath.ToSlash(name))
		}); err != nil {
			return err
		}
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = tw.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(data))}); err != nil {
		return err
	}
	if _, err = tw.Write(data); err != nil {
		return err
	}
	if err = tw.Close(); err != nil {
		return err
	}
	return gz.Close()
}
