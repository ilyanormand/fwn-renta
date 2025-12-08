#!/usr/bin/env node

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

const env = { ...process.env }

// Create necessary directories on /data volume if it exists
if (fs.existsSync('/data')) {
  console.log('📁 Setting up /data volume directories...')
  
  // Create pdfs directory
  if (!fs.existsSync('/data/pdfs')) {
    fs.mkdirSync('/data/pdfs', { recursive: true })
    console.log('✅ Created /data/pdfs')
  }
  
  // Place Sqlite3 database on volume
  const source = path.resolve('/dev.sqlite')
  const target = '/data/' + path.basename(source)
  if (!fs.existsSync(source)) {
    fs.symlinkSync(target, source)
    console.log('✅ Created database symlink')
  }
} else {
  console.log('⚠️  /data volume not found, using local storage')
}

// prepare database
await exec('npx prisma migrate deploy')

// launch application
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
