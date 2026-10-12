package database

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakePostgresServer 只实现启动握手和简单查询，用于检查客户端发送的启动参数。
type fakePostgresServer struct {
	listener  net.Listener
	onStartup func(conn net.Conn)
	mu        sync.Mutex
	startups  []map[string]string
}

func newFakePostgresServer(t *testing.T) *fakePostgresServer {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &fakePostgresServer{listener: listener}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go server.serve(conn)
		}
	}()
	return server
}

func (s *fakePostgresServer) port() int {
	return s.listener.Addr().(*net.TCPAddr).Port
}

func (s *fakePostgresServer) recorded() []map[string]string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]map[string]string(nil), s.startups...)
}

func (s *fakePostgresServer) serve(conn net.Conn) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	var size uint32
	if err := binary.Read(conn, binary.BigEndian, &size); err != nil || size < 8 {
		return
	}
	body := make([]byte, size-4)
	if _, err := io.ReadFull(conn, body); err != nil {
		return
	}
	params := map[string]string{}
	fields := bytes.Split(body[4:], []byte{0})
	for i := 0; i+1 < len(fields) && len(fields[i]) > 0; i += 2 {
		params[string(fields[i])] = string(fields[i+1])
	}
	s.mu.Lock()
	s.startups = append(s.startups, params)
	s.mu.Unlock()
	if s.onStartup != nil {
		s.onStartup(conn)
	}
	// AuthenticationOk + ReadyForQuery
	_, _ = conn.Write([]byte{'R', 0, 0, 0, 8, 0, 0, 0, 0, 'Z', 0, 0, 0, 5, 'I'})
	header := make([]byte, 5)
	for {
		if _, err := io.ReadFull(conn, header); err != nil {
			return
		}
		payload := make([]byte, binary.BigEndian.Uint32(header[1:])-4)
		if _, err := io.ReadFull(conn, payload); err != nil {
			return
		}
		switch header[0] {
		case 'Q': // EmptyQueryResponse + ReadyForQuery
			_, _ = conn.Write([]byte{'I', 0, 0, 0, 4, 'Z', 0, 0, 0, 5, 'I'})
		case 'X':
			return
		}
	}
}

func openFakePostgres(t *testing.T, server *fakePostgresServer, params string, pings int) []map[string]string {
	t.Helper()
	dsn := fmt.Sprintf("host=127.0.0.1 port=%d user=test dbname=test sslmode=disable %s", server.port(), params)
	db, err := Open(Config{Driver: "postgres", DSN: dsn})
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	// 不保留空闲连接，每次 Ping 都会建立新的物理连接。
	sqlDB.SetMaxIdleConns(0)
	for range pings {
		if err := sqlDB.Ping(); err != nil {
			t.Fatalf("ping: %v", err)
		}
	}
	startups := server.recorded()
	if len(startups) < pings+1 {
		t.Fatalf("startup count = %d, want at least %d", len(startups), pings+1)
	}
	return startups
}

func TestPostgresOpenConsumesLibpqKeepaliveParams(t *testing.T) {
	server := newFakePostgresServer(t)
	startups := openFakePostgres(t, server, "keepalives=1 keepalives_idle=90 keepalives_interval=20 keepalives_count=6", 0)
	for _, params := range startups {
		for key := range params {
			if strings.HasPrefix(key, "keepalives") {
				t.Fatalf("libpq parameter %s sent to server: %v", key, params)
			}
		}
	}
}

func TestPostgresOpenRejectsInvalidKeepaliveParam(t *testing.T) {
	server := newFakePostgresServer(t)
	dsn := fmt.Sprintf("host=127.0.0.1 port=%d user=test dbname=test sslmode=disable keepalives_idle=abc", server.port())
	if _, err := Open(Config{Driver: "postgres", DSN: dsn}); err == nil || !strings.Contains(err.Error(), "keepalives_idle") {
		t.Fatalf("expected invalid keepalives_idle error, got %v", err)
	}
}

func TestPostgresOpenSetsIdleInTransactionTimeoutPerConnection(t *testing.T) {
	server := newFakePostgresServer(t)
	startups := openFakePostgres(t, server, "options='-c statement_timeout=4s'", 3)
	want := "-c idle_in_transaction_session_timeout=5min -c statement_timeout=4s"
	for i, params := range startups {
		// 每条连接都应得到相同的 options，不能因共享 RuntimeParams 而跨连接累积。
		if params["options"] != want {
			t.Fatalf("connection %d options = %q, want %q", i, params["options"], want)
		}
	}
}

func TestPostgresOpenKeepsExplicitIdleInTransactionTimeout(t *testing.T) {
	server := newFakePostgresServer(t)
	startups := openFakePostgres(t, server, "idle_in_transaction_session_timeout=0 options='-c statement_timeout=4s'", 1)
	for i, params := range startups {
		if params["idle_in_transaction_session_timeout"] != "0" || params["options"] != "-c statement_timeout=4s" {
			t.Fatalf("connection %d overrode explicit timeout: %v", i, params)
		}
	}
}
