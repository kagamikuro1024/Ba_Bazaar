package aiagent

import (
	"context"
	"errors"
	"strings"
	"time"

	"ba-bazaar-go/cmd/api/aitools"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store is the persistence surface the agent loop uses. It is
// separated from DBExec so unit tests can substitute a fake without
// having to fake pgx.Rows (which is a fat struct, not a small
// interface). Production wires StoreFromDB below.
type Store interface {
	// AppendMessage persists one message in a conversation.
	// toolCallsJSON carries the assistant's tool_calls (nil otherwise)
	// so history replay can reconstruct the provider protocol exactly.
	AppendMessage(ctx context.Context, convID, role, content string, toolCallID, toolName string, toolCallsJSON []byte) error
	// LoadHistory returns the last `limit` messages for a conversation
	// in chronological order.
	LoadHistory(ctx context.Context, convID string, limit int) ([]storedMessage, error)
	// EnsureConversation returns convID, creating it if needed.
	EnsureConversation(ctx context.Context, userID, convID, firstMessage string) (string, error)
	// StagePendingAction inserts a row into ai_pending_actions.
	StagePendingAction(ctx context.Context, userID, convID, toolName string, argsJSON, previewJSON []byte, undoWindowSeconds int) (id string, expiresAt time.Time, err error)
	// LoadPendingAction returns the tool_name, args, status, and
	// expires_at for a pending action owned by userID.
	LoadPendingAction(ctx context.Context, userID, pendingID string) (toolName string, argsJSON []byte, status string, expiresAt time.Time, err error)
	// ClaimPendingAction atomically flips PENDING → CONFIRMING for a
	// non-expired action owned by userID. claimed=false (with nil err)
	// means the row was missing, expired, or already claimed/finalised
	// — i.e. the caller lost the compare-and-swap.
	ClaimPendingAction(ctx context.Context, userID, pendingID string, now time.Time) (toolName string, argsJSON []byte, claimed bool, err error)
	// MarkExecuted flips status to EXECUTED and stores the result id.
	MarkExecuted(ctx context.Context, pendingID, resultID string) error
	// MarkFailed flips a claimed action to FAILED after the domain
	// write errored, so the user can re-draft instead of re-confirming.
	MarkFailed(ctx context.Context, pendingID string) error
	// MarkExpired flips a pending action to EXPIRED.
	MarkExpired(ctx context.Context, pendingID string) error
	// MarkUndone flips a pending action to UNDONE.
	MarkUndone(ctx context.Context, userID, pendingID string) (bool, error)
	// LookupUserByID returns a display name for the user — used
	// to label pending actions in the UI.
	LookupUserByID(ctx context.Context, userID string) (string, error)
}

// dbStore implements Store on top of *pgxpool.Pool.
type dbStore struct {
	pool *pgxpool.Pool
}

// StoreFromDB returns a Store backed by the given pool.
func StoreFromDB(pool *pgxpool.Pool) Store { return &dbStore{pool: pool} }

func (s *dbStore) AppendMessage(ctx context.Context, convID, role, content string, toolCallID, toolName string, toolCallsJSON []byte) error {
	var tcid, tname, tcalls any
	if toolCallID != "" {
		tcid = toolCallID
	}
	if toolName != "" {
		tname = toolName
	}
	if len(toolCallsJSON) > 0 && string(toolCallsJSON) != "null" && string(toolCallsJSON) != "[]" {
		tcalls = toolCallsJSON
	}
	_, err := s.pool.Exec(ctx, `
		insert into ai_messages (conversation_id, role, content, tool_call_id, tool_name, tool_calls)
		values ($1,$2,$3,$4,$5,$6)
	`, convID, role, content, tcid, tname, tcalls)
	return err
}

func (s *dbStore) LoadHistory(ctx context.Context, convID string, limit int) ([]storedMessage, error) {
	rows, err := s.pool.Query(ctx, `
		select role, content, coalesce(tool_call_id,''), coalesce(tool_name,''), tool_calls
		from (
			select id, role, content, tool_call_id, tool_name, tool_calls
			from ai_messages
			where conversation_id = $1
			order by created_at desc
			limit $2
		) h
		order by id asc
	`, convID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]storedMessage, 0, limit)
	for rows.Next() {
		var m storedMessage
		if err := rows.Scan(&m.Role, &m.Content, &m.ToolCallID, &m.ToolName, &m.ToolCallsJSON); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *dbStore) EnsureConversation(ctx context.Context, userID, convID, firstMessage string) (string, error) {
	if convID != "" {
		var exists bool
		if err := s.pool.QueryRow(ctx, `select exists(select 1 from ai_conversations where id=$1 and user_id=$2)`, convID, userID).Scan(&exists); err != nil {
			return "", err
		}
		if exists {
			_, _ = s.pool.Exec(ctx, `update ai_conversations set updated_at=now() where id=$1`, convID)
			return convID, nil
		}
	}
	id := uuid.NewString()
	title := strings.TrimSpace(firstMessage)
	if len(title) > 80 {
		title = title[:80] + "…"
	}
	_, err := s.pool.Exec(ctx, `
		insert into ai_conversations (id, user_id, title, created_at, updated_at)
		values ($1, $2, $3, now(), now())
	`, id, userID, title)
	return id, err
}

func (s *dbStore) StagePendingAction(ctx context.Context, userID, convID, toolName string, argsJSON, previewJSON []byte, undoWindowSeconds int) (string, time.Time, error) {
	id := uuid.NewString()
	expires := time.Now().Add(time.Duration(undoWindowSeconds) * time.Second)
	var convArg any
	if convID != "" {
		convArg = convID
	}
	_, err := s.pool.Exec(ctx, `
		insert into ai_pending_actions
		  (id, user_id, conversation_id, tool_name, tool_args, preview,
		   status, undo_window_seconds, expires_at, created_at)
		values ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,now())
	`, id, userID, convArg, toolName, argsJSON, previewJSON, undoWindowSeconds, expires)
	return id, expires, err
}

func (s *dbStore) LoadPendingAction(ctx context.Context, userID, pendingID string) (string, []byte, string, time.Time, error) {
	var toolName string
	var argsJSON []byte
	var status string
	var expiresAt time.Time
	err := s.pool.QueryRow(ctx, `
		select tool_name, tool_args, status, expires_at
		from ai_pending_actions
		where id = $1 and user_id = $2
	`, pendingID, userID).Scan(&toolName, &argsJSON, &status, &expiresAt)
	return toolName, argsJSON, status, expiresAt, err
}

func (s *dbStore) ClaimPendingAction(ctx context.Context, userID, pendingID string, now time.Time) (string, []byte, bool, error) {
	var toolName string
	var argsJSON []byte
	err := s.pool.QueryRow(ctx, `
		update ai_pending_actions
		set status='CONFIRMING', confirmed_at=now()
		where id=$1 and user_id=$2 and status='PENDING' and expires_at > $3
		returning tool_name, tool_args
	`, pendingID, userID, now).Scan(&toolName, &argsJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false, nil
	}
	if err != nil {
		return "", nil, false, err
	}
	return toolName, argsJSON, true, nil
}

func (s *dbStore) MarkFailed(ctx context.Context, pendingID string) error {
	_, err := s.pool.Exec(ctx, `
		update ai_pending_actions
		set status='FAILED', executed_at=now()
		where id=$1
	`, pendingID)
	return err
}

func (s *dbStore) MarkExecuted(ctx context.Context, pendingID, resultID string) error {
	_, err := s.pool.Exec(ctx, `
		update ai_pending_actions
		set status='EXECUTED', confirmed_at=now(), executed_at=now(), result_id=$2
		where id=$1
	`, pendingID, resultID)
	return err
}

func (s *dbStore) MarkExpired(ctx context.Context, pendingID string) error {
	_, err := s.pool.Exec(ctx, `update ai_pending_actions set status='EXPIRED' where id=$1`, pendingID)
	return err
}

func (s *dbStore) MarkUndone(ctx context.Context, userID, pendingID string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		update ai_pending_actions
		set status='UNDONE', confirmed_at=now()
		where id=$1 and user_id=$2 and status='PENDING'
	`, pendingID, userID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *dbStore) LookupUserByID(ctx context.Context, userID string) (string, error) {
	var name string
	err := s.pool.QueryRow(ctx, `select full_name from users where id=$1`, userID).Scan(&name)
	return name, err
}

// DBExec is the subset of pgxpool the agent needs for tool execution.
// Defined as an interface so tests can swap in a fake without standing
// up Postgres. The return types are the concrete pgx types so
// production wiring stays one-liner; tests use the helper below.
type DBExec interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// CommandTag is a small helper to build an "empty successful" tag
// in tests. Production code never calls this — it uses pgxpool
// which returns its own CommandTag.
func CommandTag() pgconn.CommandTag {
	return pgconn.CommandTag{}
}

// AsAIToolsDB returns an aitools.DB view of this DBExec. Used when
// the agent hands the DB to a tool. Returns a nil-safe wrapper so
// unit tests can pass DB=nil and still exercise the rest of the loop.
func (l *Loop) AsAIToolsDB() aitools.DB {
	if l.DB == nil {
		return nilDB{}
	}
	return &aitoolsDBAdapter{inner: l.DB}
}

// nilDB is a do-nothing DB used in unit tests. Every tool's Run func
// must check for nil and degrade gracefully.
type nilDB struct{}

func (nilDB) Query(ctx context.Context, sql string, args ...any) (aitools.Rows, error) {
	return nilRows{}, nil
}
func (nilDB) QueryRow(ctx context.Context, sql string, args ...any) aitools.Row {
	return nilRow{}
}

type nilRows struct{}

func (nilRows) Next() bool        { return false }
func (nilRows) Scan(...any) error { return nil }
func (nilRows) Err() error        { return nil }
func (nilRows) Close()            {}

type nilRow struct{}

func (nilRow) Scan(...any) error { return nil }

// poolDB adapts a *pgxpool.Pool to DBExec.
type poolDB struct {
	pool *pgxpool.Pool
}

func (p *poolDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return p.pool.Exec(ctx, sql, args...)
}

func (p *poolDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return p.pool.Query(ctx, sql, args...)
}

func (p *poolDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return p.pool.QueryRow(ctx, sql, args...)
}

// aitoolsDBAdapter bridges DBExec → aitools.DB. We do this so the
// agent's DB type stays the pgx-natives (for the message persistence
// code) while the tools see the smaller aitools.DB surface.
type aitoolsDBAdapter struct {
	inner DBExec
}

func (a *aitoolsDBAdapter) Query(ctx context.Context, sql string, args ...any) (aitools.Rows, error) {
	rows, err := a.inner.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return &rowsAdapter{rows: rows}, nil
}

func (a *aitoolsDBAdapter) QueryRow(ctx context.Context, sql string, args ...any) aitools.Row {
	return a.inner.QueryRow(ctx, sql, args...)
}

type rowsAdapter struct {
	rows pgx.Rows
}

func (r *rowsAdapter) Next() bool         { return r.rows.Next() }
func (r *rowsAdapter) Scan(d ...any) error { return r.rows.Scan(d...) }
func (r *rowsAdapter) Err() error          { return r.rows.Err() }
func (r *rowsAdapter) Close()              { r.rows.Close() }
