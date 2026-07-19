import { fetchHomelabStatus } from './client.ts'
import { DEFAULT_HOMELAB_CONFIG, normalizeHomelabConfig, statusAgeMs } from './data.ts'
import { registerHomelabSettings } from './settings.ts'
import { readHomelabCache, readHomelabConfig, writeHomelabCache } from './storage.ts'
import {
    HOMELAB_CONFIG_CHANGED_EVENT,
    HOMELAB_REFRESH_EVENT,
    type HomelabCheck,
    type HomelabConfig,
    type HomelabStatus,
    type HomelabStatusCache,
} from './types.ts'

interface HomelabView {
    root: HTMLElement
    status: HTMLElement
    summary: HTMLAnchorElement
    title: HTMLElement
    message: HTMLElement
    meta: HTMLTimeElement
    refresh: HTMLButtonElement
    failures: HTMLUListElement
    updates: HTMLElement
    updateLink: HTMLAnchorElement
    updateMessage: HTMLElement
    updateReview: HTMLAnchorElement
    links: HTMLElement
}

let initialized = false

export function homelabAddon(): void {
    if (initialized) {
        return
    }

    initialized = true
    registerHomelabSettings()

    try {
        const view = createView()
        const controller = createController(view)

        document.addEventListener(HOMELAB_CONFIG_CHANGED_EVENT, (event) => {
            const config = normalizeHomelabConfig((event as CustomEvent).detail)
            void controller.applyConfig(config)
        })

        document.addEventListener(HOMELAB_REFRESH_EVENT, () => {
            void controller.refresh()
        })

        document.addEventListener('visibilitychange', controller.visibilityChanged)
        void readHomelabConfig().then(controller.applyConfig)
    } catch (error) {
        console.warn('The homelab add-on could not start.', error)
    }
}

function createController(view: HomelabView): {
    applyConfig: (config: HomelabConfig) => Promise<void>
    refresh: () => Promise<void>
    visibilityChanged: () => void
} {
    let config = DEFAULT_HOMELAB_CONFIG
    let cache: HomelabStatusCache | undefined
    let configGeneration = 0
    let requestGeneration = 0
    let lastRequestAt = 0
    let refreshTimer: ReturnType<typeof setTimeout> | undefined

    async function applyConfig(nextConfig: HomelabConfig): Promise<void> {
        configGeneration += 1
        requestGeneration += 1
        clearRefreshTimer()
        config = normalizeHomelabConfig(nextConfig)
        renderConfig(view, config)

        if (!config.enabled || !config.statusUrl) {
            return
        }

        const generation = configGeneration
        cache = await readHomelabCache()

        if (generation !== configGeneration) {
            return
        }

        renderChecking(view, cache, config)
        await refresh()
    }

    async function refresh(): Promise<void> {
        if (!config.enabled || !config.statusUrl || document.visibilityState === 'hidden') {
            return
        }

        const currentConfigGeneration = configGeneration
        const currentRequestGeneration = ++requestGeneration
        lastRequestAt = Date.now()
        renderChecking(view, cache, config)

        try {
            const status = await fetchHomelabStatus(config.statusUrl, config.requestTimeoutMs)

            if (currentConfigGeneration !== configGeneration || currentRequestGeneration !== requestGeneration) {
                return
            }

            cache = { status, fetchedAt: Date.now() }
            renderLiveStatus(view, status, cache.fetchedAt, config)

            try {
                await writeHomelabCache(cache)
            } catch (_) {
                console.info('The homelab status cache could not be saved.')
            }
        } catch (error) {
            if (currentConfigGeneration !== configGeneration || currentRequestGeneration !== requestGeneration) {
                return
            }

            renderUnavailable(view, cache, config)
            console.info('The homelab status endpoint is unavailable.', error)
        } finally {
            if (currentConfigGeneration === configGeneration && currentRequestGeneration === requestGeneration) {
                scheduleRefresh()
            }
        }
    }

    function scheduleRefresh(): void {
        clearRefreshTimer()

        if (!config.enabled || !config.statusUrl || config.refreshIntervalSeconds === 0) {
            return
        }

        if (document.visibilityState === 'hidden') {
            return
        }

        refreshTimer = setTimeout(() => {
            void refresh()
        }, config.refreshIntervalSeconds * 1000)
    }

    function visibilityChanged(): void {
        clearRefreshTimer()

        if (document.visibilityState !== 'visible' || config.refreshIntervalSeconds === 0) {
            return
        }

        const refreshIntervalMs = config.refreshIntervalSeconds * 1000
        const elapsed = Date.now() - lastRequestAt

        if (elapsed >= refreshIntervalMs) {
            void refresh()
            return
        }

        refreshTimer = setTimeout(() => {
            void refresh()
        }, refreshIntervalMs - elapsed)
    }

    function clearRefreshTimer(): void {
        if (refreshTimer) {
            clearTimeout(refreshTimer)
            refreshTimer = undefined
        }
    }

    return { applyConfig, refresh, visibilityChanged }
}

function createView(): HomelabView {
    const root = document.createElement('section')
    root.id = 'homelab-addon'
    root.className = 'hidden'
    root.setAttribute('aria-label', 'Homelab glance')
    root.innerHTML = `
        <div id="homelab-addon-status" class="glass">
            <a id="homelab-addon-summary">
                <span id="homelab-addon-dot" aria-hidden="true"></span>
                <span id="homelab-addon-title">Homelab</span>
                <span id="homelab-addon-message"></span>
                <time id="homelab-addon-meta"></time>
            </a>
            <button id="homelab-addon-refresh" type="button" aria-label="Refresh homelab status" title="Refresh status">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 6v5h-5M4 18v-5h5M6.1 9a7 7 0 0 1 11.3-2.1L20 10M4 14l2.6 3.1A7 7 0 0 0 17.9 15" />
                </svg>
            </button>
        </div>
        <ul id="homelab-addon-failures" hidden></ul>
        <div id="homelab-addon-updates" class="glass" hidden>
            <a id="homelab-addon-updates-link">
                <span id="homelab-addon-updates-icon" aria-hidden="true">↻</span>
                <span id="homelab-addon-updates-message"></span>
            </a>
            <a id="homelab-addon-updates-review" hidden>Review</a>
        </div>
        <nav id="homelab-addon-links" aria-label="Homelab quick links"></nav>
    `
    document.body.append(root)

    const view: HomelabView = {
        root,
        status: element('homelab-addon-status'),
        summary: element<HTMLAnchorElement>('homelab-addon-summary'),
        title: element('homelab-addon-title'),
        message: element('homelab-addon-message'),
        meta: element<HTMLTimeElement>('homelab-addon-meta'),
        refresh: element<HTMLButtonElement>('homelab-addon-refresh'),
        failures: element<HTMLUListElement>('homelab-addon-failures'),
        updates: element('homelab-addon-updates'),
        updateLink: element<HTMLAnchorElement>('homelab-addon-updates-link'),
        updateMessage: element('homelab-addon-updates-message'),
        updateReview: element<HTMLAnchorElement>('homelab-addon-updates-review'),
        links: element('homelab-addon-links'),
    }

    view.refresh.addEventListener('click', () => document.dispatchEvent(new Event(HOMELAB_REFRESH_EVENT)))

    return view
}

function renderConfig(view: HomelabView, config: HomelabConfig): void {
    const hasContent = Boolean(config.statusUrl || config.links.length)

    view.root.classList.toggle('hidden', !config.enabled || !hasContent)
    view.root.dataset.position = config.position
    view.title.textContent = config.title
    view.status.hidden = !config.statusUrl
    view.refresh.disabled = !config.statusUrl
    renderDashboardLink(view.summary, config)
    renderLinks(view.links, config)

    if (!config.statusUrl) {
        view.failures.replaceChildren()
        view.failures.hidden = true
        hideUpdates(view)
    }
}

function renderDashboardLink(link: HTMLAnchorElement, config: HomelabConfig): void {
    if (!config.dashboardUrl) {
        link.removeAttribute('href')
        link.removeAttribute('target')
        link.removeAttribute('rel')
        return
    }

    link.href = config.dashboardUrl
    setTarget(link, config.openInNewTab)
}

function renderLinks(container: HTMLElement, config: HomelabConfig): void {
    const fragment = document.createDocumentFragment()

    for (const link of config.links) {
        const anchor = document.createElement('a')
        const icon = document.createElement('span')
        const label = document.createElement('span')

        anchor.href = link.url
        anchor.title = link.label
        setTarget(anchor, config.openInNewTab)

        icon.className = 'homelab-addon-link-icon'
        icon.textContent = link.icon || link.label.slice(0, 1).toUpperCase()
        icon.setAttribute('aria-hidden', 'true')

        label.className = 'homelab-addon-link-label'
        label.textContent = link.label

        anchor.append(icon, label)
        fragment.append(anchor)
    }

    container.replaceChildren(fragment)
    container.hidden = config.links.length === 0
}

function renderChecking(view: HomelabView, cache: HomelabStatusCache | undefined, config: HomelabConfig): void {
    view.root.dataset.state = 'checking'
    view.root.dataset.stale = cache ? 'true' : 'false'
    view.message.textContent = 'Checking status'
    setMeta(view.meta, cache ? `Last reached ${formatAge(cache.fetchedAt)}` : '', cache?.fetchedAt)
    view.failures.replaceChildren()
    view.failures.hidden = true
    renderUpdates(view, cache?.status.updates, config, Boolean(cache))
}

function renderLiveStatus(
    view: HomelabView,
    status: HomelabStatus,
    fetchedAt: number,
    config: HomelabConfig,
): void {
    const stale = statusAgeMs(status, fetchedAt) > config.staleAfterMinutes * 60_000
    const issues = status.checks.filter(({ state }) => state !== 'healthy')
    const issueCount = Math.max(status.failures, issues.length)

    view.root.dataset.state = stale ? 'stale' : status.overall
    view.root.dataset.stale = stale.toString()

    if (stale) {
        view.message.textContent = 'Status data is stale'
    } else if (status.overall === 'healthy') {
        view.message.textContent = 'All systems operational'
    } else {
        view.message.textContent = issueCount === 1 ? '1 issue needs attention' : `${issueCount} issues need attention`
    }

    const generatedAt = status.generatedAt ? Date.parse(status.generatedAt) : fetchedAt
    setMeta(view.meta, stale ? `Generated ${formatAge(generatedAt)}` : 'Updated just now', generatedAt)
    renderFailures(view.failures, issues)
    renderUpdates(view, status.updates, config, stale)
}

function renderUnavailable(view: HomelabView, cache: HomelabStatusCache | undefined, config: HomelabConfig): void {
    view.root.dataset.state = 'unavailable'
    view.root.dataset.stale = cache ? 'true' : 'false'
    view.message.textContent = 'Homelab unavailable'

    if (cache) {
        setMeta(view.meta, `Last reached ${formatAge(cache.fetchedAt)}`, cache.fetchedAt)
        renderFailures(view.failures, cache.status.checks.filter(({ state }) => state !== 'healthy'))
        renderUpdates(view, cache.status.updates, config, true)
    } else {
        setMeta(view.meta, 'No cached status')
        view.failures.replaceChildren()
        view.failures.hidden = true
        hideUpdates(view)
    }
}

function renderUpdates(
    view: HomelabView,
    updates: HomelabStatus['updates'],
    config: HomelabConfig,
    stale: boolean,
): void {
    if (!updates || updates.available === 0) {
        hideUpdates(view)
        return
    }

    view.updates.hidden = false
    view.updates.dataset.stale = stale.toString()
    view.updateMessage.textContent = updates.available === 1 ? '1 update available' : `${updates.available} updates available`
    view.updateLink.href = updates.href
    view.updateLink.title = updates.checkedAt
        ? `Open WUD · checked ${formatAge(Date.parse(updates.checkedAt))}`
        : 'Open WUD'
    setTarget(view.updateLink, config.openInNewTab)

    if (updates.reviewHref) {
        view.updateReview.hidden = false
        view.updateReview.href = updates.reviewHref
        view.updateReview.title = 'Open Renovate Dependency Dashboard'
        setTarget(view.updateReview, config.openInNewTab)
    } else {
        view.updateReview.hidden = true
        view.updateReview.removeAttribute('href')
        view.updateReview.removeAttribute('target')
        view.updateReview.removeAttribute('rel')
        view.updateReview.removeAttribute('title')
    }
}

function hideUpdates(view: HomelabView): void {
    view.updates.hidden = true
    view.updates.removeAttribute('data-stale')
    view.updateMessage.textContent = ''
    view.updateLink.removeAttribute('href')
    view.updateLink.removeAttribute('target')
    view.updateLink.removeAttribute('rel')
    view.updateLink.removeAttribute('title')
    view.updateReview.hidden = true
    view.updateReview.removeAttribute('href')
    view.updateReview.removeAttribute('target')
    view.updateReview.removeAttribute('rel')
    view.updateReview.removeAttribute('title')
}

function renderFailures(container: HTMLUListElement, checks: HomelabCheck[]): void {
    const fragment = document.createDocumentFragment()
    const visibleChecks = checks.slice(0, 5)

    for (const check of visibleChecks) {
        const item = document.createElement('li')
        const content = check.href ? document.createElement('a') : document.createElement('div')
        const label = document.createElement('strong')
        const message = document.createElement('span')

        item.dataset.state = check.state
        label.textContent = check.label
        message.textContent = check.message || check.state

        if (content instanceof HTMLAnchorElement && check.href) {
            content.href = check.href
            content.rel = 'noreferrer noopener'
        }

        content.append(label, message)
        item.append(content)
        fragment.append(item)
    }

    if (checks.length > visibleChecks.length) {
        const more = document.createElement('li')
        more.className = 'homelab-addon-more'
        more.textContent = `+${checks.length - visibleChecks.length} more`
        fragment.append(more)
    }

    container.replaceChildren(fragment)
    container.hidden = checks.length === 0
}

function setTarget(link: HTMLAnchorElement, openInNewTab: boolean): void {
    if (openInNewTab) {
        link.target = '_blank'
        link.rel = 'noreferrer noopener'
        return
    }

    link.removeAttribute('target')
    link.rel = 'noreferrer'
}

function setMeta(element: HTMLTimeElement, label: string, timestamp?: number): void {
    element.textContent = label

    if (timestamp) {
        element.dateTime = new Date(timestamp).toISOString()
        element.title = new Date(timestamp).toLocaleString()
    } else {
        element.removeAttribute('datetime')
        element.removeAttribute('title')
    }
}

function formatAge(timestamp: number): string {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))

    if (seconds < 60) {
        return 'just now'
    }

    const minutes = Math.round(seconds / 60)

    if (minutes < 60) {
        return `${minutes}m ago`
    }

    const hours = Math.round(minutes / 60)

    if (hours < 48) {
        return `${hours}h ago`
    }

    return `${Math.round(hours / 24)}d ago`
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T
}
