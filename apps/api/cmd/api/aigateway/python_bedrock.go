package aigateway

import (
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

// PythonBedrockProvider shells out to the boto3 bridge script. This is the
// production provider for the current Bedrock API-key path because boto3
// supports AWS_BEARER_TOKEN_BEDROCK exactly as tested locally.
type PythonBedrockProvider struct {
	pythonPath string
	scriptPath string
	model      string
	timeout    time.Duration
}

func NewPythonBedrockProvider() *PythonBedrockProvider {
	return &PythonBedrockProvider{
		pythonPath: envOrDefault("BEDROCK_PYTHON", "python"),
		scriptPath: envOrDefault("BEDROCK_PYTHON_SCRIPT", "scripts/call_bedrock_gpt_oss.py"),
		model:      envOrDefault("BEDROCK_MODEL", "openai.gpt-oss-120b-1:0"),
		timeout:    75 * time.Second,
	}
}

func (p *PythonBedrockProvider) Name() string { return "python-bedrock" }

func (p *PythonBedrockProvider) Configured() bool {
	if p == nil {
		return false
	}
	if bedrockBearerToken() == "" {
		return false
	}
	if strings.TrimSpace(p.pythonPath) == "" || strings.TrimSpace(p.scriptPath) == "" {
		return false
	}
	return true
}

func (p *PythonBedrockProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if p == nil {
		return Response{}, errors.New("python-bedrock: provider not initialised")
	}
	if !p.Configured() {
		return Response{}, errors.New("python-bedrock: AWS_BEARER_TOKEN_BEDROCK, BEDROCK_BEARER_TOKEN, or BEDROCK_API_KEY not set")
	}

	model := req.Model
	if model == "" {
		model = p.model
	}

	payload := pythonBedrockRequest{
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
		return Response{}, fmt.Errorf("python-bedrock: marshal request: %w", err)
	}

	cctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	scriptPath := resolvePythonBedrockScript(p.scriptPath)
	cmd := exec.CommandContext(cctx, p.pythonPath, scriptPath)
	cmd.Stdin = bytes.NewReader(rawPayload)
	cmd.Env = os.Environ()
	if tok := bedrockBearerToken(); tok != "" {
		cmd.Env = append(cmd.Env, "AWS_BEARER_TOKEN_BEDROCK="+tok)
	}

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if cctx.Err() != nil {
			return Response{}, fmt.Errorf("python-bedrock: timeout after %s", p.timeout)
		}
		return Response{}, fmt.Errorf("python-bedrock: %w: %s", err, truncate(strings.TrimSpace(stderr.String()), 500))
	}

	var parsed pythonBedrockResponse
	if err := json.Unmarshal(stdout.Bytes(), &parsed); err != nil {
		return Response{}, fmt.Errorf("python-bedrock: parse response: %w: %s", err, truncate(stdout.String(), 500))
	}

	return Response{
		Content:   parsed.Content,
		ToolCalls: parsed.ToolCalls,
		Provider:  firstNonEmpty(parsed.Provider, p.Name()),
		Model:     firstNonEmpty(parsed.Model, model),
		Usage:     parsed.Usage,
	}, nil
}

func resolvePythonBedrockScript(path string) string {
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

type pythonBedrockRequest struct {
	System      string    `json:"system,omitempty"`
	Messages    []Message `json:"messages"`
	Tools       []Tool    `json:"tools,omitempty"`
	Model       string    `json:"model,omitempty"`
	Temperature float64   `json:"temperature,omitempty"`
	MaxTokens   int       `json:"max_tokens,omitempty"`
	JSONMode    bool      `json:"json_mode,omitempty"`
}

type pythonBedrockResponse struct {
	Content   string     `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls"`
	Provider  string     `json:"provider"`
	Model     string     `json:"model"`
	Usage     Usage      `json:"usage"`
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
