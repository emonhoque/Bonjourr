export const HOMELAB_CONFIG_VERSION = 1

export const HOMELAB_CONFIG_CHANGED_EVENT = 'bonjourr:homelab-config-changed'
export const HOMELAB_REFRESH_EVENT = 'bonjourr:homelab-refresh'

export type HomelabPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type HomelabCheckState = 'healthy' | 'warning' | 'failed' | 'unknown'
export type HomelabOverallState = 'healthy' | 'degraded' | 'unhealthy'

export interface HomelabLink {
    label: string
    url: string
    icon?: string
}

export interface HomelabConfig {
    version: typeof HOMELAB_CONFIG_VERSION
    enabled: boolean
    title: string
    statusUrl: string
    dashboardUrl: string
    position: HomelabPosition
    requestTimeoutMs: number
    refreshIntervalSeconds: number
    staleAfterMinutes: number
    openInNewTab: boolean
    links: HomelabLink[]
}

export interface HomelabCheck {
    id: string
    label: string
    state: HomelabCheckState
    message?: string
    href?: string
}

export interface HomelabStatus {
    generatedAt?: string
    overall: HomelabOverallState
    failures: number
    checks: HomelabCheck[]
}

export interface HomelabStatusCache {
    fetchedAt: number
    status: HomelabStatus
}

export interface ParsedHomelabLinks {
    links: HomelabLink[]
    errors: string[]
}
