package payment

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	paymentplugins "yingce/backend/payment-plugins"
	paymentsdk "yingce/backend/payment-sdk"
)

type rpcBusinessErrorProvider struct {
	paymentsdk.Provider
	err error
}

func (p rpcBusinessErrorProvider) QueryOrder(context.Context, Config, QueryRequest) (Result, error) {
	return Result{}, p.err
}

func (p rpcBusinessErrorProvider) CloseOrder(context.Context, Config, CloseRequest) (Result, error) {
	return Result{}, p.err
}

func (p rpcBusinessErrorProvider) DownloadTradeBill(context.Context, Config, time.Time) ([]BillRecord, error) {
	return nil, p.err
}

func TestRPCBusinessErrorHelper(t *testing.T) {
	if len(os.Args) < 3 || os.Args[len(os.Args)-2] != "payment-rpc-helper" {
		return
	}
	var err error
	switch os.Args[len(os.Args)-1] {
	case "order":
		err = fmt.Errorf("%w: ORDER_NOT_EXIST", paymentsdk.ErrOrderNotFound)
	case "unpaid":
		err = fmt.Errorf("provider: %w", paymentsdk.ErrOrderNotPaid)
	case "bill":
		err = fmt.Errorf("%w: NO_STATEMENT_EXIST", paymentsdk.ErrTradeBillNotFound)
	case "generic":
		// Similar wording is not sufficient evidence to close an order.
		err = errors.New(paymentsdk.ErrOrderNotFound.Error())
	default:
		os.Exit(2)
	}
	if paymentplugins.RunRPC(rpcBusinessErrorProvider{err: err}, os.Stdin, os.Stdout) != nil {
		os.Exit(3)
	}
	os.Exit(0)
}

func TestRPCProviderPreservesBusinessErrorsAcrossProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test provider launcher uses a POSIX shell script")
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, scenario, operation string
		want                      error
	}{
		{"missing_query", "order", "query", ErrOrderNotFound},
		{"missing_close", "order", "close", ErrOrderNotFound},
		{"unpaid", "unpaid", "query", ErrOrderNotPaid},
		{"missing_bill", "bill", "bill", ErrTradeBillNotFound},
		{"generic_not_promoted", "generic", "query", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			entry := filepath.Join(dir, "provider")
			quoted := "'" + strings.ReplaceAll(executable, "'", "'\\''") + "'"
			program := "#!/bin/sh\nexec " + quoted + " -test.run '^TestRPCBusinessErrorHelper$' -- payment-rpc-helper " + tc.scenario + "\n"
			if err := os.WriteFile(entry, []byte(program), 0o700); err != nil {
				t.Fatal(err)
			}
			provider, err := NewRPCProvider(Descriptor{ID: "test", PluginID: "test"}, dir, "backend/provider")
			if err != nil {
				t.Fatal(err)
			}
			provider.command = entry
			switch tc.operation {
			case "query":
				_, err = provider.QueryOrder(context.Background(), Config{}, QueryRequest{MerchantOrderNo: "order-1"})
			case "close":
				_, err = provider.CloseOrder(context.Background(), Config{}, CloseRequest{MerchantOrderNo: "order-1"})
			case "bill":
				_, err = provider.DownloadTradeBill(context.Background(), Config{}, time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC))
			}
			if tc.want != nil {
				if !errors.Is(err, tc.want) {
					t.Fatalf("business meaning lost across RPC: got %T %v, want %v", err, err, tc.want)
				}
			} else if err == nil || errors.Is(err, ErrOrderNotFound) || errors.Is(err, ErrOrderNotPaid) || errors.Is(err, ErrTradeBillNotFound) {
				t.Fatalf("generic provider failure changed meaning: %v", err)
			}
		})
	}
}
