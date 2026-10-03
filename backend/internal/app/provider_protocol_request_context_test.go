package app

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/protocol"
)

// Embedding only the base interface models an installed adapter that predates
// request-aware create parsing.
type legacyCreateParserAdapter struct{ protocol.Adapter }

func TestProtocolAdapterCreatePassesRequestToDoubaoParser(t *testing.T) {
	archive, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "doubao-streaming-tts.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(archive)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := protocol.LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil || len(adapters) != 1 {
		t.Fatalf("load installed Doubao adapter: count=%d, err=%v", len(adapters), err)
	}
	if _, ok := adapters[0].(protocol.RequestAwareCreateParser); !ok {
		t.Fatal("installed Doubao adapter does not expose request-aware parsing")
	}

	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	transport, ok := OutboundHTTPClient(time.Second).Transport.(*http.Transport)
	if !ok {
		t.Fatal("outbound HTTP client has no configurable transport")
	}
	previousDial, previousProxy := transport.DialContext, transport.Proxy
	transport.CloseIdleConnections()
	t.Cleanup(func() {
		transport.CloseIdleConnections()
		transport.DialContext, transport.Proxy = previousDial, previousProxy
	})

	for _, tc := range []struct {
		name   string
		format string
		adapt  protocol.Adapter
		mime   string
	}{
		{name: "request-aware wav", format: "wav", adapt: adapters[0], mime: "audio/wav"},
		{name: "legacy parser fallback", format: "mp3", adapt: legacyCreateParserAdapter{Adapter: adapters[0]}, mime: "audio/mpeg"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const response = `{"code":0,"audio":"aGVsbG8="}`
			requests := make(chan struct {
				path, idempotency, body string
				err                     error
			}, 1)
			transport.Proxy = nil
			transport.DialContext = func(context.Context, string, string) (net.Conn, error) {
				client, server := net.Pipe()
				go func() {
					defer server.Close()
					req, err := http.ReadRequest(bufio.NewReader(server))
					if err != nil {
						requests <- struct {
							path, idempotency, body string
							err                     error
						}{err: err}
						return
					}
					body, err := io.ReadAll(req.Body)
					requests <- struct {
						path, idempotency, body string
						err                     error
					}{path: req.URL.Path, idempotency: req.Header.Get("X-Api-Request-Id"), body: string(body), err: err}
					if err == nil {
						_, _ = fmt.Fprintf(server, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(response), response)
					}
				}()
				return client, nil
			}

			ctx := context.WithValue(context.Background(), providerSubmissionKeyContext{}, "fixed-create-key")
			input := canvasGenerationInput{Mode: "audio", Prompt: "你好", Config: providerConfig{
				BaseURL: "http://127.0.0.1:8765", APIKey: "test-key", Model: "seed-audio-1.0", AudioFormat: tc.format,
			}}
			result, err := runProtocolAdapterTaskWithPolicy(ctx, input, tc.adapt, declarativeProtocolPollPolicy(input.Mode))
			if err != nil {
				t.Fatal(err)
			}
			audio, ok := result["audio"].(map[string]interface{})
			if !ok || result["mode"] != "audio" || audio["mimeType"] != tc.mime || audio["dataUrl"] != "data:"+tc.mime+";base64,aGVsbG8=" {
				t.Fatalf("result = %#v, want %s inline audio", result, tc.mime)
			}
			select {
			case sent := <-requests:
				if sent.err != nil || sent.path != "/api/v3/tts/create" || sent.idempotency != "fixed-create-key" || sent.body == "" {
					t.Fatalf("create request = %#v", sent)
				}
			case <-time.After(time.Second):
				t.Fatal("in-memory transport did not receive the create request")
			}
			transport.CloseIdleConnections()
		})
	}
}
