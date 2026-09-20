package canvas

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"infinite-canvas/backend/internal/kernel"
)

const canvasRealtimeChannel = "canvas:collaboration:committed:v1"

type canvasRealtimeEnvelope struct {
	Origin  string                             `json:"origin"`
	Message CanvasCollaborationRealtimeMessage `json:"message"`
}

// Redis transports hints; committed revisions and operation receipts in the
// database remain authoritative. Reconnects and periodic WS reconciliation
// repair dropped publications, including a crash immediately after commit.
type canvasRealtimeBus struct {
	client *redis.Client
	sub    *redis.PubSub
	origin string
	cancel context.CancelFunc
	done   chan struct{}
	once   sync.Once
}

func newCanvasRealtimeBus(client *redis.Client, hub *canvasCollaborationHub) *canvasRealtimeBus {
	if client == nil {
		return nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	b := &canvasRealtimeBus{client: client, origin: kernel.NewID(), cancel: cancel, done: make(chan struct{})}
	b.sub = client.Subscribe(ctx, canvasRealtimeChannel)
	// Confirm the initial subscription before serving requests when Redis is
	// available. The channel driver also resubscribes after connection failures.
	readyCtx, readyCancel := context.WithTimeout(ctx, 800*time.Millisecond)
	_, err := b.sub.Receive(readyCtx)
	readyCancel()
	if err != nil {
		slog.Warn("canvas realtime subscription pending; database reconciliation active", "error", err)
	}
	messages := b.sub.ChannelWithSubscriptions(redis.WithChannelSize(128))
	go func() {
		defer close(b.done)
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-messages:
				if !ok {
					return
				}
				switch event := event.(type) {
				case *redis.Subscription:
					hub.resyncAll()
				case *redis.Message:
					if len(event.Payload) > 256<<10 {
						continue
					}
					var envelope canvasRealtimeEnvelope
					if json.Unmarshal([]byte(event.Payload), &envelope) != nil || envelope.Origin == b.origin {
						continue
					}
					if envelope.Message.Type != "operation_applied" && envelope.Message.Type != "resync" {
						continue
					}
					hub.publish(envelope.Message)
				}
			}
		}
	}()
	return b
}

func (b *canvasRealtimeBus) publish(message CanvasCollaborationRealtimeMessage) {
	envelope := canvasRealtimeEnvelope{Origin: b.origin, Message: message}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return
	}
	if len(payload) > 256<<10 {
		envelope.Message = CanvasCollaborationRealtimeMessage{Type: "resync", CanvasID: message.CanvasID, Revision: message.Revision}
		payload, _ = json.Marshal(envelope)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
	defer cancel()
	if err := b.client.Publish(ctx, canvasRealtimeChannel, payload).Err(); err != nil {
		slog.Warn("canvas realtime publication failed; database reconciliation active", "error", err)
	}
}

func (b *canvasRealtimeBus) close() {
	b.once.Do(func() { b.cancel(); _ = b.sub.Close(); <-b.done })
}

func (h *canvasCollaborationHub) resyncAll() {
	h.mu.RLock()
	ids := make([]string, 0, len(h.rooms))
	for id := range h.rooms {
		ids = append(ids, id)
	}
	h.mu.RUnlock()
	for _, id := range ids {
		h.publish(CanvasCollaborationRealtimeMessage{Type: "resync", CanvasID: id})
	}
}
