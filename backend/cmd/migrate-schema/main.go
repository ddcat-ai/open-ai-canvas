package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"

	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/database"
)

func main() {
	command := "up"
	if len(os.Args) > 1 {
		command = strings.ToLower(strings.TrimSpace(os.Args[1]))
	}
	apply := false
	if command == "repair-asset-bytes" {
		if len(os.Args) == 3 && os.Args[2] == "--apply" {
			apply = true
		} else if len(os.Args) > 2 {
			log.Fatal("用法：migrate-schema repair-asset-bytes [--apply]；默认只检查")
		}
	}
	db, err := database.Open(database.Config{
		Driver:  env("CANVAS_DATABASE_DRIVER", "sqlite"),
		DSN:     os.Getenv("DATABASE_URL"),
		DataDir: env("CANVAS_BACKEND_DATA_DIR", "data"),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := database.ConfigurePool(db); err != nil {
		log.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatal(err)
	}
	defer sqlDB.Close()

	switch command {
	case "repair-asset-bytes":
		report, repairErr := canvas.RepairAssetBytes(db, apply)
		encoded, err := json.Marshal(report)
		if err != nil {
			log.Fatal(err)
		}
		fmt.Println(string(encoded))
		if repairErr != nil {
			log.Fatal(repairErr)
		}
		if len(report.Unresolved) > 0 {
			log.Fatal("存在未修复素材，请按报告核查；未删除或填零")
		}
		return
	case "up":
		if err := database.MigrateSchema(db); err != nil {
			log.Fatal(err)
		}
	case "status":
	case "verify":
		if err := database.RequireSchemaVersion(db); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("未知命令 %q；可用命令：up、status、verify、repair-asset-bytes", command)
	}
	status, err := database.ReadSchemaStatus(db)
	if err != nil {
		log.Fatal(err)
	}
	encoded, err := json.Marshal(status)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(string(encoded))
}

func env(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
