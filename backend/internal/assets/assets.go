// Package assets embeds static content used when generating client-facing
// documents — currently just the LDM.tv logo used on the buyout PDF
// (Addendum v3 §5). Mirrors the equivalent internal/assets package in the
// sibling Equiptra repo (same pattern, same company, a different specific
// document) — and reuses that repo's own logo file directly, rather than
// the one embedded in LDM's real buyout xlsx template
// (docs/TEMPLATE Freelance buyout UPDATED 29.12.25.xlsx, xl/media/image1.png):
// live-testing found that embedded copy was itself non-uniformly resized
// at some point before being put in the spreadsheet (stretched vertically),
// so faithfully preserving its aspect ratio still rendered a distorted
// logo. Equiptra's copy is confirmed correctly-proportioned (it's already
// shipping in that product's own delivery note/carnet PDFs).
package assets

import _ "embed"

//go:embed ldm_logo.png
var LDMLogoPNG []byte
