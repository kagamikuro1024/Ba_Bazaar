// Package aitools is the registry of callable functions exposed to the
// LLM by every AI feature in ba-bazaar-api (Brief Composer, Manager
// Triage, AI Assistant).
//
// Each tool is a thin wrapper over the existing domain queries — we
// never re-implement business logic. The tool's job is to:
//  1. Validate the model's arguments (which can be unreliable).
//  2. Run a real DB read.
//  3. Return a JSON-serialisable result the model can reason over.
//
// Tools that mutate state are tagged Mutating. The agent loop uses
// that tag to enforce the 3-tier autonomy contract.
package aitools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"ba-bazaar-go/cmd/api/aigateway"
)

// DB is the minimal DB surface tools need. Matches aiagent.DBExec by
// design — tools don't import aiagent to avoid a cycle.
type DB interface {
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

// Rows is a tiny subset of pgx.Rows. We use it so this package
// doesn't have to import pgx directly. Implementations wrap pgx.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}

// Row is the pgx.Row surface tools use.
type Row interface {
	Scan(dest ...any) error
}

// Tier is the autonomy classification of a tool call.
type Tier int

const (
	// TierSuggest is read-only. The agent loop can call these
	// without asking the user.
	TierSuggest Tier = 1
	// TierDraft is a write that requires explicit user confirmation.
	// The agent loop stages the call into ai_pending_actions and
	// waits for the user to click Confirm or Undo.
	TierDraft Tier = 2
)

// Tool is the runtime representation of a callable function.
type Tool struct {
	// Name is the function name exposed to the LLM.
	Name string
	// Description is what the model reads to decide when to call.
	Description string
	// Tier is the autonomy classification.
	Tier Tier
	// AllowedRoles restricts who may stage/execute this tool. Empty
	// means every authenticated role. This mirrors the role gates on
	// the equivalent HTTP endpoints — the agent must never be a way
	// around them.
	AllowedRoles []string
	// Parameters is the JSON Schema describing the function args.
	Parameters map[string]any
	// Run executes the tool. Arguments are passed as the decoded
	// JSON the model emitted. Return value is serialised back to
	// the model as the tool's "result".
	Run func(ctx context.Context, db DB, args map[string]any) (any, error)
}

// Registry holds the full set of tools available to the agent.
type Registry struct {
	byName map[string]Tool
}

// New builds a registry with the standard ba-bazaar toolset.
func New() *Registry {
	r := &Registry{byName: map[string]Tool{}}
	r.add(searchBAs())
	r.add(getCapacity())
	r.add(listBookings())
	r.add(getBA())
	r.add(searchProjects())
	r.add(draftBooking())
	r.add(draftRejectBooking())
	r.add(draftCreateProject())
	return r
}

// Add registers a tool. Panics on duplicate name — that's a developer
// error, not a runtime condition.
func (r *Registry) add(t Tool) {
	if _, exists := r.byName[t.Name]; exists {
		panic("aitools: duplicate tool " + t.Name)
	}
	r.byName[t.Name] = t
}

// Get returns a tool by name.
func (r *Registry) Get(name string) (Tool, bool) {
	t, ok := r.byName[name]
	return t, ok
}

// All returns every tool, sorted by name for determinism.
func (r *Registry) All() []Tool {
	out := make([]Tool, 0, len(r.byName))
	for _, t := range r.byName {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// AsGatewayTools converts the registry into the gateway's chat Tool
// format, so the agent loop can pass them straight to aigateway.
func (r *Registry) AsGatewayTools() []aigateway.Tool {
	src := r.All()
	out := make([]aigateway.Tool, 0, len(src))
	for _, t := range src {
		out = append(out, aigateway.Tool{
			Name:        t.Name,
			Description: t.Description,
			Parameters:  t.Parameters,
		})
	}
	return out
}

// IsMutating returns true if the named tool requires user confirmation.
func (r *Registry) IsMutating(name string) bool {
	t, ok := r.byName[name]
	if !ok {
		return false
	}
	return t.Tier == TierDraft
}

// AllowedForRole reports whether the given role may use the named tool.
// Unknown tools are not allowed; tools without an AllowedRoles list are
// open to every authenticated role.
func (r *Registry) AllowedForRole(name, role string) bool {
	t, ok := r.byName[name]
	if !ok {
		return false
	}
	if len(t.AllowedRoles) == 0 {
		return true
	}
	for _, allowed := range t.AllowedRoles {
		if allowed == role {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Argument helpers — the LLM can send anything; we validate defensively.
// ---------------------------------------------------------------------------

func argString(args map[string]any, key string) (string, error) {
	v, ok := args[key]
	if !ok || v == nil {
		return "", fmt.Errorf("missing %q", key)
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%q must be a string", key)
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("%q is empty", key)
	}
	return s, nil
}

func argStringOpt(args map[string]any, key string) string {
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

func argInt(args map[string]any, key string) (int, error) {
	v, ok := args[key]
	if !ok || v == nil {
		return 0, fmt.Errorf("missing %q", key)
	}
	switch n := v.(type) {
	case float64:
		return int(n), nil
	case int:
		return n, nil
	case int64:
		return int(n), nil
	}
	return 0, fmt.Errorf("%q must be a number", key)
}

// escapeLike escapes the LIKE pattern metacharacters in user-supplied
// text so "50%" matches a literal percent sign instead of everything.
// Postgres' default LIKE escape character is backslash.
func escapeLike(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `%`, `\%`)
	s = strings.ReplaceAll(s, `_`, `\_`)
	return s
}

func argStringList(args map[string]any, key string) []string {
	v, ok := args[key]
	if !ok || v == nil {
		return nil
	}
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, x := range arr {
		if s, ok := x.(string); ok {
			s = strings.TrimSpace(s)
			if s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

// search_bars — natural-language BA search.
// Args: { query: string, level?: string, limit?: int }
func searchBAs() Tool {
	return Tool{
		Name: "search_bars",
		Description: "Search for Business Analyst profiles by free-text query (skills, domain, " +
			"or availability). Use this when the user asks 'who is good at X' or 'find me a BA with Y'.",
		Tier: TierSuggest,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "Free-text search."},
				"level": map[string]any{
					"type":        "string",
					"enum":        []string{"JUNIOR", "MIDDLE", "SENIOR", "LEAD"},
					"description": "Optional level filter.",
				},
				"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 25},
			},
			"required": []string{"query"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			q, err := argString(args, "query")
			if err != nil {
				return nil, err
			}
			level := argStringOpt(args, "level")
			limit := 10
			if v, ok := args["limit"]; ok {
				switch n := v.(type) {
				case float64:
					limit = int(n)
				case int:
					limit = n
				}
				if limit < 1 {
					limit = 1
				}
				if limit > 25 {
					limit = 25
				}
			}

			// Build a broader tag/name query. The LLM may ask for business terms
			// like "payments" while the database tag is "Fintech", so expand a
			// small synonym set before querying.
			terms := expandSearchTerms(q)
			whereParts := make([]string, 0, len(terms))
			args2 := make([]any, 0, len(terms)+1)
			for _, term := range terms {
				args2 = append(args2, "%"+escapeLike(strings.ToLower(term))+"%")
				whereParts = append(whereParts, fmt.Sprintf(`(lower(b.full_name) like $%d
				    or lower(coalesce(b.email,'')) like $%d
				    or lower(st.name) like $%d
				    or lower(st."group"::text) like $%d)`, len(args2), len(args2), len(args2), len(args2)))
			}
			sql := `
				select b.id, b.full_name, b.level, b.status,
				       coalesce(string_agg(st.name, ',' order by st.name), '') as tags
				from ba_profiles b
				left join ba_skill_tags bst on bst.ba_id = b.id
				left join skill_tags st on st.id = bst.tag_id
				where (` + strings.Join(whereParts, " or ") + `)
			`
			if level != "" {
				args2 = append(args2, level)
				sql += " and b.level = $" + itoa(len(args2))
			}
			sql += " group by b.id order by b.full_name asc limit 25"
			rows, err := db.Query(ctx, sql, args2...)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			results := make([]map[string]any, 0, limit)
			for rows.Next() {
				var id, name, lvl, status, tags string
				if err := rows.Scan(&id, &name, &lvl, &status, &tags); err != nil {
					return nil, err
				}
				// Compute a tiny relevance score: +3 for tag match, +1 for name match.
				score := 0
				qlTerms := expandSearchTerms(q)
				for _, term := range qlTerms {
					term = strings.ToLower(term)
					if strings.Contains(strings.ToLower(tags), term) {
						score += 3
					}
					if strings.Contains(strings.ToLower(name), term) {
						score++
					}
				}
				results = append(results, map[string]any{
					"id": id, "full_name": name, "level": lvl, "status": status,
					"tags": strings.Split(tags, ","), "relevance": score,
				})
			}
			// Sort by relevance desc, then name asc.
			sort.Slice(results, func(i, j int) bool {
				ri, _ := results[i]["relevance"].(int)
				rj, _ := results[j]["relevance"].(int)
				if ri != rj {
					return ri > rj
				}
				return results[i]["full_name"].(string) < results[j]["full_name"].(string)
			})
			if len(results) > limit {
				results = results[:limit]
			}
			return map[string]any{"results": results, "count": len(results)}, nil
		},
	}
}

func expandSearchTerms(q string) []string {
	base := strings.ToLower(strings.TrimSpace(q))
	seen := map[string]bool{}
	terms := make([]string, 0, 6)
	add := func(s string) {
		s = strings.ToLower(strings.TrimSpace(s))
		if s != "" && !seen[s] {
			seen[s] = true
			terms = append(terms, s)
		}
	}
	add(base)
	for _, word := range strings.Fields(base) {
		add(word)
	}
	synonyms := map[string][]string{
		"payment":  {"payments", "fintech", "finance", "banking", "api"},
		"payments": {"payment", "fintech", "finance", "banking", "api"},
		"crm":      {"customer", "salesforce", "bpmn"},
		"api":      {"api specification", "integration"},
		"data":     {"analytics", "analysis", "reporting"},
	}
	for term, expanded := range synonyms {
		if strings.Contains(base, term) {
			for _, s := range expanded {
				add(s)
			}
		}
	}
	return terms
}

// get_capacity — capacity for one BA in a date range.
// Args: { ba_id: string, start_date: YYYY-MM-DD, end_date: YYYY-MM-DD }
func getCapacity() Tool {
	return Tool{
		Name:        "get_capacity",
		Description: "Get capacity (in percent) for a specific BA between two dates. Use this when the user asks 'how busy is X' or 'is X free next week'.",
		Tier:        TierSuggest,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"ba_id":      map[string]any{"type": "string"},
				"start_date": map[string]any{"type": "string", "description": "YYYY-MM-DD"},
				"end_date":   map[string]any{"type": "string", "description": "YYYY-MM-DD"},
			},
			"required": []string{"ba_id", "start_date", "end_date"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			baID, err := argString(args, "ba_id")
			if err != nil {
				return nil, err
			}
			start, err := argString(args, "start_date")
			if err != nil {
				return nil, err
			}
			end, err := argString(args, "end_date")
			if err != nil {
				return nil, err
			}
			startD, err := time.Parse("2006-01-02", start)
			if err != nil {
				return nil, fmt.Errorf("start_date: %w", err)
			}
			endD, err := time.Parse("2006-01-02", end)
			if err != nil {
				return nil, fmt.Errorf("end_date: %w", err)
			}
			if endD.Before(startD) {
				return nil, errors.New("end_date is before start_date")
			}
			// Sum capacity_percent of approved/in-progress bookings that
			// overlap the window, clamped to 100.
			const q = `
				select coalesce(sum(
					least(capacity_percent, 100)
				), 0)::int as used
				from bookings
				where ba_id = $1
				  and status in ('APPROVED','IN_PROGRESS','PENDING')
				  and start_date <= $3
				  and end_date   >= $2
			`
			var used int
			if err := db.QueryRow(ctx, q, baID, startD, endD).Scan(&used); err != nil {
				return nil, err
			}
			available := 100 - used
			if available < 0 {
				available = 0
			}
			return map[string]any{
				"ba_id":         baID,
				"start_date":    start,
				"end_date":      end,
				"used_percent":  used,
				"free_percent":  available,
				"is_overloaded": used > 100,
			}, nil
		},
	}
}

// list_bookings — list bookings, optionally filtered.
// Args: { status?: string, ba_id?: string, project_id?: string, limit?: int }
func listBookings() Tool {
	return Tool{
		Name:        "list_bookings",
		Description: "List bookings. Filter by status, BA, or project. Use when the user asks 'what is on Trung's plate' or 'show pending requests'.",
		Tier:        TierSuggest,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"status":     map[string]any{"type": "string"},
				"ba_id":      map[string]any{"type": "string"},
				"project_id": map[string]any{"type": "string"},
				"limit":      map[string]any{"type": "integer"},
			},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			limit := 20
			if v, ok := args["limit"]; ok {
				switch n := v.(type) {
				case float64:
					limit = int(n)
				case int:
					limit = n
				}
				if limit < 1 {
					limit = 1
				}
				if limit > 100 {
					limit = 100
				}
			}
			sql := `select id, ba_id, project_id, title, start_date, end_date, capacity_percent, status, priority
			        from bookings where 1=1`
			qargs := []any{}
			idx := 1
			if s := argStringOpt(args, "status"); s != "" {
				sql += " and status = $" + itoa(idx)
				qargs = append(qargs, s)
				idx++
			}
			if b := argStringOpt(args, "ba_id"); b != "" {
				sql += " and ba_id = $" + itoa(idx)
				qargs = append(qargs, b)
				idx++
			}
			if p := argStringOpt(args, "project_id"); p != "" {
				sql += " and project_id = $" + itoa(idx)
				qargs = append(qargs, p)
				idx++
			}
			sql += " order by start_date desc limit $" + itoa(idx)
			qargs = append(qargs, limit)
			rows, err := db.Query(ctx, sql, qargs...)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := make([]map[string]any, 0, limit)
			for rows.Next() {
				var id string
				var baID, projectID *string
				var title string
				var startD, endD time.Time
				var cap int
				var status, prio string
				if err := rows.Scan(&id, &baID, &projectID, &title, &startD, &endD, &cap, &status, &prio); err != nil {
					return nil, err
				}
				out = append(out, map[string]any{
					"id":               id,
					"ba_id":            baID,
					"project_id":       projectID,
					"title":            title,
					"start_date":       startD.Format("2006-01-02"),
					"end_date":         endD.Format("2006-01-02"),
					"capacity_percent": cap,
					"status":           status,
					"priority":         prio,
				})
			}
			return map[string]any{"bookings": out, "count": len(out)}, nil
		},
	}
}

// get_ba — full BA profile by id or name.
// Args: { ba_id: string }
func getBA() Tool {
	return Tool{
		Name:        "get_ba",
		Description: "Get a single BA's full profile by id, including their skills and current capacity.",
		Tier:        TierSuggest,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"ba_id": map[string]any{"type": "string"},
			},
			"required": []string{"ba_id"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			baID, err := argString(args, "ba_id")
			if err != nil {
				return nil, err
			}
			const q = `
				select b.id, b.full_name, b.email, b.level, b.status,
				       coalesce(json_agg(
				         json_build_object('id', st.id, 'name', st.name, 'group', st."group", 'status', st.status)
				         order by st."group", st.name
				       ) filter (where st.id is not null), '[]'::json) as skill_tags
				from ba_profiles b
				left join ba_skill_tags bst on bst.ba_id = b.id
				left join skill_tags st on st.id = bst.tag_id
				where b.id = $1
				group by b.id
			`
			var id, name, email, level, status string
			var tagsJSON []byte
			if err := db.QueryRow(ctx, q, baID).Scan(&id, &name, &email, &level, &status, &tagsJSON); err != nil {
				return nil, fmt.Errorf("ba not found: %w", err)
			}
			var tags []map[string]any
			_ = json.Unmarshal(tagsJSON, &tags)
			return map[string]any{
				"id": id, "full_name": name, "email": email, "level": level,
				"status":     status,
				"skill_tags": tags,
			}, nil
		},
	}
}

// search_projects — find projects by name.
// Args: { query: string, limit?: int }
func searchProjects() Tool {
	return Tool{
		Name:        "search_projects",
		Description: "Search projects by name. Use this to resolve a project name like 'Project Falcon' into a project_id before drafting a booking.",
		Tier:        TierSuggest,
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string"},
				"limit": map[string]any{"type": "integer", "minimum": 1, "maximum": 25},
			},
			"required": []string{"query"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			q, err := argString(args, "query")
			if err != nil {
				return nil, err
			}
			limit := 10
			if v, ok := args["limit"]; ok {
				switch n := v.(type) {
				case float64:
					limit = int(n)
				case int:
					limit = n
				}
			}
			if limit < 1 {
				limit = 1
			}
			if limit > 25 {
				limit = 25
			}
			needle := "%" + escapeLike(strings.ToLower(strings.TrimPrefix(q, "project "))) + "%"
			rows, err := db.Query(ctx, `
				select id, name, coalesce(description, ''), color
				from projects
				where lower(name) like $1 or lower(coalesce(description, '')) like $1
				order by case when lower(name) = lower($2) then 0 else 1 end, name
				limit $3
			`, needle, q, limit)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			projects := make([]map[string]any, 0, limit)
			for rows.Next() {
				var id, name, description, color string
				if err := rows.Scan(&id, &name, &description, &color); err != nil {
					return nil, err
				}
				projects = append(projects, map[string]any{"id": id, "name": name, "description": description, "color": color})
			}
			return map[string]any{"projects": projects, "count": len(projects)}, rows.Err()
		},
	}
}

// draft_booking — creates a PENDING booking after manager confirmation.
// Args: { ba_id, project_id, title, description, start_date, end_date, capacity_percent, priority }
func draftBooking() Tool {
	return Tool{
		Name: "draft_booking",
		Description: "Draft a new booking for a BA on a project. Returns a draft preview that the user " +
			"must confirm before it becomes a real booking. Use this whenever the user wants to " +
			"assign someone to a project. NEVER call this without first having shown the user which " +
			"BA and which dates via search_bars / get_capacity.",
		Tier: TierDraft,
		// Mirrors canCreateBookingRequest on the HTTP layer.
		AllowedRoles: []string{"PM_PO", "BA_MANAGER"},
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"ba_id":            map[string]any{"type": "string"},
				"project_id":       map[string]any{"type": "string"},
				"title":            map[string]any{"type": "string"},
				"description":      map[string]any{"type": "string"},
				"start_date":       map[string]any{"type": "string", "description": "YYYY-MM-DD"},
				"end_date":         map[string]any{"type": "string", "description": "YYYY-MM-DD"},
				"capacity_percent": map[string]any{"type": "integer", "enum": []int{50, 100}},
				"priority":         map[string]any{"type": "string", "enum": []string{"LOW", "MEDIUM", "HIGH", "URGENT"}},
			},
			"required": []string{"ba_id", "project_id", "title", "start_date", "end_date", "capacity_percent"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			// We don't actually write here — the agent loop stages the
			// call and the user confirms it via /ai/agent/confirm. This
			// function only returns the preview the user will see.
			// Validation still matters: a draft that can never be
			// executed should be refused now, with a reason the model
			// can relay, not after the user clicks Confirm.
			baID, err := argString(args, "ba_id")
			if err != nil {
				return nil, err
			}
			projectID, err := argString(args, "project_id")
			if err != nil {
				return nil, err
			}
			title, _ := argString(args, "title")
			start, err := argString(args, "start_date")
			if err != nil {
				return nil, err
			}
			end, err := argString(args, "end_date")
			if err != nil {
				return nil, err
			}
			startD, err := time.Parse("2006-01-02", start)
			if err != nil {
				return nil, fmt.Errorf("start_date: %w", err)
			}
			endD, err := time.Parse("2006-01-02", end)
			if err != nil {
				return nil, fmt.Errorf("end_date: %w", err)
			}
			if endD.Before(startD) {
				return nil, errors.New("end_date is before start_date")
			}
			cap, _ := argInt(args, "capacity_percent")
			if cap != 50 && cap != 100 {
				return nil, errors.New("capacity_percent must be 50 or 100")
			}
			priority := argStringOpt(args, "priority")
			if priority == "" {
				priority = "MEDIUM"
			}
			description := argStringOpt(args, "description")

			// Fetch human-readable names for the preview. Best-effort:
			// if the DB is unreachable we still return a usable draft.
			baName, projectName, baStatus := baID, projectID, ""
			if db != nil {
				_ = db.QueryRow(ctx, `select full_name, status from ba_profiles where id=$1`, baID).Scan(&baName, &baStatus)
				_ = db.QueryRow(ctx, `select name from projects where id=$1`, projectID).Scan(&projectName)
				if baName == "" {
					baName = baID
				}
				if projectName == "" {
					projectName = projectID
				}
			}
			// Hard rule: never draft a booking for a BA who can't take it.
			if baStatus != "" && baStatus != "ACTIVE" {
				return nil, fmt.Errorf("BA %s is %s and cannot be booked", baName, baStatus)
			}

			return map[string]any{
				"summary": fmt.Sprintf("Book %s on %s (%s → %s, %d%%)", baName, projectName, start, end, cap),
				"draft": map[string]any{
					"ba_id":            baID,
					"ba_name":          baName,
					"project_id":       projectID,
					"project_name":     projectName,
					"title":            title,
					"description":      description,
					"start_date":       start,
					"end_date":         end,
					"capacity_percent": cap,
					"priority":         priority,
				},
				"requires_confirmation": true,
			}, nil
		},
	}
}

// draft_create_project — drafts a new project for the user to confirm.
// Args: { name: string, description?: string, color?: string }
func draftCreateProject() Tool {
	return Tool{
		Name: "draft_create_project",
		Description: "Draft creating a new project with the given name. The user must confirm " +
			"before the project is persisted. Use this only when a booking request references a " +
			"project that does not exist yet and the user has agreed to create it.",
		Tier: TierDraft,
		// Project creation supports the booking flow, so it carries the
		// same gate as creating a booking request.
		AllowedRoles: []string{"PM_PO", "BA_MANAGER"},
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"name":        map[string]any{"type": "string"},
				"description": map[string]any{"type": "string"},
				"color":       map[string]any{"type": "string"},
			},
			"required": []string{"name"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			name, _ := argString(args, "name")
			if name == "" {
				return nil, fmt.Errorf("missing %q", "name")
			}
			description := argStringOpt(args, "description")
			color := argStringOpt(args, "color")
			if color == "" {
				color = "#2563EB"
			}

			alreadyExists := false
			if db != nil {
				_ = db.QueryRow(ctx, `select exists(select 1 from projects where lower(name) = lower($1))`, name).Scan(&alreadyExists)
			}

			return map[string]any{
				"summary": fmt.Sprintf("Create project %q", name),
				"draft": map[string]any{
					"name":        name,
					"description": description,
					"color":       color,
				},
				"already_exists":        alreadyExists,
				"requires_confirmation": true,
			}, nil
		},
	}
}

// draft_reject_booking — drafts a rejection of a booking request.
// Args: { booking_id: string, reason: string }
func draftRejectBooking() Tool {
	return Tool{
		Name: "draft_reject_booking",
		Description: "Draft a rejection for a PENDING booking request. The reason must be quoted " +
			"verbatim from the manager. The user must confirm before the rejection is recorded.",
		Tier: TierDraft,
		// Mirrors canApproveBooking on the HTTP layer.
		AllowedRoles: []string{"BA_MANAGER"},
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"booking_id": map[string]any{"type": "string"},
				"reason":     map[string]any{"type": "string"},
			},
			"required": []string{"booking_id", "reason"},
		},
		Run: func(ctx context.Context, db DB, args map[string]any) (any, error) {
			bookingID, err := argString(args, "booking_id")
			if err != nil {
				return nil, err
			}
			reason, err := argString(args, "reason")
			if err != nil {
				return nil, err
			}
			var title, status string
			_ = db.QueryRow(ctx, `select title, status from bookings where id=$1`, bookingID).Scan(&title, &status)
			if status != "PENDING" {
				return nil, fmt.Errorf("booking is %s, only PENDING bookings can be rejected", status)
			}
			return map[string]any{
				"summary": fmt.Sprintf("Reject booking %s: %q", title, reason),
				"draft": map[string]any{
					"booking_id": bookingID,
					"title":      title,
					"reason":     reason,
				},
				"requires_confirmation": true,
			}, nil
		},
	}
}

// itoa avoids pulling strconv into the hot path.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func splitNonEmpty(s, sep string) []string {
	if s == "" {
		return []string{}
	}
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// AsJSONString is a tiny debug helper.
func AsJSONString(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
