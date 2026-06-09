package main

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

func init() {
	loadEnvFiles()
}

func loadEnvFiles() {
	paths := []string{".env", "../.env", "../../.env"}
	for _, path := range paths {
		loadEnvFile(path)
	}
}

func loadEnvFile(path string) {
	file, err := os.Open(path)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"'`)
		if key == "" {
			continue
		}
		if current, exists := os.LookupEnv(key); exists && !shouldEnvFileOverride(key, current) {
			continue
		}
		_ = os.Setenv(key, value)
	}
}

func shouldEnvFileOverride(key, current string) bool {
	current = strings.TrimSpace(strings.Trim(current, `"'`))
	if current == "" {
		return true
	}
	switch key {
	case "JWT_SECRET":
		return current == "replace_with_a_long_random_secret"
	case "DATABASE_URL":
		return strings.Contains(current, ":***@") || strings.Contains(current, "change_me")
	default:
		return false
	}
}

func resolveLocalDatabaseURL() string {
	user := envOr("POSTGRES_USER", "ba_bazaar")
	password := envOr("POSTGRES_PASSWORD", "change_me")
	database := envOr("POSTGRES_DB", "ba_bazaar")
	host := envOr("PGHOST", "localhost")
	port := envOr("PGPORT", "5432")
	return fmt.Sprintf("postgresql://%s:%s@%s:%s/%s?schema=public&sslmode=disable", user, password, host, port, database)
}

func workingDirEnvHints() []string {
	cwd, err := os.Getwd()
	if err != nil {
		return nil
	}
	return []string{
		filepath.Join(cwd, ".env"),
		filepath.Join(cwd, "..", ".env"),
		filepath.Join(cwd, "..", "..", ".env"),
	}
}
