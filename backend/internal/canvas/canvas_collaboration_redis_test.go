package canvas

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestCanvasCollaborationRedisCrossInstanceAndReconnect(t *testing.T) {
	binary, err := exec.LookPath("redis-server")
	if err != nil {
		t.Skip("redis-server unavailable")
	}
	dir, err := os.MkdirTemp("", "canvas-bus-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	socket := filepath.Join(dir, "r.sock")
	process := exec.Command(binary, "--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", dir)
	if err := process.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = process.Process.Kill(); _ = process.Wait() })
	client := redis.NewClient(&redis.Options{Network: "unix", Addr: socket, MaxRetries: -1, ContextTimeoutEnabled: true})
	t.Cleanup(func() { _ = client.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for client.Ping(ctx).Err() != nil {
		if ctx.Err() != nil {
			t.Fatal("temporary redis did not start")
		}
		time.Sleep(10 * time.Millisecond)
	}
	hubA, hubB := newCanvasCollaborationHub(), newCanvasCollaborationHub()
	busA, busB := newCanvasRealtimeBus(client, hubA), newCanvasRealtimeBus(client, hubB)
	t.Cleanup(func() { busA.close(); busB.close() })
	a, b, other := hubA.subscribe("canvas"), hubB.subscribe("canvas"), hubB.subscribe("other")
	defer a.Close()
	defer b.Close()
	defer other.Close()
	message := CanvasCollaborationRealtimeMessage{Type: "operation_applied", CanvasID: "canvas", Revision: 7, Operation: &CanvasCollaborationOperationDelta{OpID: "op", Kind: "update_node", Revision: 7}}
	hubA.publish(message)
	busA.publish(message)
	for _, sub := range []*CanvasCollaborationRealtimeSubscription{a, b} {
		select {
		case got := <-sub.Messages:
			if got.Revision != 7 || got.Operation == nil {
				t.Fatalf("lost delta: %#v", got)
			}
		case <-time.After(2 * time.Second):
			t.Fatal("cross-instance delta missing")
		}
	}
	select {
	case got := <-a.Messages:
		t.Fatalf("echoed local event: %#v", got)
	case got := <-other.Messages:
		t.Fatalf("wrong room: %#v", got)
	case <-time.After(40 * time.Millisecond):
	}
	if err := client.ClientKillByFilter(ctx, "TYPE", "pubsub").Err(); err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-b.Messages:
		if got.Type != "resync" {
			t.Fatalf("reconnect: %#v", got)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("reconnect did not reconcile rooms")
	}
	busB.close()
	busB.close()
}
