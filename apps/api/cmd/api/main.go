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
