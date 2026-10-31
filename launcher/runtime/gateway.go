package main

import (
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Only the canonical numeric loopback origin is accepted, including its port.
// This rejects DNS rebinding names and ambiguous localhost aliases.
type gateway struct {
	http.Handler
	root *os.Root
}

func (g *gateway) Close() error { return g.root.Close() }

func newGateway(webRoot string, port int, upstream *url.URL) (*gateway, error) {
	root, err := os.OpenRoot(webRoot)
	if err != nil {
		return nil, err
	}
	// Root lives for the server lifetime. os.Root confines symlinks as well as "..".
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.FlushInterval = -1
	proxy.Transport = &http.Transport{
		Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		// Match the backend API timeout: synchronous model generation may take minutes.
		ForceAttemptHTTP2: false, DisableCompression: true, ResponseHeaderTimeout: time.Hour,
	}
	original := proxy.Director
	proxy.Director = func(r *http.Request) {
		original(r)
		// Do not trust forwarding headers provided by a browser or other local process.
		r.Header.Del("Forwarded")
		r.Header.Del("X-Yingce-Runtime-Token")
		r.Header.Del("X-Forwarded-For")
		r.Header.Set("X-Forwarded-Host", r.Host)
		r.Header.Set("X-Forwarded-Proto", "http")
		r.Header.Set("X-Real-IP", "127.0.0.1")
	}
	proxy.ErrorLog = log.New(os.Stderr, "gateway proxy: ", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusBadGateway)
		fmt.Fprint(w, `{"code":502,"data":null,"msg":"Local backend unavailable","reason":"runtime_backend_unavailable"}`)
	}
	host := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	origin := "http://" + host
	return &gateway{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.Host != host {
			http.Error(w, "Invalid local Host", http.StatusForbidden)
			return
		}
		if v := r.Header.Get("Origin"); v != "" && v != origin {
			http.Error(w, "Invalid local Origin", http.StatusForbidden)
			return
		}
		// OAuth redirects are cross-site top-level GETs; backend validates OAuth state.
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" && !(r.Method == http.MethodGet && r.URL.Path == "/oauth/linuxdo/callback" && r.Header.Get("Sec-Fetch-Mode") == "navigate") {
			http.Error(w, "Cross-site request denied", http.StatusForbidden)
			return
		}
		p := r.URL.Path
		// Match backend routes before SPA fallback, including OAuth callbacks.
		if p == "/api" || strings.HasPrefix(p, "/api/") || p == "/oauth/linuxdo/callback" {
			proxy.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if strings.ContainsAny(p, "\\\x00") {
			http.Error(w, "Invalid path", http.StatusBadRequest)
			return
		}
		for _, part := range strings.Split(p, "/") {
			if part == ".." || strings.HasPrefix(part, ".") && part != "" {
				http.NotFound(w, r)
				return
			}
		}
		name := strings.TrimPrefix(path.Clean("/"+p), "/")
		if name == "" {
			name = "index.html"
		}
		// These paths are both SPA routes and physical Vite public directories.
		switch p {
		case "/assets", "/assets/", "/canvas", "/canvas/", "/welcome", "/welcome/", "/inspirations", "/inspirations/":
			name = "index.html"
		}
		file, err := root.Open(filepath.FromSlash(name))
		if err == nil {
			var info fs.FileInfo
			info, err = file.Stat()
			if err == nil && !info.IsDir() {
				defer file.Close()
				w.Header().Set("Cache-Control", "no-cache")
				http.ServeContent(w, r, info.Name(), info.ModTime(), file)
				return
			}
			file.Close()
		}
		// Missing scripts/media must not become successful HTML responses.
		if strings.HasPrefix(p, "/assets/") || path.Ext(p) != "" {
			w.Header().Set("Cache-Control", "no-store")
			http.NotFound(w, r)
			return
		}
		file, err = root.Open("index.html")
		if err != nil {
			http.Error(w, "Packaged frontend unavailable", http.StatusServiceUnavailable)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			http.Error(w, "Packaged frontend unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeContent(w, r, "index.html", info.ModTime(), file)
	}), root: root}, nil
}
