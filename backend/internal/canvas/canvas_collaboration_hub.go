package canvas

import "sync"

// CanvasCollaborationRealtimeMessage is sent to connected editors after an
// operation commits. Operation contains only the authenticated delta needed
// for projection; private request/deletion snapshots stay in the database.
type CanvasCollaborationRealtimeMessage struct {
	Type              string                             `json:"type"`
	CanvasID          string                             `json:"canvasId"`
	ActorID           string                             `json:"actorId,omitempty"`
	OperationID       string                             `json:"operationId,omitempty"`
	Kind              string                             `json:"kind,omitempty"`
	TargetNodeID      string                             `json:"targetNodeId,omitempty"`
	TargetIncarnation int64                              `json:"targetIncarnation,omitempty"`
	Revision          int64                              `json:"revision,omitempty"`
	Operation         *CanvasCollaborationOperationDelta `json:"operation,omitempty"`
}

// CanvasCollaborationRealtimeSubscription is owned by one WebSocket handler.
// The channel is closed by Close and must not be read after that point.
type CanvasCollaborationRealtimeSubscription struct {
	Messages <-chan CanvasCollaborationRealtimeMessage
	close    func()
	once     sync.Once
}

func (s *CanvasCollaborationRealtimeSubscription) Close() {
	if s == nil {
		return
	}
	s.once.Do(func() {
		if s.close != nil {
			s.close()
		}
	})
}

type canvasCollaborationSubscriber struct {
	canvasID string
	messages chan CanvasCollaborationRealtimeMessage
}

type canvasCollaborationHub struct {
	mu    sync.RWMutex
	rooms map[string]map[*canvasCollaborationSubscriber]struct{}
}

func newCanvasCollaborationHub() *canvasCollaborationHub {
	return &canvasCollaborationHub{rooms: make(map[string]map[*canvasCollaborationSubscriber]struct{})}
}

func (h *canvasCollaborationHub) subscribe(canvasID string) *CanvasCollaborationRealtimeSubscription {
	if h == nil || canvasID == "" {
		return &CanvasCollaborationRealtimeSubscription{Messages: closedCanvasCollaborationMessages()}
	}
	subscriber := &canvasCollaborationSubscriber{canvasID: canvasID, messages: make(chan CanvasCollaborationRealtimeMessage, 32)}
	h.mu.Lock()
	room := h.rooms[canvasID]
	if room == nil {
		room = make(map[*canvasCollaborationSubscriber]struct{})
		h.rooms[canvasID] = room
	}
	room[subscriber] = struct{}{}
	h.mu.Unlock()
	return &CanvasCollaborationRealtimeSubscription{Messages: subscriber.messages, close: func() { h.unsubscribe(subscriber) }}
}

func (h *canvasCollaborationHub) unsubscribe(subscriber *canvasCollaborationSubscriber) {
	if h == nil || subscriber == nil {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	room := h.rooms[subscriber.canvasID]
	if room == nil {
		return
	}
	if _, ok := room[subscriber]; !ok {
		return
	}
	delete(room, subscriber)
	close(subscriber.messages)
	if len(room) == 0 {
		delete(h.rooms, subscriber.canvasID)
	}
}

func (h *canvasCollaborationHub) publish(message CanvasCollaborationRealtimeMessage) {
	if h == nil || message.CanvasID == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for subscriber := range h.rooms[message.CanvasID] {
		select {
		case subscriber.messages <- message:
		default:
			// A slow browser can miss an individual event. It will receive a
			// resync marker when there is room, then fetch all events after its
			// last revision through the authenticated HTTP endpoint.
			select {
			case <-subscriber.messages:
			default:
			}
			subscriber.messages <- CanvasCollaborationRealtimeMessage{Type: "resync", CanvasID: message.CanvasID, Revision: message.Revision}
		}
	}
}

func closedCanvasCollaborationMessages() <-chan CanvasCollaborationRealtimeMessage {
	channel := make(chan CanvasCollaborationRealtimeMessage)
	close(channel)
	return channel
}

func (s *Service) SubscribeCanvasCollaborationRealtime(canvasID string) *CanvasCollaborationRealtimeSubscription {
	if s == nil {
		return &CanvasCollaborationRealtimeSubscription{Messages: closedCanvasCollaborationMessages()}
	}
	if s.canvasCollaborationHub == nil {
		return &CanvasCollaborationRealtimeSubscription{Messages: closedCanvasCollaborationMessages()}
	}
	return s.canvasCollaborationHub.subscribe(canvasID)
}

func (s *Service) publishCanvasCollaborationRealtime(message CanvasCollaborationRealtimeMessage) {
	if s == nil || s.canvasCollaborationHub == nil {
		return
	}
	s.canvasCollaborationHub.publish(message)
}
