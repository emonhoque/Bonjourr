import { normalizeHomelabConfig, parseHomelabLinks, parseHttpUrl, serializeHomelabLinks } from './data.ts'
import { readHomelabConfig, writeHomelabConfig } from './storage.ts'
import {
    HOMELAB_CONFIG_CHANGED_EVENT,
    HOMELAB_REFRESH_EVENT,
    type HomelabConfig,
    type HomelabPosition,
} from './types.ts'
import { onSettingsLoad } from '../../utils/onsettingsload.ts'

const MAX_IMPORT_SIZE = 64 * 1024

export function registerHomelabSettings(): void {
    onSettingsLoad(() => {
        void initHomelabSettings()
    })
}

async function initHomelabSettings(): Promise<void> {
    if (document.getElementById('homelab-addon-settings')) {
        return
    }

    const settings = document.getElementById('settings')

    if (!settings) {
        return
    }

    const section = document.createElement('section')
    section.id = 'homelab-addon-settings'
    section.innerHTML = `
        <div class="settings-title">
            <h2>Homelab add-on</h2>
        </div>

        <p class="homelab-settings-intro">
            Optional glance status and local shortcuts. Bonjourr remains fully usable when the homelab is unavailable.
        </p>

        <form id="homelab-addon-form" class="param">
            <div class="wrapper">
                <label for="homelab-addon-enabled">Enable add-on</label>
                <input id="homelab-addon-enabled" class="switch" type="checkbox" />
            </div>

            <div id="homelab-addon-options">
                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-title">Title</label>
                    <input id="homelab-addon-title" type="text" maxlength="48" autocomplete="off" />
                </div>

                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-position">Position</label>
                    <select id="homelab-addon-position">
                        <option value="top-left">Top left</option>
                        <option value="top-right">Top right</option>
                        <option value="bottom-left">Bottom left</option>
                        <option value="bottom-center">Bottom center</option>
                        <option value="bottom-right">Bottom right</option>
                    </select>
                </div>

                <hr />

                <div class="wrapper homelab-wide-setting">
                    <label for="homelab-addon-dashboard-url">Dashboard URL</label>
                    <input
                        id="homelab-addon-dashboard-url"
                        type="url"
                        maxlength="2048"
                        placeholder="https://homepage.home.arpa"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        spellcheck="false"
                    />
                </div>

                <hr />

                <div class="wrapper homelab-wide-setting">
                    <label for="homelab-addon-status-url">Status JSON URL</label>
                    <input
                        id="homelab-addon-status-url"
                        type="url"
                        maxlength="2048"
                        placeholder="https://status.home.arpa/summary.json"
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="off"
                        spellcheck="false"
                    />
                </div>

                <p class="homelab-settings-help">
                    Optional. The endpoint must allow CORS and must not require credentials or expose secrets.
                </p>

                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-timeout">Request timeout</label>
                    <span class="homelab-number-input">
                        <input id="homelab-addon-timeout" type="number" min="500" max="10000" step="100" />
                        <small>ms</small>
                    </span>
                </div>

                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-refresh">Refresh interval</label>
                    <span class="homelab-number-input">
                        <input id="homelab-addon-refresh" type="number" min="0" max="86400" step="30" />
                        <small>sec</small>
                    </span>
                </div>

                <p class="homelab-settings-help">Use 0 for one request per new tab. Polling pauses while the tab is hidden.</p>

                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-stale">Stale after</label>
                    <span class="homelab-number-input">
                        <input id="homelab-addon-stale" type="number" min="1" max="1440" step="1" />
                        <small>min</small>
                    </span>
                </div>

                <hr />

                <div class="wrapper">
                    <label for="homelab-addon-new-tab">Open links in a new tab</label>
                    <input id="homelab-addon-new-tab" class="switch" type="checkbox" />
                </div>

                <hr />

                <label class="homelab-links-label" for="homelab-addon-links">Quick links</label>
                <p class="homelab-settings-help">One per line: Label | URL | optional emoji</p>
                <textarea
                    id="homelab-addon-links"
                    class="param-textarea"
                    rows="6"
                    spellcheck="false"
                    placeholder="Homepage | https://homepage.home.arpa | 🏠"
                ></textarea>
            </div>

            <div class="homelab-settings-actions">
                <button class="param-btn" type="submit">Save add-on</button>
                <button id="homelab-addon-refresh-now" class="param-btn" type="button">Refresh status</button>
                <button id="homelab-addon-export" class="param-btn" type="button">Export config</button>
                <button id="homelab-addon-import" class="param-btn" type="button">Import config</button>
                <input id="homelab-addon-import-file" type="file" accept="application/json,.json" hidden />
            </div>

            <p id="homelab-addon-feedback" class="homelab-settings-feedback" role="status" aria-live="polite"></p>
        </form>
    `

    const anchor = settings.querySelector('.as_updates')
    anchor ? anchor.before(section) : settings.append(section)

    const config = await readHomelabConfig()
    fillForm(config)
    initEvents()
}

function initEvents(): void {
    const form = element<HTMLFormElement>('homelab-addon-form')
    const enabled = element<HTMLInputElement>('homelab-addon-enabled')

    enabled.addEventListener('change', () => toggleOptions(enabled.checked))

    form.addEventListener('submit', (event) => {
        event.preventDefault()
        void saveForm()
    })

    element<HTMLButtonElement>('homelab-addon-refresh-now').addEventListener('click', () => {
        document.dispatchEvent(new Event(HOMELAB_REFRESH_EVENT))
        setFeedback('Refresh requested.')
    })

    element<HTMLButtonElement>('homelab-addon-export').addEventListener('click', () => {
        void exportConfig()
    })

    const importFile = element<HTMLInputElement>('homelab-addon-import-file')
    element<HTMLButtonElement>('homelab-addon-import').addEventListener('click', () => importFile.click())
    importFile.addEventListener('change', () => {
        void importConfig(importFile)
    })
}

async function saveForm(): Promise<void> {
    const result = configFromForm()

    if (result.errors.length > 0 || !result.config) {
        setFeedback(result.errors[0] ?? 'The add-on settings are invalid.', true)
        return
    }

    try {
        await writeHomelabConfig(result.config)
        document.dispatchEvent(new CustomEvent(HOMELAB_CONFIG_CHANGED_EVENT, { detail: result.config }))
        setFeedback('Add-on settings saved.')
    } catch (_) {
        setFeedback('Could not save the add-on settings.', true)
    }
}

function configFromForm(): { config?: HomelabConfig; errors: string[] } {
    const statusUrlInput = element<HTMLInputElement>('homelab-addon-status-url').value.trim()
    const dashboardUrlInput = element<HTMLInputElement>('homelab-addon-dashboard-url').value.trim()
    const parsedLinks = parseHomelabLinks(element<HTMLTextAreaElement>('homelab-addon-links').value)
    const errors = [...parsedLinks.errors]
    const refreshInterval = Number(element<HTMLInputElement>('homelab-addon-refresh').value)

    if (statusUrlInput && !parseHttpUrl(statusUrlInput)) {
        errors.unshift('Status JSON URL must be a complete http:// or https:// URL without credentials.')
    }

    if (dashboardUrlInput && !parseHttpUrl(dashboardUrlInput)) {
        errors.unshift('Dashboard URL must be a complete http:// or https:// URL without credentials.')
    }

    if (refreshInterval !== 0 && (refreshInterval < 30 || refreshInterval > 86_400)) {
        errors.unshift('Refresh interval must be 0 or between 30 and 86400 seconds.')
    }

    const numericInputs = [
        element<HTMLInputElement>('homelab-addon-timeout'),
        element<HTMLInputElement>('homelab-addon-refresh'),
        element<HTMLInputElement>('homelab-addon-stale'),
    ]

    if (numericInputs.some((input) => !input.checkValidity())) {
        errors.unshift('One of the timing values is outside its allowed range.')
    }

    if (errors.length > 0) {
        return { errors }
    }

    return {
        errors,
        config: normalizeHomelabConfig({
            enabled: element<HTMLInputElement>('homelab-addon-enabled').checked,
            title: element<HTMLInputElement>('homelab-addon-title').value,
            statusUrl: statusUrlInput,
            dashboardUrl: dashboardUrlInput,
            position: element<HTMLSelectElement>('homelab-addon-position').value as HomelabPosition,
            requestTimeoutMs: Number(element<HTMLInputElement>('homelab-addon-timeout').value),
            refreshIntervalSeconds: refreshInterval,
            staleAfterMinutes: Number(element<HTMLInputElement>('homelab-addon-stale').value),
            openInNewTab: element<HTMLInputElement>('homelab-addon-new-tab').checked,
            links: parsedLinks.links,
        }),
    }
}

function fillForm(config: HomelabConfig): void {
    element<HTMLInputElement>('homelab-addon-enabled').checked = config.enabled
    element<HTMLInputElement>('homelab-addon-title').value = config.title
    element<HTMLSelectElement>('homelab-addon-position').value = config.position
    element<HTMLInputElement>('homelab-addon-dashboard-url').value = config.dashboardUrl
    element<HTMLInputElement>('homelab-addon-status-url').value = config.statusUrl
    element<HTMLInputElement>('homelab-addon-timeout').value = config.requestTimeoutMs.toString()
    element<HTMLInputElement>('homelab-addon-refresh').value = config.refreshIntervalSeconds.toString()
    element<HTMLInputElement>('homelab-addon-stale').value = config.staleAfterMinutes.toString()
    element<HTMLInputElement>('homelab-addon-new-tab').checked = config.openInNewTab
    element<HTMLTextAreaElement>('homelab-addon-links').value = serializeHomelabLinks(config)
    toggleOptions(config.enabled)
}

async function exportConfig(): Promise<void> {
    const config = await readHomelabConfig()
    const blob = new Blob([JSON.stringify(config, null, 4)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const download = document.createElement('a')

    download.href = url
    download.download = 'bonjourr-homelab-config.json'
    download.click()
    URL.revokeObjectURL(url)
    setFeedback('Add-on config exported.')
}

async function importConfig(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0]

    try {
        if (!file) {
            return
        }

        if (file.size > MAX_IMPORT_SIZE) {
            throw new Error('Config files must be 64 KiB or smaller.')
        }

        const parsed = JSON.parse(await file.text()) as unknown
        const config = normalizeHomelabConfig(parsed)

        await writeHomelabConfig(config)
        fillForm(config)
        document.dispatchEvent(new CustomEvent(HOMELAB_CONFIG_CHANGED_EVENT, { detail: config }))
        setFeedback('Add-on config imported.')
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The selected config is invalid.'
        setFeedback(message, true)
    } finally {
        input.value = ''
    }
}

function toggleOptions(enabled: boolean): void {
    element('homelab-addon-options').classList.toggle('hidden', !enabled)
    element<HTMLButtonElement>('homelab-addon-refresh-now').disabled = !enabled
}

function setFeedback(message: string, isError = false): void {
    const feedback = element('homelab-addon-feedback')
    feedback.textContent = message
    feedback.classList.toggle('error', isError)
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
    return document.getElementById(id) as T
}
