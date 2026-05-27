import { createServer, type Server } from 'node:http'
import { once } from 'node:events'

export interface MockRegistry {
  url: string
  add(packageName: string): void
  close(): Promise<void>
}

/**
 * Creates a minimal fake npm registry server.
 * - Returns 200 + a minimal packument JSON for known packages.
 * - Returns 404 for everything else.
 * - Handles scoped package names: @org%2Fpkg → @org/pkg lookup.
 */
export async function createMockRegistry(knownPackages: string[] = []): Promise<MockRegistry> {
  const known = new Set(knownPackages)

  const server: Server = createServer((req, res) => {
    // Decode %2F → / and strip leading slash to get package name
    const rawPath = decodeURIComponent(req.url ?? '/').slice(1)

    if (known.has(rawPath)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ 'name': rawPath, 'versions': {}, 'dist-tags': {} }))
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })

  server.listen(0) // OS picks the port
  await once(server, 'listening')

  const addr = server.address() as { port: number }

  return {
    url: `http://localhost:${addr.port}`,
    add(name: string) {
      known.add(name)
    },
    async close() {
      server.close()
      await once(server, 'close')
    },
  }
}
