package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"

	"ba-bazaar-go/cmd/api/aiagent"
	"ba-bazaar-go/cmd/api/aigateway"
)

type App struct {
	DB *DB
	// AI is the LLM gateway. It is non-nil after main() wires it up.
	// All AI features (Brief Composer, Triage, Agent) go through it.
	AI *aigateway.Gateway

	// agentLoop is the singleton AI Assistant. It is built on first
	// request so the gateway's logger can be wired before it runs.
	agentOnce sync.Once
	agentLoop *aiagent.Loop
}

func main() {
	db, err := OpenDBFromEnv()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Build the AI gateway. We default to the stub provider so dev
	// and CI work without external dependencies. If DEEPSEEK_API_KEY
	// is present, use the Python LangGraph bridge.
	var provider aigateway.Provider = aigateway.NewStubProvider()
	if lg := aigateway.NewLangGraphProvider(); lg.Configured() {
		log.Printf("AI gateway: using Python LangGraph provider (model=%s)",
			envOr("DEEPSEEK_MODEL", "deepseek-chat"))
		provider = lg
	} else {
		log.Printf("AI gateway: using stub provider (set DEEPSEEK_API_KEY in .env to enable LangGraph)")
	}
	gw := aigateway.New(provider, makeAILogger(db))
	gw.SetBudget("brief_composer", 200_000)
	gw.SetBudget("triage", 200_000)
	gw.SetBudget("agent_loop", 500_000)

	app := &App{DB: db, AI: gw}
	addr := envOr("API_PORT", "3000")
	mux := app.Routes()

	log.Printf("listening on :%s", addr)
	if err := http.ListenAndServe(":"+addr, withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

// makeAILogger returns a callback the gateway fires for every LLM call.
// We persist to ai_decisions asynchronously-ish: a single sync insert
// keyed by gen_random_uuid(). If the DB is down we still log to stdout
// so the audit trail is never silently lost.
func makeAILogger(db *DB) func(aigateway.LogEntry) {
	return func(e aigateway.LogEntry) {
		// Best-effort persist. Never let logging kill the request.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 2_000_000_000)
			defer cancel()
			var errMsg any
			if e.ErrorMessage != "" {
				errMsg = e.ErrorMessage
			}
			_, err := db.Pool.Exec(ctx, `
				insert into ai_decisions
				  (caller, user_id, provider, model, prompt_hash,
				   prompt_tokens, output_tokens, total_tokens, latency_ms,
				   success, error_message, metadata)
				values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			`, e.Caller, nullableUUID(e.UserID), e.Provider, e.Model, e.PromptHash,
				e.PromptTokens, e.OutputTokens, e.TotalTokens, e.LatencyMS,
				e.Success, errMsg, nil)
			if err != nil {
				log.Printf("ai_decisions insert failed: %v (caller=%s)", err, e.Caller)
			}
		}()
	}
}

// nullableUUID returns nil for an empty string so the DB column stays
// NULL rather than throwing on an invalid UUID.
func nullableUUID(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}
