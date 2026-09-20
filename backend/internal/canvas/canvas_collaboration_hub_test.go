package canvas

import (
	"testing"
	"time"
)

func TestCanvasCollaborationHubPublishesOnlyToCanvasSubscribers(t *testing.T) {
	hub := newCanvasCollaborationHub()
	first := hub.subscribe("canvas-a")
	second := hub.subscribe("canvas-a")
	other := hub.subscribe("canvas-b")
	t.Cleanup(func() {
		first.Close()
		second.Close()
		other.Close()
	})

	hub.publish(CanvasCollaborationRealtimeMessage{Type: "operation_applied", CanvasID: "canvas-a", Revision: 4})
	for name, subscription := range map[string]*CanvasCollaborationRealtimeSubscription{"first": first, "second": second} {
		select {
		case message := <-subscription.Messages:
			if message.CanvasID != "canvas-a" || message.Revision != 4 {
				t.Fatalf("%s received %#v", name, message)
			}
		case <-time.After(time.Second):
			t.Fatalf("%s did not receive broadcast", name)
		}
	}
	select {
	case message := <-other.Messages:
		t.Fatalf("other canvas received %#v", message)
	case <-time.After(20 * time.Millisecond):
	}
}

func TestCanvasCollaborationHubCloseIsIdempotent(t *testing.T) {
	hub := newCanvasCollaborationHub()
	subscription := hub.subscribe("canvas-a")
	subscription.Close()
	subscription.Close()
	select {
	case _, ok := <-subscription.Messages:
		if ok {
			t.Fatal("closed subscription still has an open channel")
		}
	case <-time.After(time.Second):
		t.Fatal("closed subscription did not close its channel")
	}
	hub.publish(CanvasCollaborationRealtimeMessage{Type: "operation_applied", CanvasID: "canvas-a", Revision: 5})
}
