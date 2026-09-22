package app

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelModelTagsValidation(t *testing.T) {
	for _, input := range [][]model.ChannelModelTag{
		{{Text: " ", Color: "purple"}},
		{{Text: strings.Repeat("字", 13), Color: "purple"}},
		{{Text: "特价", Color: "unknown"}},
		{{Text: "特价", Color: "purple"}, {Text: " 特价 ", Color: "gold"}},
		make([]model.ChannelModelTag, 6),
	} {
		if _, err := normalizeChannelModelTags(input); err == nil {
			t.Fatalf("accepted invalid tags: %#v", input)
		}
	}
	for _, color := range []string{"purple", "blue", "green", "gold", "orange", "pink"} {
		if _, err := normalizeChannelModelTags([]model.ChannelModelTag{{Text: strings.Repeat("字", 12), Color: color}}); err != nil {
			t.Fatal(err)
		}
	}
}
