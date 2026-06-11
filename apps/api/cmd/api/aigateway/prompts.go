package aigateway

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// PromptsDir is the on-disk location of versioned .md files. Override
// in tests via SetPromptsDir; the default is ./prompts relative to the
// running binary. Production deploys bake the prompts into the image.
var (
	promptsDirMu sync.RWMutex
	promptsDir   = "prompts"
)

// SetPromptsDir swaps the prompts location. Test-only.
func SetPromptsDir(p string) {
	promptsDirMu.Lock()
	defer promptsDirMu.Unlock()
	promptsDir = p
}

// LoadPrompt reads a versioned prompt file by name (no extension).
// Returns ("", false) if the file does not exist. Callers fall back to
// an inline default in that case rather than error out — the gateway
// should never take a service down because a prompt file is missing.
func LoadPrompt(name string) (string, bool) {
	promptsDirMu.RLock()
	dir := promptsDir
	promptsDirMu.RUnlock()

	path := filepath.Join(dir, name+".md")
	clean := filepath.Clean(path)
	// Path-traversal guard: never escape the prompts dir.
	if !strings.HasPrefix(clean, filepath.Clean(dir)) {
		return "", false
	}
	b, err := os.ReadFile(clean)
	if err != nil {
		return "", false
	}
	return string(b), true
}
