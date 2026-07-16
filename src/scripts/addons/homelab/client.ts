import { parseHomelabStatus } from './data.ts'

import type { HomelabStatus } from './types.ts'

const MAX_RESPONSE_SIZE = 64 * 1024

export async function fetchHomelabStatus(
    url: string,
    timeoutMs: number,
    fetcher: typeof fetch = globalThis.fetch,
): Promise<HomelabStatus> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
        const response = await fetcher(url, {
            cache: 'no-store',
            credentials: 'omit',
            headers: { Accept: 'application/json' },
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`The homelab endpoint returned HTTP ${response.status}.`)
        }

        const declaredLength = Number(response.headers.get('content-length'))

        if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_SIZE) {
            throw new Error('The homelab response is larger than 64 KiB.')
        }

        const body = await response.text()

        if (body.length > MAX_RESPONSE_SIZE) {
            throw new Error('The homelab response is larger than 64 KiB.')
        }

        return parseHomelabStatus(JSON.parse(body))
    } finally {
        clearTimeout(timeout)
    }
}
