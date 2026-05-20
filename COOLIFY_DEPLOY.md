# Coolify Deployment Guide

This app moved off Fly.io. SQLite was replaced with PostgreSQL; the
`/data` volume now only stores uploaded invoice PDFs and the cached
Google API settings file.

The data-migration scripts run **from your local machine** against the
remote Coolify Postgres — `prisma/dev.sqlite` is excluded from the
Docker image (and should stay excluded), and `tsx` isn't shipped to
production because it's a devDependency.

---

## What's already done in this repo (branch `coolify-postgres`)

- `prisma/schema.prisma` → `provider = "postgresql"`
- `prisma/migrations/20260520000000_init/` → fresh Postgres-flavoured
  init migration (one file, 185 lines)
- `app/utils/supplierMapping.server.ts` → `contains` got
  `mode: 'insensitive'` so brand lookup still works case-insensitively
  on Postgres
- `dbsetup.js` → SQLite symlink logic removed; only creates `/data/pdfs`
  and runs `prisma migrate deploy`
- `scripts/migrate-sqlite-to-postgres.ts` → copies Supplier/Product/
  SupplierSKU from local SQLite into Postgres
- `scripts/refresh-from-sheets.ts` → seeds Product/SupplierSKU/CMP
  from the Google Sheet

Python venv is **already handled inside the Dockerfile** — it creates
`/app/python/venv`, installs `python/requirements.txt` into it, and
puts the venv first in `PATH` so the Node process picks the right
`python3` when parsing PDFs. You don't need to touch this on Coolify.

---

## Step 1 — Create the Postgres service

Coolify UI → **+ New Resource → Database → PostgreSQL**.

- Name: `fwn-postgres`
- Version: **16**
- Username: `fwn`
- Password: let Coolify generate one (or set your own)
- Database name: `fwn`

After creation Coolify shows two connection strings on the DB page:

- **Internal** (e.g. `postgres://fwn:…@fwn-postgres:5432/fwn`) — used by
  the app container, this is what goes into `DATABASE_URL` on the app
- **External** — disabled by default. We'll enable it temporarily in
  Step 6 to load data from a local machine.

Copy the **internal** URL now, you'll need it for Step 4.

## Step 2 — Create the application

**+ New Resource → Application → Public Repository** (or Private with a
deploy key).

- Repository: this repo
- Branch: `coolify-postgres`
- Build pack: **Dockerfile** (auto-detected at repo root)
- Port (internal): `3000`
- Healthcheck path: `/healthcheck` (the route already exists at
  `app/routes/healthcheck.tsx`)
- Build command / start command: leave defaults — the Dockerfile's
  `CMD ["node", "./dbsetup.js", "npm", "run", "start"]` handles both

## Step 3 — Add the persistent volume

In the application's **Storage** tab → **+ Add**:

| Name       | Mount path in container |
| ---------- | ----------------------- |
| `fwn-data` | `/data`                 |

Source path: leave default (Coolify creates and tracks it).

`dbsetup.js` creates `/data/pdfs` on first boot. The uploaded PDFs and
`/data/google-api-settings.json` (created by the in-app Google API
config UI) live here.

## Step 4 — Environment variables

In the application's **Environment Variables** tab paste this block,
filling in the marked values:

```env
NODE_ENV=production
PORT=3000

# From Step 1 — the *internal* connection string
DATABASE_URL=postgres://fwn:CHANGEME@fwn-postgres:5432/fwn

# From Shopify Partners → your app → API credentials
SHOPIFY_API_KEY=e1635834a813b89b95822784db1ca869
SHOPIFY_API_SECRET=CHANGEME
SCOPES=write_products

# Your future domain (see Step 5)
SHOPIFY_APP_URL=https://APP_DOMAIN
```

Optional — only if you use them:

```env
# A Shopify store with a custom domain (rare; needed when the store
# isn't on *.myshopify.com)
SHOP_CUSTOM_DOMAIN=

# Email notifications about PDF parsing results via Resend
RESEND_API_KEY=
NOTIFY_TO=
NOTIFY_FROM=
```

**Not** needed in env (handled in-app via the `/app/google-api` UI,
saved into `/data/google-api-settings.json`):

- `GOOGLE_OAUTH_CONFIG`
- `GOOGLE_OAUTH_REDIRECT_URI`

## Step 5 — Domain

In **Domains** tab add your custom domain (e.g.
`fwn.expertshopify.fr`). Coolify provisions a Let's Encrypt cert
automatically.

Then in Shopify Partners → your app:

- **App URL** → `https://APP_DOMAIN`
- **Allowed redirection URLs** add:
  - `https://APP_DOMAIN/auth/callback`
  - `https://APP_DOMAIN/auth/shopify/callback`
  - `https://APP_DOMAIN/api/auth/callback`

Update `SHOPIFY_APP_URL` env var (Step 4) to the same domain if you
hadn't already.

## Step 6 — First deploy

Hit **Deploy**. Expect 5–10 minutes for the first build (apt installs
Python, Java, Ghostscript, Cairo headers; pip installs camelot +
pdfplumber + tabula-py + opencv-headless + numpy + pandas + pymupdf;
npm ci; prisma generate; remix vite build).

When the container boots, `dbsetup.js` runs `prisma migrate deploy`
against the empty Postgres. This applies
`prisma/migrations/20260520000000_init/migration.sql` and creates all
tables. Tables exist but are empty — that's expected.

Visit `https://APP_DOMAIN/healthcheck` — should return `OK` (status
200). If it does, the app is up.

---

## Step 7 — Load data (from your local machine)

The migration scripts run locally because they need `tsx` (not in the
production image) and the local `prisma/dev.sqlite` snapshot.

### 7a. Temporarily expose the Postgres service

In Coolify → `fwn-postgres` → **Network / Public Access** → enable.
Coolify will give you an external URL with a random high port, e.g.:

```
postgres://fwn:PASSWORD@coolify.your-server.com:54321/fwn
```

This is the URL you'll use **locally**. Don't put it in the app's env
— the app uses the internal URL from Step 4.

### 7b. Run the scripts locally

From this repo on your laptop:

```sh
# Make sure node modules are installed locally
npm ci

# Generate Prisma client for Postgres (one time)
DATABASE_URL="postgres://fwn:PASSWORD@coolify.your-server.com:54321/fwn" \
  npx prisma generate

# 1) Carry over Supplier + Product + SupplierSKU from the local SQLite
DATABASE_URL="postgres://fwn:PASSWORD@coolify.your-server.com:54321/fwn" \
  npx tsx scripts/migrate-sqlite-to-postgres.ts
```

Expected output:

```
📦 Source rows: 26 suppliers, 6 products, 6 SKUs
✅ Migration complete
   Supplier:    inserted 26, skipped 0
   Product:     inserted 6, skipped 0
   SupplierSKU: inserted 6, skipped 0
```

```sh
# 2) Pull current state from Google Sheets — dry run first
DATABASE_URL="postgres://fwn:PASSWORD@coolify.your-server.com:54321/fwn" \
GOOGLE_SHEETS_SPREADSHEET_ID="<your sheet id>" \
GOOGLE_SHEETS_API_KEY="<your API key>" \
  npx tsx scripts/refresh-from-sheets.ts
```

The dry run prints the first 3 parsed rows so you can verify the
column mapping (especially `name` from column C and `brand` from
column F). If they look right, re-run with `--apply`:

```sh
DATABASE_URL="postgres://fwn:PASSWORD@coolify.your-server.com:54321/fwn" \
GOOGLE_SHEETS_SPREADSHEET_ID="<your sheet id>" \
GOOGLE_SHEETS_API_KEY="<your API key>" \
  npx tsx scripts/refresh-from-sheets.ts --apply
```

### 7c. Close the public port

In Coolify → `fwn-postgres` → **Network / Public Access** → disable.
The app keeps working because it uses the internal hostname.

---

## Step 8 — Configure Google integration in the app

Open `https://APP_DOMAIN/app/google-api` and:

- Paste the same `Spreadsheet ID` used in Step 7b
- Paste either the API key, the Service Account JSON, or run the
  OAuth2 flow — same fields you used to use on Fly

This writes to `/data/google-api-settings.json` (inside the persistent
volume), so it survives redeploys.

## Step 9 — Reinstall the Shopify app in your store

The old Shopify `Session` was bound to the Fly URL and was intentionally
not migrated. Open your store admin and reinstall the app via Shopify
Partners → **Test on development store**. A new `Session` row will be
created in Postgres.

---

## Sanity checklist

After Step 9:

- [ ] `https://APP_DOMAIN/healthcheck` → 200 OK
- [ ] In Coolify Postgres terminal:
  `SELECT count(*) FROM "Product";` returns a non-zero number
- [ ] In Coolify Postgres terminal:
  `SELECT count(*) FROM "CMPRecord";` returns a non-zero number (CMP
  was seeded from Sheets)
- [ ] Shopify admin shows the app installed and embedded UI loads
- [ ] Upload a test PDF, parsing completes without
  `ModuleNotFoundError`  (proves the Python venv is active in the
  container)
- [ ] The new PDF survives a container restart (proves `/data` volume
  is mounted)

---

## Troubleshooting

**`prisma migrate deploy` fails on first boot**
The internal DB URL is wrong or the Postgres service isn't up yet.
Recheck `DATABASE_URL` in app env, redeploy. Coolify usually starts
the DB before the app, but on a brand-new project the order can race.

**`ModuleNotFoundError: No module named 'camelot'` when parsing a PDF**
The Python venv didn't end up first in `PATH`. The Dockerfile sets
`ENV PATH="/app/python/venv/bin:$PATH"`, so this should be impossible
in a fresh image — if you see it, something built without the
Dockerfile (wrong build pack?). Verify the build is using Dockerfile,
not Nixpacks.

**PDFs vanish after redeploy**
The `/data` volume isn't mounted. Re-check Storage tab in Coolify.

**Local `npx tsx scripts/...` can't reach Postgres**
Public access on the Postgres service is off. Re-enable in Step 7a,
re-run, disable when done.

**Refresh from Sheets imports the wrong column as product name**
Open `scripts/refresh-from-sheets.ts` and adjust the `productName` /
`supplierName` indexes (lines marked with `// C` and `// F`). The
dry-run output tells you which column is which.

**Shopify session loops on login**
`SHOPIFY_APP_URL` in env doesn't match the URL the user is on, or the
Shopify Partners app entry still points at the Fly URL. Both must say
`https://APP_DOMAIN` exactly.

---

## Future: removing `prisma/dev.sqlite` from the repo

Once Coolify is live and verified, `prisma/dev.sqlite` can be deleted
from the repo (it's the only reason `migrate-sqlite-to-postgres.ts`
exists). The script can be deleted too. Keep them around for now —
they're cheap and you might want to re-run the migration on a fresh
test environment.
