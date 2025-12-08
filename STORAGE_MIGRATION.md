# 📦 Storage Migration Guide

This document explains the changes made to move PDF files and Google API settings to persistent storage on Fly.io.

## What Changed?

### Before:
- PDF files: `public/pdfs/` (ephemeral, lost on restart)
- Google settings: `google-api-settings.json` in project root (lost on deploy)

### After:
- PDF files: `/data/pdfs/` (persistent Fly.io volume)
- Google settings: `/data/google-api-settings.json` (persistent Fly.io volume)
- Fallback: `.local-storage/` for development

## How It Works

### 1. Storage Path Detection
New utility: `app/utils/storage.server.ts`

Automatically detects environment:
- **Production** with `/data` volume → uses `/data/pdfs` and `/data/google-api-settings.json`
- **Development** or no volume → uses `.local-storage/` in project

### 2. Automatic Directory Creation
`dbsetup.js` now creates directories on startup:
- `/data/pdfs/` for PDF files
- Database symlink to `/data/dev.sqlite`

### 3. Updated Files

**Code changes:**
- `app/utils/fileUpload.server.ts` - uses new storage paths
- `app/routes/app.review.$invoiceId.tsx` - Google settings path
- `app/routes/app.api.invoice.$invoiceId.export-excel.tsx` - Google settings path
- `app/routes/app.google-api.tsx` - Google settings path (2 functions)
- `app/routes/app.google-api.callback.tsx` - Google settings path (2 functions)

**Infrastructure:**
- `Dockerfile` - creates fallback directories
- `dbsetup.js` - creates volume directories on startup
- `.dockerignore` - excludes local storage from build

## Migration Steps

### For Existing Deployments:

1. **Create Fly.io volumes** (if not already created):
   ```bash
   flyctl volumes create data --size 3 --region fra
   # Create a second for redundancy:
   flyctl volumes create data --size 3 --region fra
   ```

2. **Set DATABASE_URL secret**:
   ```bash
   flyctl secrets set DATABASE_URL="file:/data/dev.sqlite"
   ```

3. **Deploy new version**:
   ```bash
   flyctl deploy
   ```

4. **Migrate existing data** (if you have PDFs/settings):
   ```bash
   # SSH into the app
   flyctl ssh console
   
   # Copy Google API settings (if exists)
   cp /app/google-api-settings.json /data/google-api-settings.json
   
   # PDFs will need to be re-uploaded as they were ephemeral
   exit
   ```

### For Fresh Deployments:

Just deploy! Everything is set up automatically:
```bash
flyctl deploy
```

## Verification

After deployment, check that directories were created:
```bash
flyctl ssh console
ls -la /data/
# Should show: pdfs/ and dev.sqlite
```

## Development

In development (locally), storage goes to:
- `.local-storage/pdfs/`
- `.local-storage/google-api-settings.json`

This directory is git-ignored and docker-ignored.

## Troubleshooting

### PDFs not accessible after deploy
- Check volume is mounted: `flyctl volumes list`
- Check `/data/pdfs` exists: `flyctl ssh console` → `ls /data`
- Check logs: `flyctl logs`

### Google API settings not persisting
- Settings are now in `/data/google-api-settings.json`
- Re-configure via UI: `/app/google-api`
- Or manually upload: `flyctl ssh console` → edit file

### Database issues
- Check DATABASE_URL: `flyctl secrets list`
- Should be: `file:/data/dev.sqlite`
- Run migrations: `flyctl ssh console` → `npx prisma migrate deploy`

