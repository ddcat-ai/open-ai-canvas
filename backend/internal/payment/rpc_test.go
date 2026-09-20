package payment

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
)

func TestRPCProviderUsesPaymentV1Contract(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	dir := t.TempDir()
	entry := filepath.Join(dir, "provider")
	program := "#!/bin/sh\nread request\nprintf '%s\\n' '{\"ok\":true,\"data\":{\"mode\":\"qr_code\",\"value\":\"https://pay.example/qr\"}}'\n"
	if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin", CheckoutMode: "qr_code"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	provider.command = entry
	checkout, err := provider.CreateOrder(context.Background(), Config{"merchantId": "m"}, CreateRequest{MerchantOrderNo: "order-1"})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.Mode != "qr_code" || checkout.Value != "https://pay.example/qr" {
		t.Fatalf("checkout = %#v", checkout)
	}
}

func TestRPCProviderClassifiesExecutableStartFailures(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("executable error classification is asserted against Linux errno behavior")
	}
	tests := []struct {
		name    string
		content []byte
		mode    os.FileMode
		missing bool
		code    string
		message string
	}{
		{name: "missing", missing: true, code: "plugin_executable_missing", message: "支付插件可执行文件或其运行时加载器不可用"},
		{name: "missing-loader", content: []byte("#!/definitely/missing/payment-loader\n"), mode: 0o700, code: "plugin_executable_missing", message: "支付插件可执行文件或其运行时加载器不可用"},
		{name: "permission", content: []byte("#!/bin/sh\nexit 0\n"), mode: 0o600, code: "plugin_permission_denied", message: "支付插件没有执行权限"},
		{name: "mach-o", content: []byte{0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01}, mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
		{name: "windows-pe", content: []byte{'M', 'Z', 0x90, 0x00}, mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
		{name: "unknown-binary", content: []byte("not an executable\n"), mode: 0o700, code: "plugin_exec_format_error", message: "支付插件可执行文件与当前操作系统或 CPU 架构不兼容"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			entry := filepath.Join(dir, "backend", "provider")
			if !test.missing {
				if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(entry, test.content, test.mode); err != nil {
					t.Fatal(err)
				}
			}
			provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin"}, dir, "backend/provider")
			if err != nil {
				t.Fatal(err)
			}
			err = provider.ValidateConfig(Config{})
			var providerErr *ProviderError
			if !errors.As(err, &providerErr) {
				t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
			}
			if providerErr.Code != test.code || providerErr.Message != test.message || providerErr.Cause == nil {
				t.Fatalf("ProviderError = %#v, want code=%q message=%q with cause", providerErr, test.code, test.message)
			}
		})
	}
}

func TestRPCProviderRejectsIncompatibleFallbackBinary(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("linux already classifies foreign binaries in TestRPCProviderClassifiesExecutableStartFailures")
	}
	dir := t.TempDir()
	entry := filepath.Join(dir, "backend", "provider")
	if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte{0x7f, 'E', 'L', 'F', 0x02, 0x01, 0x01, 0x00}, 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	err = provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
	}
	if providerErr.Code != "plugin_exec_format_error" || providerErr.Message != "支付插件可执行文件与当前操作系统或 CPU 架构不兼容" {
		t.Fatalf("ProviderError = %#v", providerErr)
	}
}

func TestResolveRPCBackendPathPrefersHostTaggedBinary(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("tagged fallback uses a POSIX shell script")
	}
	dir := t.TempDir()
	backend := filepath.Join(dir, "backend")
	if err := os.MkdirAll(backend, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backend, "provider"), []byte{0x7f, 'E', 'L', 'F', 0x02, 0x01, 0x01, 0x00}, 0o700); err != nil {
		t.Fatal(err)
	}
	tagged := "provider-" + runtime.GOOS + "-" + runtime.GOARCH
	script := []byte("#!/bin/sh\nexit 0\n")
	if err := os.WriteFile(filepath.Join(backend, tagged), script, 0o700); err != nil {
		t.Fatal(err)
	}
	resolved, err := ResolveRPCBackendPath(dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(resolved) != tagged {
		t.Fatalf("resolved %q, want tagged %q", resolved, tagged)
	}
}

func TestRPCProviderStartsOfficialHostArtifact(t *testing.T) {
	artifact := "provider-" + runtime.GOOS + "-" + runtime.GOARCH
	if runtime.GOOS == "windows" {
		artifact += ".exe"
	}
	sourceDir := filepath.Join("..", "..", "..", "plugin-packages", "official-payment-xunhupay", "backend")
	hostBinary, err := os.ReadFile(filepath.Join(sourceDir, artifact))
	if err != nil {
		t.Fatalf("read host artifact: %v", err)
	}
	fallback, err := os.ReadFile(filepath.Join(sourceDir, "provider"))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	backend := filepath.Join(dir, "backend")
	if err := os.MkdirAll(backend, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backend, artifact), hostBinary, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backend, "provider"), fallback, 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "xunhupay-aggregate", PluginID: "official-payment-xunhupay"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	err = provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
	}
	if providerErr.Code == "plugin_executable_missing" || providerErr.Code == "plugin_exec_format_error" || providerErr.Code == "plugin_start_failed" {
		t.Fatalf("host artifact failed to start: %#v cause=%v", providerErr, providerErr.Cause)
	}
}

func TestRPCProviderStartsFromRelativePackageDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("relative package directories are asserted against POSIX path resolution")
	}
	artifact := "provider-" + runtime.GOOS + "-" + runtime.GOARCH
	source := filepath.Join("..", "..", "..", "plugin-packages", "official-payment-xunhupay", "backend", artifact)
	hostBinary, err := os.ReadFile(source)
	if err != nil {
		t.Fatalf("read host artifact: %v", err)
	}
	absDir := t.TempDir()
	relDir, err := filepath.Rel(mustWorkingDir(t), absDir)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.IsAbs(relDir) {
		t.Fatalf("test setup produced an absolute package dir %q", relDir)
	}
	backend := filepath.Join(absDir, "backend")
	if err := os.MkdirAll(backend, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(backend, artifact), hostBinary, 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "xunhupay-aggregate", PluginID: "official-payment-xunhupay"}, relDir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(provider.dir) {
		t.Fatalf("package dir = %q, want absolute", provider.dir)
	}
	err = provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
	}
	if providerErr.Code == "plugin_executable_missing" || providerErr.Code == "plugin_exec_format_error" || providerErr.Code == "plugin_start_failed" {
		t.Fatalf("relative package dir failed to start host artifact: %#v cause=%v", providerErr, providerErr.Cause)
	}
}

func mustWorkingDir(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestClassifyPaymentPluginStartError(t *testing.T) {
	tests := []struct {
		name      string
		cause     error
		code      string
		temporary bool
	}{
		{name: "missing", cause: os.ErrNotExist, code: "plugin_executable_missing"},
		{name: "permission", cause: os.ErrPermission, code: "plugin_permission_denied"},
		{name: "format", cause: syscall.ENOEXEC, code: "plugin_exec_format_error"},
		{name: "generic", cause: errors.New("start failed"), code: "plugin_start_failed", temporary: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			providerErr := classifyPaymentPluginStartError(test.cause)
			if providerErr.Code != test.code || providerErr.Temporary != test.temporary || !errors.Is(providerErr, test.cause) {
				t.Fatalf("classifyPaymentPluginStartError() = %#v", providerErr)
			}
		})
	}
}

func TestRPCProviderDoesNotExposeProcessStderr(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' 'credential=super-secret' >&2\nexit 1\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) {
		t.Fatalf("ValidateConfig() error = %T %v, want ProviderError", err, err)
	}
	if providerErr.Code != "plugin_process_failed" || providerErr.Message != "支付插件进程异常退出" {
		t.Fatalf("ProviderError = %#v", providerErr)
	}
	if strings.Contains(providerErr.Error(), "super-secret") {
		t.Fatalf("process stderr leaked through public error: %q", providerErr.Error())
	}
}

func TestRPCProviderClassifiesInvalidJSONResponse(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' 'not-json'\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "plugin_invalid_response" || providerErr.Message != "支付插件返回了无效响应" {
		t.Fatalf("ValidateConfig() error = %#v", err)
	}
}

func TestRPCProviderPreservesPluginValidationError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider uses a POSIX shell script")
	}
	provider := testRPCProvider(t, "#!/bin/sh\nprintf '%s\\n' '{\"ok\":false,\"code\":\"bad_config\",\"message\":\"配置无效\"}'\n")
	err := provider.ValidateConfig(Config{})
	var providerErr *ProviderError
	if !errors.As(err, &providerErr) || providerErr.Code != "bad_config" || providerErr.Message != "配置无效" {
		t.Fatalf("ValidateConfig() error = %#v", err)
	}
}

func testRPCProvider(t *testing.T, program string) *RPCProvider {
	t.Helper()
	dir := t.TempDir()
	entry := filepath.Join(dir, "backend", "provider")
	if err := os.MkdirAll(filepath.Dir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
		t.Fatal(err)
	}
	provider, err := NewRPCProvider(Descriptor{ID: "test-provider", PluginID: "test-plugin"}, dir, "backend/provider")
	if err != nil {
		t.Fatal(err)
	}
	return provider
}
