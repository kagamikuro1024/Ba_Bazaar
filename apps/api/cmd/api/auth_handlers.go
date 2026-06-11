package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func (app *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	// DEBUG: print what we got
	fmt.Printf("DEBUG login: email=%q password=%q\n", req.Email, req.Password)
	user, err := app.findUserByEmail(r.Context(), strings.ToLower(strings.TrimSpace(req.Email)))
	fmt.Printf("DEBUG findUserByEmail err=%v hasUser=%v\n", err, user != nil)
	if err != nil || user.PasswordHash == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Invalid email or password."})
		return
	}
	cmpErr := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(req.Password))
	fmt.Printf("DEBUG bcrypt err=%v\n", cmpErr)
	if cmpErr != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Invalid email or password."})
		return
	}
	_, _ = app.DB.Pool.Exec(r.Context(), `update users set last_login_at = now() where id = $1`, user.ID)
	fresh, err := app.findUserByID(r.Context(), user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "failed to load user"})
		return
	}
	resp, err := app.issueAuthResponse(r.Context(), fresh, r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (app *App) handleRefresh(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	if err := decodeJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	const q = `
		select rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
		       u.id, u.full_name, u.email, u.role, u.password_hash, u.avatar_url, u.last_login_at
		from refresh_tokens rt
		join users u on u.id = rt.user_id
		where rt.token_hash = $1`
	var recordID string
	var user User
	var avatar sql.NullString
	var pass sql.NullString
	var last sql.NullTime
	var expires time.Time
	var revoked sql.NullTime
	err := app.DB.Pool.QueryRow(r.Context(), q, hashRefreshToken(strings.TrimSpace(req.RefreshToken))).Scan(
		&recordID, new(string), &expires, &revoked,
		&user.ID, &user.FullName, &user.Email, &user.Role, &pass, &avatar, &last,
	)
	if err != nil || revoked.Valid || !expires.After(time.Now()) {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Refresh token is invalid or expired."})
		return
	}
	if pass.Valid {
		user.PasswordHash = &pass.String
	}
	if avatar.Valid {
		user.AvatarURL = &avatar.String
	}
	if last.Valid {
		t := last.Time
		user.LastLoginAt = &t
	}
	_, _ = app.DB.Pool.Exec(r.Context(), `update refresh_tokens set revoked_at = now() where id = $1`, recordID)
	resp, err := app.issueAuthResponse(r.Context(), &user, r)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (app *App) handleLogout(w http.ResponseWriter, r *http.Request) {
	var req refreshRequest
	_ = json.NewDecoder(r.Body).Decode(&req)
	if token := strings.TrimSpace(req.RefreshToken); token != "" {
		_, _ = app.DB.Pool.Exec(r.Context(), `update refresh_tokens set revoked_at = now() where token_hash = $1 and revoked_at is null`, hashRefreshToken(token))
	}
	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}

func (app *App) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user.View()})
}

func (app *App) issueAuthResponse(ctx context.Context, user *User, r *http.Request) (map[string]any, error) {
	if strings.TrimSpace(jwtSecret()) == "" || jwtSecret() == "replace_with_a_long_random_secret" {
		return nil, errors.New("JWT_SECRET must be configured")
	}
	accessToken, err := createAccessToken(*user)
	if err != nil {
		return nil, err
	}
	refreshToken, err := randomRefreshToken()
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(time.Duration(refreshTTLDays()) * 24 * time.Hour)
	_, err = app.DB.Pool.Exec(ctx, `
		insert into refresh_tokens (id, user_id, token_hash, expires_at, user_agent, ip_address, created_at)
		values (gen_random_uuid(), $1, $2, $3, $4, $5, now())`,
		user.ID,
		hashRefreshToken(refreshToken),
		expiresAt,
		nullIfEmpty(r.UserAgent()),
		nullIfEmpty(requestIP(r)),
	)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user":          user.View(),
	}, nil
}

func nullIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}
