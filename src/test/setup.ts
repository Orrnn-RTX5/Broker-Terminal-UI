import '@testing-library/jest-dom'
import { expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

const hasUsableStorage = (value: unknown): value is Storage => Boolean(
  value &&
  typeof (value as Storage).getItem === 'function' &&
  typeof (value as Storage).setItem === 'function' &&
  typeof (value as Storage).removeItem === 'function' &&
  typeof (value as Storage).clear === 'function'
)

const createMemoryStorage = (): Storage => {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(String(key)) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(String(key))
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(String(key), String(value))
    }),
  } as Storage
}

const installWindowStorageGlobal = (key: 'localStorage' | 'sessionStorage') => {
  try {
    const storage = hasUsableStorage(window[key]) ? window[key] : createMemoryStorage()
    const current = (globalThis as Record<string, unknown>)[key]

    if (!hasUsableStorage(window[key])) {
      Object.defineProperty(window, key, {
        value: storage,
        configurable: true,
      })
    }

    if (!hasUsableStorage(current)) {
      Object.defineProperty(globalThis, key, {
        value: storage,
        configurable: true,
      })
      vi.stubGlobal(key, storage)
    }
  } catch {
    // Ignore unavailable browser storage in non-browser test environments.
  }
}

installWindowStorageGlobal('localStorage')
installWindowStorageGlobal('sessionStorage')

// Cleanup after each test
afterEach(() => {
  cleanup()
})

// Mock WebSocket
global.WebSocket = vi.fn() as any

// Mock Canvas API for chart rendering
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillStyle: '',
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  stroke: vi.fn(),
  translate: vi.fn(),
  scale: vi.fn(),
  rotate: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
})) as any

// Mock Canvas toBlob and toDataURL
HTMLCanvasElement.prototype.toBlob = vi.fn((callback) => {
  const blob = new Blob(['fake image data'], { type: 'image/png' })
  callback(blob)
}) as any

HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,fake') as any

// Mock Audio API for alerts
global.Audio = vi.fn(() => ({
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  load: vi.fn(),
})) as any

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})
