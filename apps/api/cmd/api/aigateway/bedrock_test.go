package aigateway

import (
	"context"
	"os"
	"strings"
	"testing"
)

func TestBedrockProvider_Configured(t *testing.T) {
	const key = "BEDROCK_BEARER_TOKEN"
	orig, hadOrig := os.LookupEnv(key)
	defer func() {
		if hadOrig {
			os.Setenv(key, orig)
		} else {
			os.Unsetenv(key)
		}
	}()

	cases := []struct {
		envValue string
		set      bool
		want     bool
	}{
		{"", false, false},
		{"  ", true, false},
		{"real-key-value", true, true},
	}
	for _, c := range cases {
		if c.set {
			os.Setenv(key, c.envValue)
		} else {
			os.Unsetenv(key)
		}
		b, err := NewBedrockProvider()
		if err != nil {
			t.Fatalf("NewBedrockProvider: %v", err)
		}
		if b.Configured() != c.want {
			t.Fatalf("env=%q set=%v: got Configured=%v, want %v",
				c.envValue, c.set, b.Configured(), c.want)
		}
		if b.Name() != "bedrock" {
			t.Fatalf("name: %s", b.Name())
		}
	}
}

func TestBedrockProvider_CompleteRequiresClient(t *testing.T) {
	b := &BedrockProvider{}
	_, err := b.Complete(context.Background(), Request{
		Messages: []Message{{Role: RoleUser, Content: "hi"}},
	})
	if err == nil {
		t.Fatal("expected error when client nil")
	}
	if !strings.Contains(err.Error(), "provider not initialised") {
		t.Fatalf("error should mention init: %v", err)
	}
}

func TestDocToMap(t *testing.T) {
	// nil doc → empty map
	if got := docToMap(nil); len(got) != 0 {
		t.Fatalf("nil doc: %v", got)
	}
	// Non-nil: round-trip via a fresh provider, which is hard to
	// inspect without a real call, but the empty-map path is the
	// one that matters for safety. The round-trip path is exercised
	// in the live integration test (gated behind live_bedrock tag).
}

