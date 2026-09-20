package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"

	"ralto/internal/db"
	"ralto/internal/handlers"
	"ralto/internal/middleware"
	"ralto/internal/notify"
)

func main() {
	ctx := context.Background()

	pool, err := db.Connect(ctx)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer pool.Close()

	notifyClient := notify.NewClient()
	if notifyClient == nil {
		log.Printf("SENDGRID_API_KEY not set — email notifications are disabled")
	}

	api := &handlers.API{DB: pool, Notify: notifyClient}

	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(30 * time.Second))

	// Env-configurable comma-separated list rather than Equiptra's single
	// FRONTEND_ORIGIN string — scheduler and crew personas may end up on
	// separate subdomains later (app.ralto.io / crew.ralto.io), so CORS is
	// built to allow more than one origin from the start.
	frontendOrigins := splitOrigins(os.Getenv("FRONTEND_ORIGINS"))
	if len(frontendOrigins) == 0 {
		frontendOrigins = []string{"http://localhost:5173"}
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   frontendOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Content-Type"},
		AllowCredentials: true,
	}))

	// Stage 2 SSO handoff (additive — see BridgeCoreSession's own comment).
	// A no-op for every request unless CORE_API_URL is set and the request
	// carries a suite_session cookie with no ralto_staff_session yet.
	r.Use(api.BridgeCoreSession)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Basic brute-force protection on both login endpoints, reusing the
	// rate limiter copied from Equiptra (there it only guarded the public
	// fault-report form; login is the analogous unauthenticated write
	// surface here).
	r.With(middleware.RateLimit(20, time.Minute)).Post("/api/auth/login", api.Login)
	r.With(middleware.RateLimit(20, time.Minute)).Post("/api/crew/auth/login", api.CrewLogin)
	r.Post("/api/auth/logout", api.Logout)
	r.Post("/api/crew/auth/logout", api.CrewLogout)

	// Self-service password reset — public/unauthenticated, same tier as
	// login above, not under registerStaffRoutes'/registerCrewRoutes' auth
	// trees. forgot-password gets a tighter limit than login: each request
	// can trigger a real outbound email (and, unlike a wrong password, an
	// attacker choosing the recipient), so it's worth capping harder against
	// being used to mail-bomb someone else's inbox from this app.
	r.With(middleware.RateLimit(6, time.Minute)).Post("/api/crew/auth/forgot-password", api.RequestCrewPasswordReset)
	r.With(middleware.RateLimit(20, time.Minute)).Post("/api/crew/auth/reset-password", api.ConfirmCrewPasswordReset)
	r.With(middleware.RateLimit(6, time.Minute)).Post("/api/auth/forgot-password", api.RequestStaffPasswordReset)
	r.With(middleware.RateLimit(20, time.Minute)).Post("/api/auth/reset-password", api.ConfirmStaffPasswordReset)

	registerStaffRoutes(r, api)
	registerCrewRoutes(r, api)

	addr := os.Getenv("LISTEN_ADDR")
	if addr == "" {
		if port := os.Getenv("PORT"); port != "" {
			addr = ":" + port
		} else {
			addr = ":8080"
		}
	}
	srv := &http.Server{Addr: addr, Handler: r}

	// Graceful shutdown — without this, Render's SIGTERM on every
	// restart/redeploy just killed the process mid-flight, so the deferred
	// pool.Close() above never ran and pgxpool's open connections were
	// orphaned rather than released. The pooler then had to notice each
	// dead TCP connection on its own before reclaiming the session slot,
	// which was slow enough that repeated restarts steadily exhausted
	// Supabase's 15-connection session-mode pool. Catching the signal here
	// stops the server accepting new requests, lets in-flight ones finish,
	// then returns from ListenAndServe so the deferred pool.Close() above
	// actually runs and releases every connection immediately.
	shutdownDone := make(chan struct{})
	go func() {
		stop := make(chan os.Signal, 1)
		signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
		<-stop
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("server shutdown: %v", err)
		}
		close(shutdownDone)
	}()

	log.Printf("ralto api listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
	<-shutdownDone
}

func splitOrigins(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	origins := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}
