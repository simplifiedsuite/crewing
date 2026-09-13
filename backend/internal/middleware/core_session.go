package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"time"
)

// CoreSessionCookieName is Core's shared cookie — see Core's own
// internal/middleware/auth.go (SessionCookieName). Ralto never issues or
// verifies this cookie itself; it only reads the value off an incoming
// request and hands it to Core's Whoami endpoint. Duplicated as a literal
// (not imported) because Core and Ralto are separate Go modules/repos.
const CoreSessionCookieName = "suite_session"

type CoreProductAccess struct {
	Product string `json:"product"`
	Role    string `json:"role"`
}

// CorePerson is the subset of Core's /api/whoami response Ralto's bridge
// needs — see simplified_suite_screens_v0_3.md §5 step 3.
type CorePerson struct {
	ID             string              `json:"id"`
	OrganisationID string              `json:"organisation_id"`
	Name           string              `json:"name"`
	Email          string              `json:"email"`
	ProductAccess  []CoreProductAccess `json:"product_access"`
}

var coreHTTPClient = &http.Client{Timeout: 5 * time.Second}

// CoreAPIURL is exported so other server-to-server callers into Core (the
// Monday.com project-lookup proxy, the Client/Contract read proxies used by
// Job creation's "Fetch from Monday" flow) share the same CORE_API_URL
// config this file already reads for the SSO bridge.
func CoreAPIURL() string {
	return os.Getenv("CORE_API_URL")
}

func coreAPIURL() string {
	return CoreAPIURL()
}

// FetchCorePerson calls Core's POST /api/whoami with the raw suite_session
// token value read off the incoming request's cookie. A (nil, nil) return
// means "Core says this token doesn't resolve to anyone" (expired, bad
// signature, deleted Person) — not a server error, just "the bridge can't
// help here," so the caller should fall through to the classic staff-cookie
// check and let it 401 as it always has. A non-nil error means Core
// couldn't be reached or returned something unparseable.
func FetchCorePerson(ctx context.Context, token string) (*CorePerson, error) {
	base := coreAPIURL()
	if base == "" || token == "" {
		return nil, nil
	}
	body, err := json.Marshal(map[string]string{"token": token})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/whoami", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := coreHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, nil
	}
	var person CorePerson
	if err := json.NewDecoder(resp.Body).Decode(&person); err != nil {
		return nil, err
	}
	return &person, nil
}
