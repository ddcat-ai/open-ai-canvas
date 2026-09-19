package main

import (
	"context"
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:3000", "HTTP listen address")
	root := flag.String("root", "dist", "built frontend directory")
	flag.Parse()
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		log.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(absoluteRoot, "index.html")); err != nil || info.IsDir() {
		log.Fatalf("frontend root does not contain index.html: %s", absoluteRoot)
	}
	server := &http.Server{Addr: *addr, Handler: spaHandler(absoluteRoot), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	log.Printf("frontend listening on %s, serving %s", *addr, absoluteRoot)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func spaHandler(root string) http.Handler {
	files := http.FileServer(http.Dir(root))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		cleanPath := filepath.Clean("/" + r.URL.Path)
		candidate := filepath.Join(root, filepath.FromSlash(strings.TrimPrefix(cleanPath, "/")))
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if strings.Contains(filepath.Base(cleanPath), ".") {
			http.NotFound(w, r)
			return
		}
		// Serve the SPA entry directly. Rewriting the request path to
		// /index.html makes http.FileServer redirect back to ./ forever.
		http.ServeFile(w, r, filepath.Join(root, "index.html"))
	})
}
