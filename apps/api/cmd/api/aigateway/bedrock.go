// Package aigateway - bedrock provider (aws-sdk-go-v2, Converse API)
//
// This provider is the production path for Ba-Bazaar. It uses the
// official AWS SDK for Go v2 with the Converse API, which is the
// recommended way to call any Bedrock model: it abstracts over the
// model-specific request/response shapes, so we can swap gpt-oss-120b
// for Claude, Llama, or whatever AWS hosts next without changing
// gateway code.
//
// Auth:
//   The default uses the standard AWS credential chain
//   (env vars, shared config, IMDS, etc.). For local dev you can
//   set:
//
//     AWS_BEARER_TOKEN_BEDROCK=ABSK...
//     AWS_REGION=us-west-2
//
//   BEDROCK_BEARER_TOKEN is also accepted as an app-specific alias.
//   Standard AWS SigV4 credentials still work through the default chain:
//
//     AWS_ACCESS_KEY_ID=AKIA...
//     AWS_SECRET_ACCESS_KEY=***
//     AWS_REGION=us-west-2
//
//   The bearer token path is wired through the SDK's HTTP bearer auth
//   provider, matching boto3's AWS_BEARER_TOKEN_BEDROCK behavior.
//
// Model id:
//   Default is `openai.gpt-oss-120b-1:0` per the project plan. The
//   full Bedrock model id format is required.

package aigateway

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	brdoc "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	brtypes "github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	smithybearer "github.com/aws/smithy-go/auth/bearer"
)

// BedrockProvider wraps the AWS SDK v2 Bedrock Runtime client.
type BedrockProvider struct {
	client *bedrockruntime.Client
	model  string
	region string
}

// NewBedrockProvider builds a BedrockRuntime client using either the
// AWS credential chain or a static Bedrock bearer token if
// BEDROCK_BEARER_TOKEN / AWS_BEARER_TOKEN_BEDROCK is set.
func NewBedrockProvider() (*BedrockProvider, error) {
	region := envOrDefault("AWS_REGION", "us-east-1")

	var opts []func(*awsconfig.LoadOptions) error
	opts = append(opts, awsconfig.WithRegion(region))

	// Bedrock API keys use HTTP bearer auth, not SigV4 static credentials.
	// AWS also recognizes AWS_BEARER_TOKEN_BEDROCK in boto3; support both
	// names here so local setup matches the Python SDK path.
	if tok := bedrockBearerToken(); tok != "" {
		opts = append(opts, awsconfig.WithBearerAuthTokenProvider(
			smithybearer.StaticTokenProvider{Token: smithybearer.Token{Value: tok}},
		))
	}

	cfg, err := awsconfig.LoadDefaultConfig(context.Background(), opts...)
	if err != nil {
		return nil, fmt.Errorf("bedrock: load config: %w", err)
	}

	client := bedrockruntime.NewFromConfig(cfg)
	return &BedrockProvider{
		client: client,
		model:  envOrDefault("BEDROCK_MODEL", "openai.gpt-oss-120b-1:0"),
		region: region,
	}, nil
}

func (b *BedrockProvider) Name() string { return "bedrock" }

// Configured reports whether the provider has the minimum it needs
// to make a call. We check env-var-based credentials directly; the
// SDK's own credential chain (IMDS, profile, etc.) is hard to
// probe from this function and the SDK will surface the real error
// at call time.
func (b *BedrockProvider) Configured() bool {
	if b == nil || b.client == nil {
		return false
	}
	if bedrockBearerToken() != "" {
		return true
	}
	if strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID")) != "" &&
		strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY")) != "" {
		return true
	}
	return false
}

func bedrockBearerToken() string {
	for _, key := range []string{"AWS_BEARER_TOKEN_BEDROCK", "BEDROCK_BEARER_TOKEN", "BEDROCK_API_KEY"} {
		if tok := strings.TrimSpace(os.Getenv(key)); tok != "" {
			return tok
		}
	}
	return ""
}

// Complete implements Provider using the Converse API. Converse is
// the model-agnostic interface AWS recommends; it normalises
// tool-calling, system prompts, and content blocks across all
// supported models.
func (b *BedrockProvider) Complete(ctx context.Context, req Request) (Response, error) {
	if b == nil || b.client == nil {
		return Response{}, errors.New("bedrock: provider not initialised")
	}

	model := req.Model
	if model == "" {
		model = b.model
	}

	input := &bedrockruntime.ConverseInput{
		ModelId:  aws.String(model),
		Messages: buildConverseMessages(req.Messages),
		InferenceConfig: &brtypes.InferenceConfiguration{
			MaxTokens:   aws.Int32(int32(pickInt(req.MaxTokens, 800))),
			Temperature: aws.Float32(float32(pickFloat(req.Temperature, 0.2))),
		},
	}
	if req.System != "" {
		input.System = []brtypes.SystemContentBlock{
			&brtypes.SystemContentBlockMemberText{Value: req.System},
		}
	}
	if len(req.Tools) > 0 {
		input.ToolConfig = buildToolConfig(req.Tools)
	}

	// 60s deadline per call so a stuck Converse can't hold a
	// goroutine forever.
	cctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	out, err := b.client.Converse(cctx, input)
	if err != nil {
		return Response{}, fmt.Errorf("bedrock converse: %w", err)
	}

	resp := Response{
		Provider: b.Name(),
		Model:    model,
	}
	if out.Usage != nil {
		resp.Usage = Usage{
			PromptTokens:     int(aws.ToInt32(out.Usage.InputTokens)),
			CompletionTokens: int(aws.ToInt32(out.Usage.OutputTokens)),
			TotalTokens:      int(aws.ToInt32(out.Usage.TotalTokens)),
		}
	}

	if out.Output != nil {
		if msg, ok := out.Output.(*brtypes.ConverseOutputMemberMessage); ok {
			for _, block := range msg.Value.Content {
				switch v := block.(type) {
				case *brtypes.ContentBlockMemberText:
					if resp.Content == "" {
						resp.Content = v.Value
					} else {
						resp.Content += "\n" + v.Value
					}
				case *brtypes.ContentBlockMemberToolUse:
					// ToolUseBlock.Input is a document.Interface; the
					// SDK doesn't give us a typed Go value. Round-trip
					// through JSON to get a plain map[string]any.
					args := docToMap(v.Value.Input)
					resp.ToolCalls = append(resp.ToolCalls, ToolCall{
						ID:        aws.ToString(v.Value.ToolUseId),
						Name:      aws.ToString(v.Value.Name),
						Arguments: args,
					})
				}
			}
		}
	}

	_ = out.StopReason // not used by the agent loop; it inspects ToolCalls
	return resp, nil
}

// buildConverseMessages turns our flat Message slice into the
// Converse API's role-tagged content blocks.
func buildConverseMessages(in []Message) []brtypes.Message {
	out := make([]brtypes.Message, 0, len(in))
	for _, m := range in {
		switch m.Role {
		case RoleUser:
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleUser,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberText{Value: m.Content},
				},
			})
		case RoleAssistant:
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleAssistant,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberText{Value: m.Content},
				},
			})
		case RoleTool:
			out = append(out, brtypes.Message{
				Role: brtypes.ConversationRoleUser,
				Content: []brtypes.ContentBlock{
					&brtypes.ContentBlockMemberToolResult{
						Value: brtypes.ToolResultBlock{
							ToolUseId: aws.String(m.ToolID),
							Content: []brtypes.ToolResultContentBlock{
								&brtypes.ToolResultContentBlockMemberText{
									Value: m.Content,
								},
							},
						},
					},
				},
			})
		}
	}
	return out
}

// buildToolConfig converts our flat Tool schema list into a list
// of Converse ToolSpecifications. Converse takes a list of union
// members, so we wrap each spec in its own ToolMemberToolSpec.
func buildToolConfig(in []Tool) *brtypes.ToolConfiguration {
	members := make([]brtypes.Tool, 0, len(in))
	for _, t := range in {
		var inputSchema brdoc.Interface = brdoc.NewLazyDocument(map[string]any{"type": "object"})
		if t.Parameters != nil {
			inputSchema = brdoc.NewLazyDocument(t.Parameters)
		}
		members = append(members, &brtypes.ToolMemberToolSpec{
			Value: brtypes.ToolSpecification{
				Name:        aws.String(t.Name),
				Description: aws.String(t.Description),
				InputSchema: &brtypes.ToolInputSchemaMemberJson{
					Value: inputSchema,
				},
			},
		})
	}
	return &brtypes.ToolConfiguration{
		Tools: members,
	}
}

// AsJSONBytes is a small helper for callers that want to print a
// Converse request/response for debugging.
func AsJSONBytes(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}

// docToMap converts a smithy document.Interface (the type AWS uses
// for opaque JSON-ish blobs) to a plain map[string]any. The
// document type has a MarshalSmithyDocument method, but the simplest
// reliable path is JSON round-trip — the SDK's document types
// already implement json.Marshaler.
func docToMap(d brdoc.Interface) map[string]any {
	if d == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(d)
	if err != nil {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{}
	}
	return out
}
