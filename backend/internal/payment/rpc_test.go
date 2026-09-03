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
