package main

import (
	"os"
	"path/filepath"
)

// Resolve existing parent links before creating a new data directory. This
// prevents a link outside the release from secretly placing data inside it.
func resolveDataPath(p string) (string, error) {
	var missing []string
	for {
		resolved, err := filepath.EvalSymlinks(p)
		if err == nil {
			for i := len(missing) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, missing[i])
			}
			return resolved, nil
		}
		if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(p)
		if parent == p {
			return "", err
		}
		missing = append(missing, filepath.Base(p))
		p = parent
	}
}
