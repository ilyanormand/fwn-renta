# Coolify Deployment Guide

This app moved off Fly.io. SQLite was replaced with PostgreSQL; the
`/data` volume now only stores uploaded invoice PDFs and the cached
Google API settings file.

The catalog is loaded into Postgres in two stages:

1. **Suppliers, Products, SupplierSKU mappings** ship as a SQL seed
   file (`prisma/seeds/initial-catalog.sql`) checked into the repo.
   `dbsetup.js` applies it automatically on container boot. Idempotent.
2. **Current CMP / product names from Google Sheets** is loaded via a
   button in the in-app `/app/google-api` page after the first
   successful deploy.

No SSH tunnels, no temporary public Postgres ports — everything goes
through normal git push + redeploy.

---

## What's already done in this repo (branch `coolify-postgres`)

- `prisma/schema.prisma` → `provider = "postgresql"`
- `prisma/migrations/20260520000000_init/` → fresh Postgres-flavoured
  init migration (one file, 185 lines)
- `prisma/seeds/initial-catalog.sql` → 26 suppliers + 6 products +
  6 SKU mappings exported from the pre-existing SQLite snapshot
- `dbsetup.js` → applies the seed automatically after running
  `prisma migrate deploy`
- `app/utils/supplierMapping.server.ts` → `contains` got
  `mode: 'insensitive'` so brand lookup still works case-insensitively
  on Postgres
- `app/services/catalogImport.server.ts` → new service that imports
  catalog state from Google Sheets into the database
- `app/routes/app.google-api.tsx` → new “Import Catalog from Sheets”
  card with Dry Run / Import Now buttons

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
- Password: let Coolify generate one
- Database name: `fwn`

Copy the **internal connection string** from the Coolify DB page —
that's the value of `DATABASE_URL` in Step 4.

**Public access is not required at any point.** Keep it disabled.

## Step 2 — Create the application

**+ New Resource → Application → Public Repository** (or Private with a
deploy key).

- Repository: this repo
- Branch: `coolify-postgres`
- Build pack: **Dockerfile** (auto-detected at repo root)
- Port (internal): `3000`
- Healthcheck path: `/healthcheck` (route already exists at
  `app/routes/healthcheck.tsx`)
- Start command: leave default — the Dockerfile's
  `CMD ["node", "./dbsetup.js", "npm", "run", "start"]` handles it

## Step 3 — Add the persistent volume

In the application's **Storage** tab → **+ Add**:

| Name       | Mount path in container |
| ---------- | ----------------------- |
| `fwn-data` | `/data`                 |

`dbsetup.js` creates `/data/pdfs` on first boot. The uploaded PDFs and
`/data/google-api-settings.json` live there.

## Step 4 — Environment variables

In the application's **Environment Variables** tab paste this block,
filling in the marked values:

```env
NODE_ENV=production
PORT=3000

# Internal URL from Step 1
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
# A store with a custom domain (rare; not for *.myshopify.com)
SHOP_CUSTOM_DOMAIN=

# Email notifications about PDF parsing results via Resend
RESEND_API_KEY=
NOTIFY_TO=
NOTIFY_FROM=
```

**Not** needed in env (handled in-app via the `/app/google-api` UI,
saved into `/data/google-api-settings.json`):

- `GOOGLE_OAUTH_CONFIG`
- Google API key / Service Account / OAuth tokens

## Step 5 — Domain

In **Domains** tab add your custom domain (e.g.
`fwn.expertshopify.fr`). Coolify provisions Let's Encrypt automatically.

Then in Shopify Partners → your app:

- **App URL** → `https://APP_DOMAIN`
- **Allowed redirection URLs** add:
  - `https://APP_DOMAIN/auth/callback`
  - `https://APP_DOMAIN/auth/shopify/callback`
  - `https://APP_DOMAIN/api/auth/callback`

In Google Cloud Console → OAuth Client → **Authorized redirect URIs**
add:
  - `https://APP_DOMAIN/app/google-api/callback`

Update `SHOPIFY_APP_URL` env var (Step 4) to the same domain.

## Step 6 — First deploy

Hit **Deploy**. Expect 5–10 minutes for the first build (apt installs
Python, Java, Ghostscript, Cairo headers; pip installs camelot +
pdfplumber + tabula-py + opencv-headless + numpy + pandas + pymupdf;
npm ci; prisma generate; remix vite build).

When the container starts, `dbsetup.js` will:

1. Create `/data/pdfs` if missing
2. Run `prisma migrate deploy` against the empty Postgres
3. Apply `prisma/seeds/initial-catalog.sql` → 26 suppliers + 6 products
   + 6 SKU mappings loaded
4. Start the app

Expected log lines:

```
✅ Created /data/pdfs
... prisma migrate output ...
🌱 Applying ./prisma/seeds/initial-catalog.sql
✅ Seed applied
Listening on port 3000
```

Visit `https://APP_DOMAIN/healthcheck` — should return `OK`.

---

## Step 7 — Configure Google in the app

Open `https://APP_DOMAIN/app/google-api` and fill in:

- **Spreadsheet ID** — from your Google Sheets URL
- **API Key** (or Service Account JSON, or run the OAuth2 flow) — any
  one auth method is fine for read-only catalog import

Click **Save Settings** → **Test API Connection** — should report
success.

## Step 8 — Import catalog from Sheets

On the same page, scroll to the **Import Catalog from Sheets** card.

1. Click **Dry Run (Preview)** first. The result panel will show the
   first 3 rows the importer parsed — verify product names and brands
   look right.
2. If correct, click **Import Now**. The action will upsert products
   and supplier SKU mappings, then append a fresh CMPRecord per
   product based on the current weighted-average cost from column G.

Re-running is safe — products are upserted by `skuFwn`, SKU mappings
by `(productId, sku)` natural key. Only CMPRecords append new rows so
historical cost evolution is preserved.

## Step 9 — Reinstall the Shopify app in your store

The old Shopify `Session` was bound to the Fly URL and is not migrated.
Open Shopify Partners → your app → **Test on development store** →
select your store → **Install**. A fresh `Session` row gets created
under the new domain.

---

## Sanity checklist

After Step 9:

- [ ] `https://APP_DOMAIN/healthcheck` → 200 OK
- [ ] In Coolify Postgres terminal:
  `SELECT count(*) FROM "Supplier";` returns 26
- [ ] `SELECT count(*) FROM "Product";` returns non-zero (after
  Step 8 import)
- [ ] `SELECT count(*) FROM "CMPRecord";` returns non-zero (after
  Step 8 import)
- [ ] Shopify admin shows the app installed and embedded UI loads
- [ ] Upload a test PDF — it parses without
  `ModuleNotFoundError: No module named 'camelot'` (proves the venv is
  active in the container)
- [ ] The uploaded PDF survives a container restart (proves `/data`
  volume is mounted correctly)

---

## Troubleshooting

**`prisma migrate deploy` fails on first boot**
The internal DB URL is wrong or the Postgres service isn't up yet.
Recheck `DATABASE_URL` in app env, redeploy.

**Seed apply step prints a warning but boot continues**
`dbsetup.js` is tolerant — if `prisma db execute` fails for any reason
(e.g. permissions), it logs the error and continues. Inspect the
Coolify container logs to see the exact message. The `ON CONFLICT`
clauses make the seed safe to retry on the next boot.

**`ModuleNotFoundError: No module named 'camelot'` when parsing a PDF**
The Python venv didn't end up first in `PATH`. This shouldn't happen
with the bundled Dockerfile. If you see it, verify Coolify is using
the Dockerfile build pack (not Nixpacks).

**PDFs vanish after redeploy**
The `/data` volume isn't mounted. Re-check Storage tab in Coolify.

**Import from Sheets reports the wrong column as product name**
Edit `app/services/catalogImport.server.ts` and adjust the column
indexes (lines marked `// B`, `// C`, `// E`, `// F`, etc.). The
spreadsheet layout is documented at the top of that file.

**Shopify session loops on login**
`SHOPIFY_APP_URL` in env doesn't match the URL the user is on, or the
Shopify Partners app entry still points at the old URL. Both must say
`https://APP_DOMAIN` exactly.

---

## Maintenance — re-importing catalog later

Whenever you update the spreadsheet and want the database to catch up
(new products, renamed brands, fresh CMP):

1. Open `https://APP_DOMAIN/app/google-api`
2. Click **Import Now** under "Import Catalog from Sheets"

That's it. No CLI, no SSH, no script runs.

## Future cleanup

Once Coolify is verified and you trust the seed flow:

- `prisma/dev.sqlite` and `scripts/dump-catalog-to-sql.ts` can be
  removed from the repo — the seed file is the source of truth.
- After the first successful boot, the seed apply on every subsequent
  restart is a no-op (everything `ON CONFLICT DO NOTHING`'s), so
  there's no urgency to remove `prisma/seeds/initial-catalog.sql`
  either.
