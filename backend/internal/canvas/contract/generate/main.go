package main

import (
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/canvas/contract"
)

func main() {
	path := filepath.Join("..", "..", "..", "..", "web", "src", "lib", "canvas", "generation-contract.generated.ts")
	if err := os.WriteFile(path, []byte(contract.TypeScriptDeclaration()), 0644); err != nil {
		panic(err)
	}
}
