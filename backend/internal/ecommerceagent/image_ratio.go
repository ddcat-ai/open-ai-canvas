package ecommerceagent

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	_ "image/jpeg"
	"image/png"
	"strings"

	_ "golang.org/x/image/webp"
)

// PadImageToRatio preserves every generated pixel and writes a PNG whose
// dimensions exactly match the requested canvas ratio. This is needed because
// common image-edit endpoints only offer square, portrait and landscape sizes.
func PadImageToRatio(raw []byte, ratio string) ([]byte, error) {
	parts := strings.Split(ratio, ":")
	if len(parts) != 2 {
		return nil, errors.New("invalid image ratio")
	}
	var rw, rh int
	if _, err := fmt.Sscanf(ratio, "%d:%d", &rw, &rh); err != nil || rw < 1 || rh < 1 || rw > 32 || rh > 32 {
		return nil, errors.New("invalid image ratio")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	if config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 40_000_000 {
		return nil, errors.New("generated image dimensions exceed limit")
	}
	imageValue, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	width, height := imageValue.Bounds().Dx(), imageValue.Bounds().Dy()
	factor := (width + rw - 1) / rw
	if vertical := (height + rh - 1) / rh; vertical > factor {
		factor = vertical
	}
	targetW, targetH := factor*rw, factor*rh
	if int64(targetW)*int64(targetH) > 40_000_000 {
		return nil, errors.New("padded image dimensions exceed limit")
	}
	canvas := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	point := image.Pt((targetW-width)/2, (targetH-height)/2)
	draw.Draw(canvas, image.Rectangle{Min: point, Max: point.Add(image.Pt(width, height))}, imageValue, imageValue.Bounds().Min, draw.Src)
	var output bytes.Buffer
	if err := png.Encode(&output, canvas); err != nil {
		return nil, err
	}
	return output.Bytes(), nil
}
