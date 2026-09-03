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

func TestOfficialPaymentArtifactsAreCanonicalLinuxAMD64(t *testing.T) {
	for _, packageID := range []string{"official-payment-wechat-native", "official-payment-alipay-page"} {
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

			if runtime.GOOS == "linux" && runtime.GOARCH == "amd64" {
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
		})
	}
}
