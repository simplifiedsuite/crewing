// Package assets embeds static content used when generating client-facing
// documents — currently just the LDM.tv logo used on the buyout PDF
// (Addendum v3 §5), extracted directly from LDM's own real buyout template
// (docs/TEMPLATE Freelance buyout UPDATED 29.12.25.xlsx, xl/media/image1.png)
// rather than a logo sourced from elsewhere. Mirrors the equivalent
// internal/assets package in the sibling Equiptra repo (same pattern, same
// company, a different specific document).
package assets

import _ "embed"

//go:embed ldm_logo.png
var LDMLogoPNG []byte
