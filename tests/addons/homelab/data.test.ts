import { assertEquals, assertThrows } from '@std/assert'
import {
    normalizeHomelabCache,
    normalizeHomelabConfig,
    parseHomelabLinks,
    parseHomelabStatus,
    statusAgeMs,
} from '../../../src/scripts/addons/homelab/data.ts'

Deno.test('homelab config is disabled and network-free by default', () => {
    const config = normalizeHomelabConfig(undefined)

    assertEquals(config.enabled, false)
    assertEquals(config.statusUrl, '')
    assertEquals(config.dashboardUrl, '')
    assertEquals(config.refreshIntervalSeconds, 0)
    assertEquals(config.links, [])
})

Deno.test('homelab config rejects credentialed and non-http URLs', () => {
    const config = normalizeHomelabConfig({
        enabled: true,
        statusUrl: 'https://user:secret@status.home.arpa/summary.json',
        dashboardUrl: 'javascript:alert(1)',
        links: [
            { label: 'Valid', url: 'https://homepage.home.arpa' },
            { label: 'Invalid', url: 'file:///etc/passwd' },
        ],
    })

    assertEquals(config.statusUrl, '')
    assertEquals(config.dashboardUrl, '')
    assertEquals(config.links, [{ label: 'Valid', url: 'https://homepage.home.arpa/' }])
})

Deno.test('homelab link text supports labels, URLs, optional icons, and comments', () => {
    const parsed = parseHomelabLinks(`
        # Local tools
        Homepage | https://homepage.home.arpa | 🏠
        Sonarr | http://sonarr.home.arpa
        Broken | ftp://example.com
    `)

    assertEquals(parsed.links, [
        { label: 'Homepage', url: 'https://homepage.home.arpa/', icon: '🏠' },
        { label: 'Sonarr', url: 'http://sonarr.home.arpa/' },
    ])
    assertEquals(parsed.errors, ['Line 5: use a complete http:// or https:// URL without credentials.'])
})

Deno.test('homelab status payload is normalized for safe rendering', () => {
    const status = parseHomelabStatus({
        generatedAt: '2026-07-14T12:00:00Z',
        overall: 'degraded',
        checks: [
            { id: 'docker', label: 'Docker', state: 'healthy' },
            {
                id: 'backup',
                label: 'Backups',
                state: 'failed',
                message: 'Backup is overdue',
                href: 'https://homepage.home.arpa/backups',
            },
        ],
        updates: {
            available: 3,
            checkedAt: '2026-07-14T11:55:00Z',
            href: 'http://wud.homelab.home.arpa',
            reviewHref: 'https://github.com/emonhoque/Homelab/issues/12',
        },
    })

    assertEquals(status, {
        generatedAt: '2026-07-14T12:00:00.000Z',
        overall: 'degraded',
        failures: 1,
        checks: [
            { id: 'docker', label: 'Docker', state: 'healthy' },
            {
                id: 'backup',
                label: 'Backups',
                state: 'failed',
                message: 'Backup is overdue',
                href: 'https://homepage.home.arpa/backups',
            },
        ],
        updates: {
            available: 3,
            checkedAt: '2026-07-14T11:55:00.000Z',
            href: 'http://wud.homelab.home.arpa/',
            reviewHref: 'https://github.com/emonhoque/Homelab/issues/12',
        },
    })
})

Deno.test('update availability remains optional', () => {
    const status = parseHomelabStatus({
        overall: 'healthy',
        failures: 0,
        checks: [],
    })

    assertEquals(status.updates, undefined)
})

Deno.test('homelab status rejects malformed states', () => {
    assertThrows(
        () => parseHomelabStatus({ overall: 'fine', checks: [] }),
        Error,
        'valid overall state',
    )

    assertThrows(
        () => parseHomelabStatus({ overall: 'healthy', checks: [{ state: 'down' }] }),
        Error,
        'valid state',
    )
})

Deno.test('homelab status rejects malformed update metadata', () => {
    assertThrows(
        () =>
            parseHomelabStatus({
                overall: 'healthy',
                checks: [],
                updates: { available: -1, href: 'http://wud.home.arpa' },
            }),
        Error,
        'integer from 0 through 1000',
    )

    assertThrows(
        () =>
            parseHomelabStatus({
                overall: 'healthy',
                checks: [],
                updates: { available: 1, href: 'https://user:secret@wud.home.arpa' },
            }),
        Error,
        'without credentials',
    )

    assertThrows(
        () =>
            parseHomelabStatus({
                overall: 'healthy',
                checks: [],
                updates: {
                    available: 1,
                    href: 'http://wud.home.arpa',
                    reviewHref: 'javascript:alert(1)',
                },
            }),
        Error,
        'reviewHref',
    )
})

Deno.test('homelab cache validates its status and reports source age', () => {
    const cache = normalizeHomelabCache({
        fetchedAt: 1_000,
        status: { overall: 'healthy', failures: 0, checks: [] },
    })

    assertEquals(cache?.fetchedAt, 1_000)
    assertEquals(statusAgeMs(cache!.status, cache!.fetchedAt, 61_000), 60_000)
    assertEquals(normalizeHomelabCache({ fetchedAt: 'yesterday', status: {} }), undefined)
})
