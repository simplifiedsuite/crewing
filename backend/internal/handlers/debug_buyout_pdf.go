package handlers

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// TEMPORARY — verifies buildBuyoutView/renderBuyoutPDF produce correct
// field values (rate resolution priority, shift-gap day counting) against
// real live booking data, without needing to open an emailed PDF to check.
// Admin-only, read-only, no side effects. Remove once verified.
func (a *API) DebugGetBuyoutPDF(w http.ResponseWriter, r *http.Request) {
	bookingID := chi.URLParam(r, "id")
	view, err := a.buildBuyoutView(r.Context(), bookingID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to build buyout view: "+err.Error())
		return
	}
	pdfBytes := renderBuyoutPDF(view)
	if len(pdfBytes) == 0 {
		writeError(w, http.StatusInternalServerError, "pdf render produced no bytes")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("X-Debug-Rate", fmt.Sprintf("%.2f", view.Rate))
	w.Header().Set("X-Debug-Days", fmt.Sprintf("%d", view.Days))
	w.Header().Set("X-Debug-Total", fmt.Sprintf("%.2f", view.TotalValue))
	_, _ = w.Write(pdfBytes)
}
