import chokidar from 'chokidar'
import { WebSocketServer } from 'ws'

import { loadSnapshot } from './project.js'
import type { Snapshot } from './types.js'
import { applyWrite, type WriteRequest } from './writer.js'

export function startServer(mocksDirectory: string, port: number) {
  let snapshot: Snapshot = loadSnapshot(mocksDirectory)

  const server = new WebSocketServer({ port })

  server.on('connection', (socket) => {
    console.log('[mocker] extension connected')
    socket.send(JSON.stringify(snapshot))
    socket.on('close', () => console.log('[mocker] extension disconnected'))

    socket.on('message', (raw) => {
      let request: WriteRequest
      try {
        request = JSON.parse(String(raw)) as WriteRequest
      } catch {
        return
      }
      if (!request.requestId) return

      try {
        const id = applyWrite(mocksDirectory, request)
        socket.send(
          JSON.stringify({
            type: 'ack',
            requestId: request.requestId,
            ok: true,
            id,
          }),
        )
        console.log(`[mocker] ${request.type} → ${id}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        socket.send(
          JSON.stringify({
            type: 'ack',
            requestId: request.requestId,
            ok: false,
            error: message,
          }),
        )
        console.log(`[mocker] ${request.type} rejected: ${message}`)
      }
    })
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
