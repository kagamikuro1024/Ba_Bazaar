package main

import (
	"reflect"
	"testing"
)

func TestExtractDeepSeekJSONContent(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "plain object",
			input: `{"summary":"ok"}`,
			want:  `{"summary":"ok"}`,
		},
		{
			name:  "markdown fenced object",
			input: "```json\n{\"summary\":\"ok\"}\n```",
			want:  `{"summary":"ok"}`,
		},
		{
			name:  "object with surrounding text",
			input: "Here is the JSON:\n{\"summary\":\"ok\",\"text\":\"brace } inside string\"}\nDone.",
			want:  `{"summary":"ok","text":"brace } inside string"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := extractDeepSeekJSONContent(tc.input)
			if err != nil {
				t.Fatalf("extractDeepSeekJSONContent returned error: %v", err)
			}
			if got != tc.want {
				t.Fatalf("extractDeepSeekJSONContent() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestExtractDeepSeekJSONContentRejectsEmpty(t *testing.T) {
	if _, err := extractDeepSeekJSONContent(" "); err == nil {
		t.Fatal("extractDeepSeekJSONContent(empty) returned nil error")
	}
}

func TestValidateLLMSummaryRepairsAndDropsBulletCitations(t *testing.T) {
	spec := llmSummarySpec{
		Citations: []llmCitation{
			{ID: "C1", Label: "Team utilization", Value: "80% across 5 active BA"},
			{ID: "C2", Label: "Pending requests", Value: "3 pending, 1 urgent"},
		},
	}
	input := llmSummary{
		Summary: "  Check requests first.  ",
		Bullets: []llmSummaryBullet{
			{Text: "Team utilization is 80% across 5 active BA.", Citations: []string{"c1"}},
			{Text: "There are 3 pending requests.", Citations: nil},
			{Text: "Unsupported claim without evidence.", Citations: nil},
		},
	}

	got, err := validateLLMSummary(input, spec, 5)
	if err != nil {
		t.Fatalf("validateLLMSummary returned error: %v", err)
	}
	if got.Summary != "Check requests first." {
		t.Fatalf("Summary = %q, want trimmed value", got.Summary)
	}
	if len(got.Bullets) != 2 {
		t.Fatalf("len(Bullets) = %d, want 2", len(got.Bullets))
	}
	if !reflect.DeepEqual(got.Bullets[0].Citations, []string{"C1"}) {
		t.Fatalf("first citations = %#v, want C1", got.Bullets[0].Citations)
	}
	if !reflect.DeepEqual(got.Bullets[1].Citations, []string{"C2"}) {
		t.Fatalf("second citations = %#v, want inferred C2", got.Bullets[1].Citations)
	}
	if got.Provider != "deepseek" || !got.Grounded {
		t.Fatalf("provider/grounded = %q/%v, want deepseek/true", got.Provider, got.Grounded)
	}
}

func TestValidateLLMSummaryRequiresCitedBullets(t *testing.T) {
	spec := llmSummarySpec{
		Citations: []llmCitation{
			{ID: "C1", Label: "Team utilization", Value: "80% across 5 active BA"},
		},
	}
	input := llmSummary{
		Summary: "Unsupported.",
		Bullets: []llmSummaryBullet{
			{Text: "Unsupported claim without evidence.", Citations: nil},
		},
	}

	if _, err := validateLLMSummary(input, spec, 5); err == nil {
		t.Fatal("validateLLMSummary returned nil error for uncited bullets")
	}
}
