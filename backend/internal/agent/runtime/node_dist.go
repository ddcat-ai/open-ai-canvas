package runtime

import (
	"fmt"
	"strconv"
	"strings"
)

// pinnedNodeVersion 是自动安装时的默认 Node 版本。pi 运行时要求 node >= 22.19.0
// （见 backend/agent-runtime/pi/package.json 的 engines 字段），这里取本机开发版本。
const pinnedNodeVersion = "22.22.2"

const defaultNodeDistBase = "https://nodejs.org/dist"

// nodeAsset 是一个平台对应的官方 Node 分发包。
type nodeAsset struct {
	Version string
	Name    string
	URL     string
	SumsURL string
	// Strip 是解包时丢弃的目录层数：官方包最外层固定是 node-v<version>-<os>-<arch>。
	Strip int
}

// nodeAssetFor 把 GOOS/GOARCH 映射到官方分发包命名。只有官方确实提供预编译包的
// 组合才返回结果，其余组合直接失败，不去猜一个不存在的地址。
func nodeAssetFor(goos, goarch, version, base string) (nodeAsset, error) {
	platform := ""
	suffix := ""
	switch goos {
	case "darwin", "linux":
		platform, suffix = goos, "tar.gz"
	case "windows":
		platform, suffix = "win", "zip"
	default:
		return nodeAsset{}, fmt.Errorf("自动安装 node 不支持 %s：请安装 Node %s+ 或设置 %s", goos, pinnedNodeVersion, envNodeBin)
	}
	switch goarch {
	case "amd64":
		platform += "-x64"
	case "arm64":
		platform += "-arm64"
	default:
		return nodeAsset{}, fmt.Errorf("自动安装 node 不支持 %s/%s：请安装 Node %s+ 或设置 %s", goos, goarch, pinnedNodeVersion, envNodeBin)
	}
	if !isVersionLiteral(version) {
		return nodeAsset{}, fmt.Errorf("CANVAS_NODE_VERSION 不是合法版本号：%q", version)
	}

	base = strings.TrimRight(strings.TrimSpace(base), "/")
	if base == "" {
		base = defaultNodeDistBase
	}
	dir := fmt.Sprintf("%s/v%s", base, version)
	name := fmt.Sprintf("node-v%s-%s.%s", version, platform, suffix)
	return nodeAsset{
		Version: version,
		Name:    name,
		URL:     dir + "/" + name,
		SumsURL: dir + "/SHASUMS256.txt",
		Strip:   1,
	}, nil
}

// isVersionLiteral 只接受点分十进制，避免把外部字符串拼进下载地址。
func isVersionLiteral(version string) bool {
	if version == "" || len(version) > 32 {
		return false
	}
	for _, part := range strings.Split(version, ".") {
		if part == "" {
			return false
		}
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

// nodeBinaryRelPath 是解包后 node 可执行文件相对版本目录的位置。
// 官方 tar.gz 放在 bin/ 下，Windows 的 zip 则直接在版本目录根上。
func nodeBinaryRelPath(goos string) string {
	if goos == "windows" {
		return "node.exe"
	}
	return "bin/node"
}
