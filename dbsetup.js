#!/usr/bin/env node

import { spawn } from 'node:child_process'
import fs from 'node:fs'

const env = { ...process.env }

// Ensure PDF storage directory exists on the persistent volume.
// Postgres lives in its own service, so we no longer touch DB files here.
if (fs.existsSync('/data')) {
  if (!fs.existsSync('/data/pdfs')) {
    fs.mkdirSync('/data/pdfs', { recursive: true })
    console.log('✅ Created /data/pdfs')
  }
} else {
  console.log('⚠️  /data volume not found, using local storage fallback')
}

// Apply database migrations
await exec('npx prisma migrate deploy')

// Apply the catalog seed (idempotent — every row uses ON CONFLICT DO NOTHING).
// Safe to run on every boot.
const SEED_PATH = './prisma/seeds/initial-catalog.sql'
if (fs.existsSync(SEED_PATH)) {
  console.log(`🌱 Applying ${SEED_PATH}`)
  try {
    await exec(`npx prisma db execute --file ${SEED_PATH} --schema ./prisma/schema.prisma`)
    console.log('✅ Seed applied')
  } catch (err) {
    console.error('⚠️  Seed apply failed (continuing anyway):', err.message)
  }
}

// Launch the application
await exec(process.argv.slice(2).join(' '))

function exec(command) {
  const child = spawn(command, { shell: true, stdio: 'inherit', env })
  return new Promise((resolve, reject) => {
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} failed rc=${code}`))
      }
    })
  })
}
