package emailidentity

import "testing"

func TestCanonicalMailbox(t *testing.T) {
	for input, want := range map[string]string{
		" A.B+x@GMAIL.COM ":       "ab@gmail.com",
		"a.b+x@googlemail.com":    "ab@gmail.com",
		"A.B+x@example.com":       "a.b+x@example.com",
		"a.b+x@gmail.example.com": "a.b+x@gmail.example.com",
		"a.b+x@sub.gmail.com":     "a.b+x@sub.gmail.com",
		"":                        "",
	} {
		if got := Canonical(input); got != want {
			t.Errorf("Canonical(%q)=%q want %q", input, got, want)
		}
	}
}
