# fusiondance.nl

Static informational site for the Dutch fusion-dance community. Built with [Astro](https://astro.build/) + Tailwind, hosted on Firebase Hosting. Events are authored as YAML files committed to this repo and baked into static HTML at build time.

Non-technical contributors submit events via a public [Tally](https://tally.so/) form. A Firebase Cloud Function relays the signed webhook to a GitHub Action, which opens a PR with the new event YAML and any resized images. A maintainer reviews and merges; the merge triggers a redeploy.

## Local development

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # outputs to dist/
npm run preview      # serve the built site locally
```

Node 20+ is required.

## Adding an event manually

Drop a new file under [src/content/events/](src/content/events/) named `YYYY-MM-DD-slug.yaml`:

```yaml
title: Fusion Summer Social
start: 2026-06-14T20:00:00+02:00      # ISO 8601 with Europe/Amsterdam offset
end: 2026-06-15T01:00:00+02:00        # optional
location:
  name: Centrum EMMA
  address: Cremerstraat 245/247, 3532 BJ Utrecht
  mapsUrl: https://www.google.com/maps/...     # optional
description: |                                  # optional, plain text
  Multi-line description goes here.
link: https://example.com/tickets               # optional
image: /images/events/2026-06-14/1.jpg          # optional, path under public/
cancelled: false                                # optional, defaults to false
```

The schema lives in [src/content/config.ts](src/content/config.ts). Malformed events fail the build with a Zod error pointing at the offending field.

## Public event submissions (Tally → GitHub PR)

End-to-end flow:

```
Tally form → Firebase Function (signed webhook proxy) → GitHub repository_dispatch
           → new-event Action → PR opened with YAML + resized images → maintainer merges
```

### One-time setup

1. **Firebase project.** Create one in the [Firebase console](https://console.firebase.google.com/), upgrade to the **Blaze** plan (required for Functions to make outbound HTTP calls), and update [.firebaserc](.firebaserc) with the project ID.
2. **Service account for CI.** Create a service account with "Firebase Hosting Admin" + "Cloud Functions Developer" + "Service Account User" roles, download a JSON key, and store it as the GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT`.
3. **Tally form.** Build a form with these fields, matching labels (the function matches by label prefix):
   - Submitter email (email, required)
   - Title (short text, required)
   - Start (date+time, required)
   - End (date+time, optional)
   - Venue name (short text, required)
   - Address (short text, required)
   - Maps URL (URL, optional)
   - Description (long text, optional)
   - Link (URL, optional)
   - Images (file upload, multiple, optional, jpg/png)
   - Enable Tally's anti-spam (reCAPTCHA).
4. **Tally webhook.** In the form settings → Integrations → Webhooks, add:
   - URL: `https://fusiondance.nl/api/submit-event` (or the direct function URL before DNS is live)
   - Copy the signing secret.
5. **GitHub PAT.** Create a fine-grained personal access token scoped to this repo with `contents:write` + `pull-requests:write`.
6. **Function secrets.** From the project root:
   ```bash
   firebase functions:secrets:set TALLY_SIGNING_SECRET
   firebase functions:secrets:set GITHUB_PAT
   firebase functions:secrets:set GITHUB_OWNER       # e.g. "fusiondance-nl"
   firebase functions:secrets:set GITHUB_REPO        # e.g. "fusion-dance-nl"
   ```
7. **Public env var for the embed.** Set the GitHub Actions repository variable `PUBLIC_TALLY_FORM_ID` to the Tally form ID (the part after `tally.so/r/`). The build embeds the form on `/submit-event`. For local dev create a `.env` file with `PUBLIC_TALLY_FORM_ID=...`.
8. **Functions deploy.** From the project root:
   ```bash
   cd functions
   npm install
   npm run build
   firebase deploy --only functions
   ```

### Day-to-day

- A community member fills the Tally form.
- They (transparently) trigger the `tallyWebhook` function, which dispatches a `repository_dispatch` event to this repo.
- The [new-event workflow](.github/workflows/new-event.yml) runs, validates the payload against the same Zod schema as the build, downloads and resizes images with `sharp`, writes the YAML file, and opens a PR with the `new-event` label.
- A maintainer reviews and merges the PR.
- The [deploy workflow](.github/workflows/deploy.yml) rebuilds the site and pushes it to Firebase Hosting.

## Deployment

Pushes to `main` trigger [.github/workflows/deploy.yml](.github/workflows/deploy.yml):

- Build the Astro site (`npm run build`).
- Deploy the `dist/` directory to Firebase Hosting via [`FirebaseExtended/action-hosting-deploy`](https://github.com/FirebaseExtended/action-hosting-deploy).

Pull requests get a preview channel deploy that expires after 14 days.

## Project layout

```
.
├── astro.config.mjs              # Astro + Tailwind + sitemap config
├── firebase.json                 # Hosting + Functions config
├── functions/                    # Firebase Cloud Function (Tally webhook proxy)
│   └── src/index.ts
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml            # build + deploy on push to main
│   │   └── new-event.yml         # repository_dispatch -> open PR
│   └── scripts/create-event-pr.mjs
├── public/                       # static assets
├── src/
│   ├── components/               # Header, Footer, EventCard, Hero
│   ├── content/
│   │   ├── config.ts             # Zod schema for the `events` collection
│   │   └── events/               # one YAML file per event
│   ├── layouts/BaseLayout.astro
│   ├── lib/events.ts             # upcoming/past partitioning, date formatting
│   ├── pages/                    # index, events, about, house-rules, submit-event
│   └── styles/global.css         # Tailwind v4 entry + theme tokens
└── README.md
```

## Replacing placeholder branding

The favicon and header wordmark use a temporary plum "F" mark and the Manrope typeface. Replace [public/favicon.svg](public/favicon.svg) and adjust the colour tokens in [src/styles/global.css](src/styles/global.css) (`--color-plum`, `--color-dusk`, etc.) once final brand assets exist.
