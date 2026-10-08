// Package emailidentity defines mailbox equivalence for uniqueness checks.
package emailidentity

import "strings"

// Canonical preserves provider-specific local parts except for Gmail aliases.
// It is not an account lookup key: existing accounts may share a mailbox.
func Canonical(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	local, domain, ok := strings.Cut(value, "@")
	if !ok || (domain != "gmail.com" && domain != "googlemail.com") {
		return value
	}
	local, _, _ = strings.Cut(local, "+")
	return strings.ReplaceAll(local, ".", "") + "@gmail.com"
}
