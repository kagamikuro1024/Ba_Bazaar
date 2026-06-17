package main

import (
	"log"
	"net/http"
	"os"
	"strings"
)

type App struct {
	DB *DB
}

func main() {
	// Subcommand: `go run ./cmd/api seed` reseeds the database and exits.
	if len(os.Args) > 1 && os.Args[1] == "seed" {
		if err := mainSeed(); err != nil {
			log.Fatal(err)
		}
		log.Println("seed completed")
		return
	}

	// SEED_ON_START=true reseeds before serving (used on the demo deployment so
	// every deploy starts with fresh data). It RESETS the database, so enable it
	// only for dev/demo environments — never for a real production DB.
	if strings.EqualFold(envOr("SEED_ON_START", "false"), "true") {
		log.Println("SEED_ON_START=true: reseeding database before serving...")
		if err := mainSeed(); err != nil {
			log.Printf("seed on start failed (continuing to serve): %v", err)
		} else {
			log.Println("seed on start completed")
		}
	}

	db, err := OpenDBFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	app := &App{DB: db}
	addr := envOr("API_PORT", "3000")
	mux := app.Routes()

	log.Printf("listening on :%s", addr)
	if err := http.ListenAndServe(":"+addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
