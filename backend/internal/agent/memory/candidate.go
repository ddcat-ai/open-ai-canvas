// Package memory defines durable memory candidates separately from database rows.
package memory

import (
	"encoding/json"

	"yingce/backend/internal/model"
)

type Evidence struct {
	Sequence int    `json:"sequence"`
	CallID   string `json:"callId,omitempty"`
	Tool     string `json:"tool"`
}

// Candidate contains only bounded, serializable proposal data. The owner and
// approved status come from the authenticated run at commit time, never the model.
type Candidate struct {
	ID        string     `json:"id"`
	Topic     string     `json:"topic"`
	Category  string     `json:"category"`
	Situation string     `json:"situation"`
	Lesson    string     `json:"lesson,omitempty"`
	StepsJSON string     `json:"stepsJSON,omitempty"`
	Source    string     `json:"source,omitempty"`
	Evidence  []Evidence `json:"evidence,omitempty"`
}

func FromLesson(lesson model.AgentLesson, evidence []Evidence) Candidate {
	return Candidate{
		ID: lesson.ID, Topic: lesson.Topic, Category: lesson.Category,
		Situation: lesson.Situation, Lesson: lesson.Lesson, StepsJSON: lesson.StepsJSON,
		Source: lesson.Source, Evidence: append([]Evidence(nil), evidence...),
	}
}

func (c Candidate) PendingLesson(userID, runID string) model.AgentLesson {
	evidence, _ := json.Marshal(c.Evidence)
	return model.AgentLesson{
		ID: c.ID, Topic: c.Topic, Category: c.Category, Situation: c.Situation,
		Lesson: c.Lesson, StepsJSON: c.StepsJSON, Source: c.Source,
		AuthorUserID: userID, OriginRunID: runID, EvidenceJSON: string(evidence),
		Status: model.AgentLessonStatusPending,
	}
}
