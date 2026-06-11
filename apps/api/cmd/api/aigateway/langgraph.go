package aigateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// LangGraphProvider shells out to the Python LangGraph bridge.
type LangGraphProvider struct {
	pythonPath string
	scriptPath string
	model      string
	timeout    time.Duration
}

func NewLangGraphProvider() *LangGraphProvider {
	return &LangGraphProvider{
		pythonPath: envOrDefault("LANGGRAPH_PYTHON", "python"),
		scriptPath: envOrDefault("LANGGRAPH_SCRIPT", "scripts/langgraph_gateway.py"),
		model:      envOrDefault("DEEPSEEK_MODEL", "deepseek-chat"),
		timeout:    90 * time.Second,
	}
}

func (p *LangGraphProvider) Name() string { return "python-langgraph" }

func (p *LangGraphProvider) Configured() bool {
	return p != nil && strings.TrimSpace(os.Getenv("DEEPSEEK_API_KEY")) != ""
}

func (p *LangGraphProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if p == nil {
		return Response{}, errors.New("python-langgraph: provider not initialised")
	}
	if !p.Configured() {
		return Response{}, errors.New("python-langgraph: DEEPSEEK_API_KEY not set")
	}
	model := req.Model
	if model == "" {
		model = p.model
	}
	payload := langGraphRequest{
		System:      req.System,
		Messages:    req.Messages,
		Tools:       req.Tools,
		Model:       model,
		Temperature: pickFloat(req.Temperature, 0.2),
		MaxTokens:   pickInt(req.MaxTokens, 800),
		JSONMode:    req.JSONMode,
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return Response{}, fmt.Errorf("python-langgraph: marshal request: %w", err)
	}

	cctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, p.pythonPath, resolveLangGraphScript(p.scriptPath))
	cmd.Stdin = bytes.NewReader(rawPayload)
	cmd.Env = os.Environ()
	if req.OnToken != nil && len(req.Tools) == 0 && !req.JSONMode {
		cmd.Env = append(cmd.Env, "LANGGRAPH_STREAM=1")
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		if cctx.Err() != nil {
			return Response{}, fmt.Errorf("python-langgraph: timeout after %s", p.timeout)
		}
		return Response{}, fmt.Errorf("python-langgraph: %w: %s", err, truncate(strings.TrimSpace(stderr.String()+" "+stdout.String()), 500))
	}
	return parseLangGraphOutput(stdout.Bytes(), model, req.OnToken)
}

func parseLangGraphOutput(raw []byte, model string, onToken func(string)) (Response, error) {
	var last langGraphEvent
	scanner := bufio.NewScanner(bytes.NewReader(raw))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var event langGraphEvent
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			var resp langGraphResponse
			if err := json.Unmarshal(raw, &resp); err != nil {
				return Response{}, fmt.Errorf("python-langgraph: parse response: %w", err)
			}
			return resp.toGateway(model), nil
		}
		switch event.Type {
		case "token":
			if onToken != nil && event.Text != "" {
				onToken(event.Text)
			}
		case "error":
			return Response{}, errors.New(event.Message)
		case "final":
			last = event
		case "":
			last.Response = &event.langGraphResponse
		}
	}
	if err := scanner.Err(); err != nil {
		return Response{}, err
	}
	if last.Response == nil {
		return Response{}, errors.New("python-langgraph: missing final response")
	}
	return last.Response.toGateway(model), nil
}

func resolveLangGraphScript(path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	if _, err := os.Stat(path); err == nil {
		return path
	}
	cwd, err := os.Getwd()
	if err != nil {
		return path
	}
	for dir := cwd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, path)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
	}
	return path
}

type langGraphRequest struct {
	System      string    `json:"system,omitempty"`
	Messages    []Message `json:"messages"`
	Tools       []Tool    `json:"tools,omitempty"`
	Model       string    `json:"model,omitempty"`
	Temperature float64   `json:"temperature,omitempty"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	JSONMode    bool      `json:"json_mode,omitempty"`
}

type langGraphEvent struct {
	Type     string             `json:"type"`
	Text     string             `json:"text,omitempty"`
	Message  string             `json:"message,omitempty"`
	Response *langGraphResponse `json:"response,omitempty"`
	langGraphResponse
}

type langGraphResponse struct {
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls"`
	Provider  string     `json:"provider"`
	Model     string     `json:"model"`
	Usage     Usage      `json:"usage"`
}

func (r langGraphResponse) toGateway(model string) Response {
	return Response{Content: r.Content, ToolCalls: r.ToolCalls, Provider: firstNonEmpty(r.Provider, "python-langgraph"), Model: firstNonEmpty(r.Model, model), Usage: r.Usage}
}
