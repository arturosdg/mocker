import chokidar from 'chokidar'
import { WebSocketServer } from 'ws'

import { loadSnapshot } from './project.js'
import type { Snapshot } from './types.js'

export function startServer(mocksDirectory: string, port: number) {
  let snapshot: Snapshot = loadSnapshot(mocksDirectory)

  const server = new WebSocketServer({ port })

  server.on('connection', (socket) => {
    console.log('[mocker] extension connected')
    socket.send(JSON.stringify(snapshot))
    socket.on('close', () => console.log('[mocker] extension disconnected'))
  })

  const broadcast = () => {
    const data = JSON.stringify(snapshot)
    for (const client of server.clients) client.send(data)
  }

  chokidar.watch(mocksDirectory, { ignoreInitial: true }).on('all', () => {
    try {
      snapshot = loadSnapshot(mocksDirectory)
      broadcast()
      console.log(`[mocker] reloaded: ${snapshot.scenarios.length} scenario(s)`)
    } catch (error) {
      console.error(
        `[mocker] reload failed: ${error instanceof Error ? error.message : error}`,
      )
    }
  })

  console.log(
    `[mocker] serving "${snapshot.project.name}" (${snapshot.scenarios.length} scenario(s)) on ws://localhost:${port}`,
  )
}
