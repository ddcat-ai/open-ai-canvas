//go:build !unix

package runtime

import "os"

// Unknown process liveness is treated as active; do not reclaim another owner's directory.
func runtimeProcessAlive(int) bool                 { return true }
func directoryOwnedByCurrentUser(os.FileInfo) bool { return true }
