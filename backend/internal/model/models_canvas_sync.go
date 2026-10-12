package model

import "time"

// CanvasMutationReceipt makes a client retry observable without making the
// canvas document carry an ever-growing list of request IDs. The receipt is a
// recovery hint; the mutation itself remains idempotent because applying the
// same desired values is a no-op.
type CanvasMutationReceipt struct {
	ID            string    `json:"id" gorm:"primaryKey;size:80"`
	UserID        string    `json:"userId" gorm:"index;size:36;uniqueIndex:idx_canvas_mutation_receipt_identity,priority:1"`
	CanvasID      string    `json:"canvasId" gorm:"index;size:80;uniqueIndex:idx_canvas_mutation_receipt_identity,priority:2"`
	MutationID    string    `json:"mutationId" gorm:"size:160;uniqueIndex:idx_canvas_mutation_receipt_identity,priority:3"`
	PayloadDigest string    `json:"payloadDigest" gorm:"size:64;index"`
	ResultJSON    string    `json:"resultJson" gorm:"type:text"`
	Revision      int64     `json:"revision"`
	CreatedAt     time.Time `json:"createdAt" gorm:"index"`
}
