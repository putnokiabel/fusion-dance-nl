# CLAUDE.md

Quick context for AI assistants (and humans). For deployment / setup, see [README.md](README.md).

## What this is

Static site for **Stichting Fusion Dance Utrecht** (`fusiondance.nl`). Built with Astro 5 + Tailwind v4. Hosted on Firebase Hosting. A single Firebase Cloud Function (`tallyWebhook`, europe-west1, Gen 2) acts as a webhook proxy from a public Tally form to a GitHub Action that opens a PR with a new event YAML.

GitHub repo: `putnokiabel/fusion-dance-nl` (this is the canonical `GITHUB_OWNER`/`GITHUB_REPO` referenced in function secrets).

## Stack & commands

- Node 20+, npm (not pnpm despite the package.json defaults — pnpm wasn't installed locally and we never migrated).
- `npm run dev` → http://localhost:4321
- `npm run build` → `dist/`
- `npm run preview` → serves the built `dist/`
- `firebase deploy --only hosting` — manual hosting deploy (CI deploy via Actions exists in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) but only fires once `FIREBASE_SERVICE_ACCOUNT` is added as a repo secret)
- `cd functions && npm install && npm run build && cd .. && firebase deploy --only functions` — function deploy

## Repository layout (the non-obvious bits)

- [src/content/events/](src/content/events/) — one YAML file per event, named `YYYY-MM-DD-slug.yaml`. Loaded by Astro Content Collections with the Zod schema in [src/content/config.ts](src/content/config.ts).
- [src/pages/events/[slug].astro](src/pages/events/[slug].astro) — generates one detail page per event via `getStaticPaths`. Slug = filename without `.yaml`.
- [src/lib/events.ts](src/lib/events.ts) — `getUpcomingEvents` / `getPastEvents` partition by `end ?? start`; `formatEventDate` / `formatEventTime` use `Intl.DateTimeFormat` with `Europe/Amsterdam`.
- [src/components/Hero.astro](src/components/Hero.astro) — supports `illustration` + `imageTheme: 'light' | 'dark'`. With an image, the section becomes a full-bleed cover background (no inline image). Overlay strength differs per theme (light photos get a much heavier dark gradient so the cream text stays readable).
- [public/images/](public/images/) — hero photos + per-event submitted images under `events/<slug>/`.
- [public/illustrations/](public/illustrations/) — legacy SVG placeholders (dancers / circle-of-friends / photo-placeholder). Currently unreferenced; keep until brand assets are final.
- [functions/src/index.ts](functions/src/index.ts) — the Tally webhook proxy.

## Content model

Events have a deliberate two-field split:

- `summary` — short blurb (≤400 chars). Shown on event cards (home + events page) and as the meta description.
- `description` — full long-form text. Shown only on the per-event detail page. URLs are auto-linked client-rendered; line breaks preserved via `whitespace-pre-line`-ish rendering in [src/pages/events/[slug].astro](src/pages/events/[slug].astro).

If only `summary` is set, the detail page falls back to showing it as the body.

`start` / `end` are ISO datetimes with explicit Europe/Amsterdam offset (`+01:00` or `+02:00` depending on DST). The Tally → Function path combines separate `Start date` + `Start time` fields and computes the right offset (last Sunday of March 01:00 UTC → last Sunday of October 01:00 UTC). DO NOT use `Z`/UTC in event YAMLs — keep the local offset so the file is human-readable.

## Theme

Dark theme by default (the entire site). Tokens in [src/styles/global.css](src/styles/global.css):

- `--color-bg: #3a1635` (page bg — deep plum)
- `--color-surface: #4e2148` (lifted panel / card bg; **never `bg-white`**)
- `--color-ink: #faf3ec` (primary text)
- `--color-muted: #c9b6c1`
- `--color-accent: #ee9a76` (warm orange — links, wordmark, eyebrows, h3 accents)
- `--color-btn-bg: #ee9a76`, `--color-btn-text: #2a1027` — primary CTA buttons (orange bg, near-black text)
- `--color-line` (border): semi-transparent cream

Buttons that sit on `--color-btn-bg` use `!text-[var(--color-btn-text)]` with `!important` as a guardrail against any future unlayered `a {}` reset.

Base styles MUST be wrapped in `@layer base { ... }` — putting reset rules outside a layer makes them beat Tailwind utilities in the cascade. We hit this exact bug before; do not undo.

## Image policy

- **All raster images are `.webp`**, q78, max 1800px wide, generated with `sharp` (`.rotate().resize().webp({ quality: 78, effort: 5 })`).
- **Git LFS tracks `*.webp` and `*.svg`** via [.gitattributes](.gitattributes). Both workflows check out with `lfs: true` and the deploy workflow caches LFS objects across runs.
- Hero photos live under [public/images/hero-*.webp](public/images/). Event-card photos for monthly UFuse socials all share [public/images/ufuse-monthly.webp](public/images/ufuse-monthly.webp) (a composite of a Playground photo with the UFuse logo recolored to white).
- For event-submission images: the GitHub Action ([.github/scripts/create-event-pr.mjs](.github/scripts/create-event-pr.mjs)) downloads Tally's signed URLs, resizes, writes `.webp` under `public/images/events/<slug>/N.webp`, and commits them through LFS.

## Tally → Function → PR pipeline

End-to-end shape:

```
Tally form (form ID: 0QDdeZ)
  └─ webhook (HMAC-SHA256) ──▶ Cloud Function `tallyWebhook` (europe-west1, Gen 2)
                                  └─ POSTs repository_dispatch (event_type: new-event)
                                        └─ Workflow `.github/workflows/new-event.yml`
                                              └─ Runs `.github/scripts/create-event-pr.mjs`
                                              └─ Opens PR via peter-evans/create-pull-request
```

Function field labels (matched by case-insensitive label prefix):
- Required: `Submitter email`, `Title`, `Start date`, `Start time`, `Venue name`, `Address`
- Optional: `End date`, `End time` (must come together or not at all), `Maps URL`, `Summary`, `Description`, `Link`, `Images`

Function is configured with `invoker: 'public'` so Cloud Run does not require an Authorization header. Don't remove this — Tally can't send GCP auth.

## Deployment gotchas (learned the hard way)

1. **Firebase Hosting rewrite to a Gen 2 function MUST use the explicit object form** in [firebase.json](firebase.json):
   ```json
   { "source": "/api/submit-event", "function": { "functionId": "tallyWebhook", "region": "europe-west1" } }
   ```
   The shorthand `"function": "tallyWebhook"` defaults to Gen 1 in `us-central1` and produces a confusing 404.
2. **Cloud Run public invocation**: even though the function code sets `invoker: 'public'`, fresh deploys should be sanity-checked. The IAM binding is `roles/run.invoker` for `allUsers` on the `tallywebhook` Cloud Run service.
3. **GitHub Actions creating PRs**: Repo Settings → Actions → General → Workflow permissions → "Allow GitHub Actions to create and approve pull requests" MUST be on. The workflow's `permissions:` block alone is insufficient.
4. **Compute Engine default SA roles**: First-time Gen 2 function deploys fail unless the `<project-number>-compute@developer.gserviceaccount.com` SA has `roles/cloudbuild.builds.builder`, `roles/secretmanager.secretAccessor`, and `roles/logging.logWriter`.
5. **Blaze plan required** for the Cloud Function (outbound HTTPS to api.github.com). The free tier of Blaze still covers expected volume.

## Function secrets (stored in Google Secret Manager)

- `TALLY_SIGNING_SECRET` — Tally webhook HMAC secret
- `GITHUB_PAT` — fine-grained PAT, repo-scoped, `contents:write` + `pull-requests:write`
- `GITHUB_OWNER` = `putnokiabel`
- `GITHUB_REPO` = `fusion-dance-nl`

GitHub repo secret: `FIREBASE_SERVICE_ACCOUNT` (for the deploy workflow). GitHub repo variable: `PUBLIC_TALLY_FORM_ID` = `0QDdeZ` (used at build time to embed the Tally form on `/submit-event`).

## Conventions / preferences

- Don't add a `bg-white` anywhere — site is dark; use `bg-[var(--color-surface)]`.
- Don't introduce a light/dark theme toggle unless explicitly asked — site is intentionally dark-only for now.
- Don't gratuitously add accent colours; warm orange (`--color-accent`) is the single accent. Plum is bg; cream is text.
- Don't render Astro pages as full-page React/Vue islands. Astro ships zero JS by default and the only inline `<script>` is the mobile-nav toggle in [Header.astro](src/components/Header.astro). Keep it that way.
- Don't create per-event detail content beyond what the YAML carries. If new fields are needed, extend the Zod schema in [src/content/config.ts](src/content/config.ts), the Tally form labels, the function's `EventSubmission` interface in [functions/src/index.ts](functions/src/index.ts), and the writer in [.github/scripts/create-event-pr.mjs](.github/scripts/create-event-pr.mjs).
- Footer brand line says **"Stichting Fusion Dance Utrecht"** with **KvK 98315749**. Header wordmark still says "Fusion Dance NL" by design (shorter).

## Live URLs

- Site: `https://fusion-dance-nl.web.app/` (custom domain `fusiondance.nl` to be added — see README step 7)
- Webhook endpoint: `https://fusion-dance-nl.web.app/api/submit-event` (rewrite → `tallyWebhook` Cloud Function)
- Public submission form: `https://tally.so/r/0QDdeZ` (also embedded at `/submit-event`)
