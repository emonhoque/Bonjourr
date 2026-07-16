import { normalizeHomelabCache, normalizeHomelabConfig } from './data.ts'

import type { HomelabConfig, HomelabStatusCache } from './types.ts'

const CONFIG_STORAGE_KEY = 'bonjourrHomelabAddon'
const CACHE_STORAGE_KEY = 'bonjourrHomelabAddonCache'

interface ExtensionStorageArea {
    get: (key: string) => Promise<Record<string, unknown>>
    set: (value: Record<string, unknown>) => Promise<void>
}

export async function readHomelabConfig(): Promise<HomelabConfig> {
    try {
        return normalizeHomelabConfig(await readValue(CONFIG_STORAGE_KEY))
    } catch (_) {
        return normalizeHomelabConfig(undefined)
    }
}

export async function writeHomelabConfig(config: HomelabConfig): Promise<void> {
    await writeValue(CONFIG_STORAGE_KEY, normalizeHomelabConfig(config))
}

export async function readHomelabCache(): Promise<HomelabStatusCache | undefined> {
    try {
        return normalizeHomelabCache(await readValue(CACHE_STORAGE_KEY))
    } catch (_) {
        return undefined
    }
}

export async function writeHomelabCache(cache: HomelabStatusCache): Promise<void> {
    await writeValue(CACHE_STORAGE_KEY, cache)
}

async function readValue(key: string): Promise<unknown> {
    const extensionStorage = getExtensionStorage()

    if (extensionStorage) {
        const result = await extensionStorage.get(key)
        return result[key]
    }

    const value = globalThis.localStorage?.getItem(key)

    return value ? JSON.parse(value) : undefined
}

async function writeValue(key: string, value: unknown): Promise<void> {
    const extensionStorage = getExtensionStorage()

    if (extensionStorage) {
        await extensionStorage.set({ [key]: value })
        return
    }

    globalThis.localStorage?.setItem(key, JSON.stringify(value))
}

function getExtensionStorage(): ExtensionStorageArea | undefined {
    const runtime = globalThis as typeof globalThis & {
        chrome?: { storage?: { local?: ExtensionStorageArea } }
    }

    return runtime.chrome?.storage?.local
}
