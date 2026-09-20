package protocol

import (
	"bytes"
	"debug/buildinfo"
	"debug/elf"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
)

var officialPaymentPackageIDs = []string{
	"official-payment-wechat-native",
	"official-payment-alipay-page",
	"official-payment-xunhupay",
	"official-payment-zhifufm",
	"official-payment-epay",
}

var officialPaymentTaggedArtifacts = []string{
	"backend/provider-linux-amd64",
	"backend/provider-linux-arm64",
	"backend/provider-darwin-amd64",
	"backend/provider-darwin-arm64",
	"backend/provider-windows-amd64.exe",
	"backend/provider-windows-arm64.exe",
}

func TestOfficialPaymentArtifactsAreCanonicalLinuxAMD64(t *testing.T) {
	for _, packageID := range officialPaymentPackageIDs {
		t.Run(packageID, func(t *testing.T) {
			root := filepath.Join("..", "..", "..", "plugin-packages")
			providerPath := filepath.Join(root, packageID, "backend", "provider")
			directoryProvider, err := os.ReadFile(providerPath)
			if err != nil {
				t.Fatal(err)
			}
			packageData, err := os.ReadFile(filepath.Join(root, packageID+".yingce-plugin"))
			if err != nil {
				t.Fatal(err)
			}
			pkg, err := ParsePluginPackage(packageData)
			if err != nil {
				t.Fatal(err)
			}
			packagedProvider := pkg.Files["backend/provider"]
			if !bytes.Equal(directoryProvider, packagedProvider) {
				t.Fatal("directory provider differs from .yingce-plugin backend/provider")
			}
			linuxAMD64 := pkg.Files["backend/provider-linux-amd64"]
			if !bytes.Equal(directoryProvider, linuxAMD64) {
				t.Fatal("canonical backend/provider differs from backend/provider-linux-amd64")
			}
			binary, err := elf.NewFile(bytes.NewReader(directoryProvider))
			if err != nil {
				t.Fatalf("provider is not ELF: %v", err)
			}
			if binary.Class != elf.ELFCLASS64 || binary.Machine != elf.EM_X86_64 {
				t.Fatalf("provider ELF = class %s machine %s, want 64-bit x86-64", binary.Class, binary.Machine)
			}
			info, err := buildinfo.Read(bytes.NewReader(directoryProvider))
			if err != nil {
				t.Fatalf("read provider build info: %v", err)
			}
			settings := make(map[string]string, len(info.Settings))
			for _, setting := range info.Settings {
				settings[setting.Key] = setting.Value
			}
			if settings["GOOS"] != "linux" || settings["GOARCH"] != "amd64" || settings["CGO_ENABLED"] != "0" {
				t.Fatalf("provider build settings = GOOS=%s GOARCH=%s CGO_ENABLED=%s", settings["GOOS"], settings["GOARCH"], settings["CGO_ENABLED"])
			}

			for _, name := range officialPaymentTaggedArtifacts {
				directoryTagged, err := os.ReadFile(filepath.Join(root, packageID, filepath.FromSlash(name)))
				if err != nil {
					t.Fatalf("missing directory artifact %s: %v", name, err)
				}
				packagedTagged := pkg.Files[name]
				if !bytes.Equal(directoryTagged, packagedTagged) {
					t.Fatalf("directory %s differs from packaged artifact", name)
				}
				taggedInfo, err := buildinfo.Read(bytes.NewReader(directoryTagged))
				if err != nil {
					t.Fatalf("read %s build info: %v", name, err)
				}
				taggedSettings := make(map[string]string, len(taggedInfo.Settings))
				for _, setting := range taggedInfo.Settings {
					taggedSettings[setting.Key] = setting.Value
				}
				wantOS, wantArch := expectedPaymentArtifactPlatform(name)
				if taggedSettings["GOOS"] != wantOS || taggedSettings["GOARCH"] != wantArch || taggedSettings["CGO_ENABLED"] != "0" {
					t.Fatalf("%s build settings = GOOS=%s GOARCH=%s CGO_ENABLED=%s", name, taggedSettings["GOOS"], taggedSettings["GOARCH"], taggedSettings["CGO_ENABLED"])
				}
			}

			if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
				smokePaymentProvider(t, providerPath)
				return
			}
			hostCandidates := PaymentRPCBackendCandidates("backend/provider", runtime.GOOS, runtime.GOARCH)
			if len(hostCandidates) == 0 {
				t.Fatalf("no RPC candidates for %s/%s", runtime.GOOS, runtime.GOARCH)
			}
			hostArtifact := hostCandidates[0]
			hostPath := filepath.Join(root, packageID, filepath.FromSlash(hostArtifact))
			if _, err := os.Stat(hostPath); err != nil {
				t.Fatalf("host artifact %s is missing: %v", hostArtifact, err)
			}
			if runtime.GOOS != "windows" {
				smokePaymentProvider(t, hostPath)
			}
		})
	}
}

func expectedPaymentArtifactPlatform(name string) (string, string) {
	switch name {
	case "backend/provider-linux-amd64":
		return "linux", "amd64"
	case "backend/provider-linux-arm64":
		return "linux", "arm64"
	case "backend/provider-darwin-amd64":
		return "darwin", "amd64"
	case "backend/provider-darwin-arm64":
		return "darwin", "arm64"
	case "backend/provider-windows-amd64.exe":
		return "windows", "amd64"
	case "backend/provider-windows-arm64.exe":
		return "windows", "arm64"
	default:
		return "", ""
	}
}

func smokePaymentProvider(t *testing.T, providerPath string) {
	t.Helper()
	fileInfo, err := os.Stat(providerPath)
	if err != nil {
		t.Fatal(err)
	}
	if fileInfo.Mode().Perm()&0o111 == 0 {
		t.Fatal("provider is not executable")
	}
	command := exec.Command(providerPath)
	command.Stdin = bytes.NewBufferString("invalid-json\n")
	output, err := command.Output()
	if err != nil {
		t.Fatalf("provider smoke test failed: %v", err)
	}
	var response struct {
		OK   bool   `json:"ok"`
		Code string `json:"code"`
	}
	if err := json.Unmarshal(output, &response); err != nil {
		t.Fatalf("provider smoke response is invalid JSON: %v", err)
	}
	if response.OK || response.Code != "invalid_request" {
		t.Fatalf("provider smoke response = %s", output)
	}
}
