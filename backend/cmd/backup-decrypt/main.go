// backup-decrypt verifies an archive before publishing the decrypted tar.gz.
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"yingce/backend/internal/backup"
)

func run() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("用法: BACKUP_RECOVERY_PASSWORD=... backup-decrypt 输入.ycbk 输出.tar.gz")
	}
	src, err := os.Open(os.Args[1])
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.CreateTemp(filepath.Dir(os.Args[2]), ".backup-decrypt-*")
	if err != nil {
		return err
	}
	defer os.Remove(dst.Name())
	defer dst.Close()
	if err = backup.Decrypt(dst, src, os.Getenv("BACKUP_RECOVERY_PASSWORD")); err != nil {
		return err
	}
	if err = dst.Sync(); err != nil {
		return err
	}
	if err = dst.Close(); err != nil {
		return err
	}
	// Do not overwrite an existing recovery artifact.
	return os.Link(dst.Name(), os.Args[2])
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
