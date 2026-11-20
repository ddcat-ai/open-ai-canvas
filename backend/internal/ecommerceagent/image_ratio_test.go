package ecommerceagent

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestPadImageToRatioPreservesPixels(t *testing.T) {
	source := image.NewRGBA(image.Rect(0, 0, 4, 6))
	for y := 0; y < 6; y++ {
		for x := 0; x < 4; x++ {
			source.Set(x, y, color.RGBA{R: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, source); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		ratio         string
		width, height int
	}{{"3:4", 6, 8}, {"9:16", 9, 16}, {"1:1", 6, 6}} {
		out, err := PadImageToRatio(buf.Bytes(), tc.ratio)
		if err != nil {
			t.Fatal(err)
		}
		decoded, err := png.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatal(err)
		}
		if decoded.Bounds().Dx() != tc.width || decoded.Bounds().Dy() != tc.height {
			t.Fatalf("%s: bounds=%v", tc.ratio, decoded.Bounds())
		}
		if r, _, _, _ := decoded.At(tc.width/2, tc.height/2).RGBA(); r != 65535 {
			t.Fatalf("%s: product pixels changed", tc.ratio)
		}
	}
}
