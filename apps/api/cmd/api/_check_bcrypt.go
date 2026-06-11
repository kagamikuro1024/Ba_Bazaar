// +build ignore

package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	fmt.Printf("dsn: %s\n", dsn)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	var email, hash string
	err = db.QueryRow("select email, password_hash from users where email='manager@ba-bazaar.local'").Scan(&email, &hash)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("email=%s hash=%s\n", email, hash[:30]+"...")
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte("Manager@123")); err != nil {
		fmt.Println("COMPARE FAIL:", err)
	} else {
		fmt.Println("COMPARE OK")
	}
}
