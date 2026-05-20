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
