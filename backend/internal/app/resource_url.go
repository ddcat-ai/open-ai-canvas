package app

import "infinite-canvas/backend/internal/assets"

func resourceFileURL(id string) string {
	return assets.FileURL(id)
}

func isResourceFileURL(value string) bool {
	return assets.IsFileURL(value)
}

func resourceIDFromFileURL(value string) string {
	return assets.IDFromFileURL(value)
}

func canvasResourceID(value string) string {
	return assets.ResourceID(value)
}

func validCanvasResourceID(value string) string {
	return assets.ValidID(value)
}
