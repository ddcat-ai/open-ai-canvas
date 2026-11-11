package model

// APICallGenerationContent is an administrator-only read model. Resource identities
// and storage credentials remain in the private snapshot, never in this DTO.
type APICallGenerationContent struct {
	Prompt     string                       `json:"prompt"`
	References []APICallGenerationReference `json:"references"`
	Source     string                       `json:"source"`
	Incomplete bool                         `json:"incomplete"`
	Note       string                       `json:"note,omitempty"`
}

type APICallGenerationReference struct {
	ID                string `json:"id"`
	Kind              string `json:"kind"`
	Label             string `json:"label"`
	Name              string `json:"name"`
	Role              string `json:"role,omitempty"`
	Available         bool   `json:"available"`
	UnavailableReason string `json:"unavailableReason,omitempty"`
	MediaURL          string `json:"mediaUrl,omitempty"`
}
