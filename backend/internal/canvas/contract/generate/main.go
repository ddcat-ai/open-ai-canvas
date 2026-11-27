package main

import (
	"os"
	"path/filepath"

	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/canvas/mediatool"
)

func main() {
	path := filepath.Join("..", "..", "..", "..", "web", "src", "lib", "canvas", "generation-contract.generated.ts")
	if err := os.WriteFile(path, []byte(contract.TypeScriptDeclaration()), 0644); err != nil {
		panic(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(path), "media-tools.generated.ts"), []byte(mediatool.TypeScriptDeclaration()), 0644); err != nil {
		panic(err)
	}
}
