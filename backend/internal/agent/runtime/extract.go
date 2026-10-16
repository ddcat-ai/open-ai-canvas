package runtime

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// extractArchive 把压缩包解到 target。先解到同级临时目录再原子改名，
// 中途失败不会留下一个「看起来已安装」的半成品目录。
func extractArchive(archive, target string, strip int) error {
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("创建运行时目录失败：%w", err)
	}
	temp, err := os.MkdirTemp(parent, ".unpack-*")
	if err != nil {
		return fmt.Errorf("创建临时目录失败：%w", err)
	}
	defer os.RemoveAll(temp)

	if strings.HasSuffix(strings.ToLower(archive), ".zip") {
		err = extractZip(temp, archive, strip)
	} else {
		err = extractTarGz(temp, archive, strip)
	}
	if err != nil {
		return err
	}
	if _, err := os.Stat(target); err == nil {
		// 另一个进程刚装好同一个版本：保留已有结果。
		return nil
	}
	if err := os.Rename(temp, target); err != nil {
		if _, statErr := os.Stat(target); statErr == nil {
			return nil
		}
		return fmt.Errorf("安装运行时到 %s 失败：%w", target, err)
	}
	return nil
}

func extractTarGz(dst, archive string, strip int) error {
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer file.Close()
	gz, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("读取 %s 失败：%w", filepath.Base(archive), err)
	}
	defer gz.Close()

	reader := tar.NewReader(gz)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("读取 %s 失败：%w", filepath.Base(archive), err)
		}
		name, ok := stripArchivePath(header.Name, strip)
		if !ok {
			continue
		}
		target, err := archiveTarget(dst, name)
		if err != nil {
			return err
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, dirMode(header.FileInfo().Mode())); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := writeArchiveFile(target, reader, header.FileInfo().Mode()); err != nil {
				return err
			}
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			// npm 的 .bin 入口是相对符号链接，必须原样保留。
			if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err := os.Symlink(header.Linkname, target); err != nil {
				return fmt.Errorf("创建符号链接 %s 失败：%w", name, err)
			}
		case tar.TypeLink:
			link, ok := stripArchivePath(header.Linkname, strip)
			if !ok {
				continue
			}
			source, err := archiveTarget(dst, link)
			if err != nil {
				return err
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			if err := os.Link(source, target); err != nil {
				return fmt.Errorf("创建硬链接 %s 失败：%w", name, err)
			}
		}
	}
}

func extractZip(dst, archive string, strip int) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return fmt.Errorf("读取 %s 失败：%w", filepath.Base(archive), err)
	}
	defer reader.Close()

	for _, entry := range reader.File {
		name, ok := stripArchivePath(entry.Name, strip)
		if !ok {
			continue
		}
		target, err := archiveTarget(dst, name)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, dirMode(entry.Mode())); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		source, err := entry.Open()
		if err != nil {
			return fmt.Errorf("读取 %s 失败：%w", entry.Name, err)
		}
		link := ""
		if entry.Mode()&os.ModeSymlink != 0 {
			body, readErr := io.ReadAll(io.LimitReader(source, 4096))
			source.Close()
			if readErr != nil {
				return readErr
			}
			link = string(body)
		}
		if link != "" {
			if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			if err := os.Symlink(link, target); err != nil {
				return fmt.Errorf("创建符号链接 %s 失败：%w", name, err)
			}
			continue
		}
		err = writeArchiveFile(target, source, entry.Mode())
		source.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// stripArchivePath 归一化归档内路径、丢弃前 strip 层目录，并挡掉绝对路径、
// ".." 与 NUL——zip/tar 条目名是外部输入，不能直接当本地路径用。
func stripArchivePath(name string, strip int) (string, bool) {
	name = strings.ReplaceAll(name, "\\", "/")
	if name == "" || strings.ContainsRune(name, 0) {
		return "", false
	}
	cleaned := path.Clean(name)
	if cleaned == "." || path.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return "", false
	}
	parts := strings.Split(cleaned, "/")
	if len(parts) <= strip {
		return "", false
	}
	return path.Join(parts[strip:]...), true
}

func archiveTarget(dst, name string) (string, error) {
	target := filepath.Join(dst, filepath.FromSlash(name))
	relative, err := filepath.Rel(dst, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("归档路径越界：%s", name)
	}
	return target, nil
}

func writeArchiveFile(target string, reader io.Reader, mode os.FileMode) error {
	file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, execMode(mode))
	if err != nil {
		return err
	}
	if _, err := io.Copy(file, reader); err != nil {
		file.Close()
		return err
	}
	return file.Close()
}

func dirMode(mode os.FileMode) os.FileMode {
	if perm := mode.Perm(); perm != 0 {
		return perm | 0o700
	}
	return 0o755
}

func execMode(mode os.FileMode) os.FileMode {
	if perm := mode.Perm(); perm != 0 {
		return perm
	}
	return 0o644
}
