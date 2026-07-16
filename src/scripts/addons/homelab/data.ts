import {
    HOMELAB_CONFIG_VERSION,
    type HomelabCheck,
    type HomelabCheckState,
    type HomelabConfig,
    type HomelabOverallState,
    type HomelabPosition,
    type HomelabStatus,
    type HomelabStatusCache,
    type ParsedHomelabLinks,
} from './types.ts'

const POSITIONS: HomelabPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right']
const CHECK_STATES: HomelabCheckState[] = ['healthy', 'warning', 'failed', 'unknown']
const OVERALL_STATES: HomelabOverallState[] = ['healthy', 'degraded', 'unhealthy']

export const DEFAULT_HOMELAB_CONFIG: HomelabConfig = {
    version: HOMELAB_CONFIG_VERSION,
    enabled: false,
    title: 'Homelab',
    statusUrl: '',
    dashboardUrl: '',
    position: 'bottom-center',
    requestTimeoutMs: 2500,
    refreshIntervalSeconds: 0,
    staleAfterMinutes: 15,
    openInNewTab: false,
    links: [],
}

export function normalizeHomelabConfig(value: unknown): HomelabConfig {
    const input = isRecord(value) ? value : {}

    return {
        version: HOMELAB_CONFIG_VERSION,
        enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_HOMELAB_CONFIG.enabled,
        title: cleanText(input.title, 48) || DEFAULT_HOMELAB_CONFIG.title,
        statusUrl: parseHttpUrl(input.statusUrl),
        dashboardUrl: parseHttpUrl(input.dashboardUrl),
        position: isPosition(input.position) ? input.position : DEFAULT_HOMELAB_CONFIG.position,
        requestTimeoutMs: clampInteger(input.requestTimeoutMs, 500, 10_000, DEFAULT_HOMELAB_CONFIG.requestTimeoutMs),
        refreshIntervalSeconds: normalizeRefreshInterval(input.refreshIntervalSeconds),
        staleAfterMinutes: clampInteger(input.staleAfterMinutes, 1, 1440, DEFAULT_HOMELAB_CONFIG.staleAfterMinutes),
        openInNewTab: typeof input.openInNewTab === 'boolean'
            ? input.openInNewTab
            : DEFAULT_HOMELAB_CONFIG.openInNewTab,
        links: normalizeLinks(input.links),
    }
}

export function parseHomelabLinks(value: string): ParsedHomelabLinks {
    const links = []
    const errors: string[] = []
    const lines = value.split(/\r?\n/)

    for (const [index, rawLine] of lines.entries()) {
        const line = rawLine.trim()

        if (!line || line.startsWith('#')) {
            continue
        }

        if (links.length >= 32) {
            errors.push('Only the first 32 links can be saved.')
            break
        }

        const [rawLabel = '', rawUrl = '', rawIcon = ''] = line.split('|').map((part) => part.trim())
        const label = cleanText(rawLabel, 64)
        const url = parseHttpUrl(rawUrl)
        const icon = cleanText(rawIcon, 8)

        if (!label) {
            errors.push(`Line ${index + 1}: add a label before the first | character.`)
            continue
        }

        if (!url) {
            errors.push(`Line ${index + 1}: use a complete http:// or https:// URL without credentials.`)
            continue
        }

        links.push({ label, url, ...(icon ? { icon } : {}) })
    }

    return { links, errors }
}

export function serializeHomelabLinks(config: HomelabConfig): string {
    return config.links.map(({ label, url, icon }) => [label, url, icon].filter(Boolean).join(' | ')).join('\n')
}

export function parseHttpUrl(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }

    const input = value.trim()

    if (!input || input.length > 2048) {
        return ''
    }

    try {
        const url = new URL(input)
        const isHttp = url.protocol === 'http:' || url.protocol === 'https:'
        const hasCredentials = Boolean(url.username || url.password)

        return isHttp && !hasCredentials ? url.href : ''
    } catch (_) {
        return ''
    }
}

export function parseHomelabStatus(value: unknown): HomelabStatus {
    if (!isRecord(value) || !isOverallState(value.overall)) {
        throw new Error('The status response must include a valid overall state.')
    }

    if (!Array.isArray(value.checks)) {
        throw new Error('The status response must include a checks array.')
    }

    if (value.checks.length > 100) {
        throw new Error('The status response contains too many checks.')
    }

    const checks = value.checks.map(parseCheck)
    const generatedAt = parseTimestamp(value.generatedAt)
    const derivedFailures = checks.filter(({ state }) => state === 'failed').length
    const failures = clampInteger(value.failures, 0, 100, derivedFailures)

    return {
        ...(generatedAt ? { generatedAt } : {}),
        overall: value.overall,
        failures,
        checks,
    }
}

export function normalizeHomelabCache(value: unknown): HomelabStatusCache | undefined {
    if (!isRecord(value) || typeof value.fetchedAt !== 'number' || !Number.isFinite(value.fetchedAt)) {
        return undefined
    }

    try {
        return {
            fetchedAt: value.fetchedAt,
            status: parseHomelabStatus(value.status),
        }
    } catch (_) {
        return undefined
    }
}

export function statusAgeMs(status: HomelabStatus, fetchedAt: number, now = Date.now()): number {
    const generatedAt = status.generatedAt ? Date.parse(status.generatedAt) : Number.NaN
    const timestamp = Number.isFinite(generatedAt) ? generatedAt : fetchedAt

    return Math.max(0, now - timestamp)
}

function parseCheck(value: unknown, index: number): HomelabCheck {
    if (!isRecord(value) || !isCheckState(value.state)) {
        throw new Error(`Check ${index + 1} must include a valid state.`)
    }

    const id = cleanText(value.id, 64) || `check-${index + 1}`
    const label = cleanText(value.label, 96) || id
    const message = cleanText(value.message, 240)
    const href = parseHttpUrl(value.href)

    return {
        id,
        label,
        state: value.state,
        ...(message ? { message } : {}),
        ...(href ? { href } : {}),
    }
}

function normalizeLinks(value: unknown): HomelabConfig['links'] {
    if (!Array.isArray(value)) {
        return []
    }

    const links: HomelabConfig['links'] = []

    for (const item of value.slice(0, 32)) {
        if (!isRecord(item)) {
            continue
        }

        const label = cleanText(item.label, 64)
        const url = parseHttpUrl(item.url)
        const icon = cleanText(item.icon, 8)

        if (label && url) {
            links.push({ label, url, ...(icon ? { icon } : {}) })
        }
    }

    return links
}

function normalizeRefreshInterval(value: unknown): number {
    if (Number(value) === 0) {
        return 0
    }

    return clampInteger(value, 30, 86_400, DEFAULT_HOMELAB_CONFIG.refreshIntervalSeconds)
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
    const number = Number(value)

    if (!Number.isFinite(number)) {
        return fallback
    }

    return Math.min(maximum, Math.max(minimum, Math.round(number)))
}

function cleanText(value: unknown, length: number): string {
    return typeof value === 'string' ? value.trim().slice(0, length) : ''
}

function parseTimestamp(value: unknown): string | undefined {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
        return undefined
    }

    return new Date(value).toISOString()
}

function isPosition(value: unknown): value is HomelabPosition {
    return POSITIONS.includes(value as HomelabPosition)
}

function isCheckState(value: unknown): value is HomelabCheckState {
    return CHECK_STATES.includes(value as HomelabCheckState)
}

function isOverallState(value: unknown): value is HomelabOverallState {
    return OVERALL_STATES.includes(value as HomelabOverallState)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
