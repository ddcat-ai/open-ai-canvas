//go:build windows

package hostupdate

// checkBackupDiskSpace 在 Windows 本地开发环境跳过磁盘空间预检。
// 磁盘预检仅服务 Linux 服务器部署时的在线更新器，Windows 本地开发用不到。
func checkBackupDiskSpace(directory string) error {
	return nil
}
