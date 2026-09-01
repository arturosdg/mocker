#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'

import { startServer } from './server.js'

const DEFAULT_PORT = 4848

const directory = path.resolve(process.argv[2] ?? '.')
const mocksDirectory = path.join(directory, '.mocks')
const port = Number(process.env.MOCKER_PORT ?? DEFAULT_PORT)

if (!existsSync(mocksDirectory)) {
  console.error(`[mocker] no .mocks/ directory found in ${directory}`)
  process.exit(1)
}

startServer(mocksDirectory, port)
