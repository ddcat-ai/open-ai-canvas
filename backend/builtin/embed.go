package builtin

import "embed"

// FS contains the built-in skill packages shipped with the backend.
//
// The Markdown packages live outside internal Go packages so they are easy to
// review and maintain as product content while remaining embedded in binaries.
//
//go:embed *
var FS embed.FS
