package main

import (
	"crypto/sha256"
	"crypto/subtle"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// This credential is given only to the owning launcher via its child's
// environment. Never expose it to the frontend, backend, arguments or logs.
func privateManagement(next http.Handler, port int, token string, stop func()) http.Handler {
	host := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	origin := "http://" + host
	expected := sha256.Sum256([]byte(token))
	var once sync.Once
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/_launcher/") && r.URL.Path != "/_launcher" {
			next.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		remote, _, err := net.SplitHostPort(r.RemoteAddr)
		ip := net.ParseIP(remote)
		origins := r.Header.Values("Origin")
		if r.Host != host || err != nil || ip == nil || !ip.IsLoopback() ||
			len(origins) > 1 || len(origins) == 1 && origins[0] != origin ||
			r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Invalid local management request", http.StatusForbidden)
			return
		}
		if r.URL.Path != "/_launcher/stop" || token == "" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		values := r.Header.Values("X-Yingce-Runtime-Token")
		actual := sha256.Sum256([]byte(r.Header.Get("X-Yingce-Runtime-Token")))
		if len(values) != 1 || subtle.ConstantTimeCompare(actual[:], expected[:]) != 1 {
			http.Error(w, "Invalid local management credential", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusAccepted)
		// Flush acknowledgment before cancel closes the public server, including
		// long-running SSE connections. Cancellation is idempotent under races.
		_ = http.NewResponseController(w).Flush()
		once.Do(stop)
	})
}
