package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type User struct {
	ID           string     `json:"id"`
	FullName     string     `json:"full_name"`
	Email        string     `json:"email"`
	Role         string     `json:"role"`
	PasswordHash *string    `json:"-"`
	AvatarURL    *string    `json:"avatar_url"`
	LastLoginAt  *time.Time `json:"last_login_at,omitempty"`
}

type AuthUserView struct {
	ID        string  `json:"id"`
	FullName  string  `json:"full_name"`
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	AvatarURL *string `json:"avatar_url"`
}

type AccessClaims struct {
	Role  string `json:"role"`
	Email string `json:"email"`
	jwt.RegisteredClaims
}

func (u User) View() AuthUserView {
	return AuthUserView{
		ID:        u.ID,
		FullName:  u.FullName,
		Email:     u.Email,
		Role:      u.Role,
		AvatarURL: u.AvatarURL,
	}
}

func jwtSecret() string {
	return envOr("JWT_SECRET", "replace_with_a_long_random_secret")
}

func accessTTL() time.Duration {
	value := strings.TrimSpace(envOr("JWT_ACCESS_TTL", "15m"))
	if d, err := time.ParseDuration(value); err == nil {
		return d
	}
	if n, err := time.ParseDuration(value + "s"); err == nil {
		return n
	}
	return 15 * time.Minute
}

func refreshTTLDays() int {
	var days int
	_, err := fmt.Sscanf(envOr("JWT_REFRESH_TTL_DAYS", "14"), "%d", &days)
	if err != nil || days <= 0 {
		return 14
	}
	return days
}

func createAccessToken(user User) (string, error) {
	claims := AccessClaims{
		Role:  user.Role,
		Email: user.Email,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   user.ID,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(accessTTL())),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(jwtSecret()))
}

func parseAccessToken(token string) (*AccessClaims, error) {
	parsed, err := jwt.ParseWithClaims(token, &AccessClaims{}, func(token *jwt.Token) (any, error) {
		return []byte(jwtSecret()), nil
	})
	if err != nil {
		return nil, err
	}
	claims, ok := parsed.Claims.(*AccessClaims)
	if !ok || !parsed.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func hashRefreshToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func randomRefreshToken() (string, error) {
	buf := make([]byte, 48)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.SplitN(header, " ", 2)
	if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

func requestIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}

func allowMockAuth() bool {
	if strings.EqualFold(envOr("NODE_ENV", "development"), "production") {
		return false
	}
	return strings.EqualFold(envOr("ALLOW_MOCK_AUTH", "false"), "true")
}

func roleAlias(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	replacer := strings.NewReplacer("-", "_", " ", "_", "/", "_")
	normalized = replacer.Replace(normalized)
	switch normalized {
	case "BUSINESS_ANALYST", "BA":
		return "BA"
	case "PMPO", "PM_PO", "PRODUCT_OWNER", "PROJECT_MANAGER":
		return "PM_PO"
	case "BAMANAGER", "BA_MANAGER":
		return "BA_MANAGER"
	default:
		return normalized
	}
}

func (app *App) currentUser(r *http.Request) (*User, error) {
	ctx := r.Context()
	if token := bearerToken(r); token != "" {
		claims, err := parseAccessToken(token)
		if err != nil {
			return nil, err
		}
		user, err := app.findUserByID(ctx, claims.Subject)
		if err != nil {
			return nil, err
		}
		return user, nil
	}
	// SSE / EventSource fallback: allow the bearer token in the query
	// string because the browser EventSource API can't set custom
	// headers. This is safe because the connection is short-lived
	// and the token still has the same TTL as a header-borne one.
	if token := r.URL.Query().Get("token"); token != "" {
		claims, err := parseAccessToken(token)
		if err != nil {
			return nil, err
		}
		return app.findUserByID(ctx, claims.Subject)
	}
	if !allowMockAuth() {
		return nil, errors.New("authentication required")
	}
	if userID := strings.TrimSpace(r.Header.Get("X-User-Id")); userID != "" {
		return app.findUserByID(ctx, userID)
	}
	role := roleAlias(r.Header.Get("X-Mock-Role"))
	if role == "" {
		role = "BA_MANAGER"
	}
	return app.findFirstUserByRole(ctx, role)
}

func (app *App) findUserByID(ctx context.Context, id string) (*User, error) {
	const q = `select id, full_name, email, role, password_hash, avatar_url, last_login_at from users where id = $1`
	var u User
	var avatar sql.NullString
	var pass sql.NullString
	var last sql.NullTime
	err := app.DB.Pool.QueryRow(ctx, q, id).Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &pass, &avatar, &last)
	if err != nil {
		return nil, err
	}
	if pass.Valid {
		u.PasswordHash = &pass.String
	}
	if avatar.Valid {
		u.AvatarURL = &avatar.String
	}
	if last.Valid {
		t := last.Time
		u.LastLoginAt = &t
	}
	return &u, nil
}

func (app *App) findUserByEmail(ctx context.Context, email string) (*User, error) {
	const q = `select id, full_name, email, role, password_hash, avatar_url, last_login_at from users where lower(email) = lower($1)`
	var u User
	var avatar sql.NullString
	var pass sql.NullString
	var last sql.NullTime
	err := app.DB.Pool.QueryRow(ctx, q, email).Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &pass, &avatar, &last)
	if err != nil {
		return nil, err
	}
	if pass.Valid {
		u.PasswordHash = &pass.String
	}
	if avatar.Valid {
		u.AvatarURL = &avatar.String
	}
	if last.Valid {
		t := last.Time
		u.LastLoginAt = &t
	}
	return &u, nil
}

func (app *App) findFirstUserByRole(ctx context.Context, role string) (*User, error) {
	const q = `select id, full_name, email, role, password_hash, avatar_url, last_login_at from users where role = $1 order by created_at asc limit 1`
	var u User
	var avatar sql.NullString
	var pass sql.NullString
	var last sql.NullTime
	err := app.DB.Pool.QueryRow(ctx, q, role).Scan(&u.ID, &u.FullName, &u.Email, &u.Role, &pass, &avatar, &last)
	if err != nil {
		return nil, err
	}
	if pass.Valid {
		u.PasswordHash = &pass.String
	}
	if avatar.Valid {
		u.AvatarURL = &avatar.String
	}
	if last.Valid {
		t := last.Time
		u.LastLoginAt = &t
	}
	return &u, nil
}
