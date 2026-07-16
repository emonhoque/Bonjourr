import { assertEquals, assertRejects } from '@std/assert'
import { fetchHomelabStatus } from '../../../src/scripts/addons/homelab/client.ts'

Deno.test('homelab client requests JSON without credentials and parses the response', async () => {
    let requestInit: RequestInit | undefined
    const fetcher = ((_url: string | URL | Request, init?: RequestInit) => {
        requestInit = init
        return Promise.resolve(
            new Response(JSON.stringify({ overall: 'healthy', failures: 0, checks: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            }),
        )
    }) as typeof fetch

    const result = await fetchHomelabStatus('https://status.home.arpa/summary.json', 500, fetcher)

    assertEquals(result.overall, 'healthy')
    assertEquals(requestInit?.credentials, 'omit')
    assertEquals(requestInit?.cache, 'no-store')
    assertEquals(requestInit?.referrerPolicy, 'no-referrer')
})

Deno.test('homelab client rejects unsuccessful responses', async () => {
    const fetcher = (() => Promise.resolve(new Response('Unavailable', { status: 503 }))) as typeof fetch

    await assertRejects(
        () => fetchHomelabStatus('https://status.home.arpa/summary.json', 500, fetcher),
        Error,
        'HTTP 503',
    )
})

Deno.test('homelab client limits response size', async () => {
    const fetcher = (() =>
        Promise.resolve(
            new Response('{}', {
                status: 200,
                headers: { 'content-length': String(65 * 1024) },
            }),
        )) as typeof fetch

    await assertRejects(
        () => fetchHomelabStatus('https://status.home.arpa/summary.json', 500, fetcher),
        Error,
        'larger than 64 KiB',
    )
})
