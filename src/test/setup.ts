import '@testing-library/jest-dom'
import { afterEach, vi } from 'vitest'
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

// Cleanup after each test
afterEach(() => {
  if (typeof document !== 'undefined') cleanup()
})

// Vite/server integration tests use Node; keep browser mocks in DOM environments.
if (typeof window !== 'undefined') {
installWindowStorageGlobal('localStorage')
installWindowStorageGlobal('sessionStorage')

// Mock WebSocket
globalThis.WebSocket = vi.fn() as unknown as typeof WebSocket

// Mock Canvas API for chart rendering
HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
  fillStyle: '',
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  strokeRect: vi.fn(),
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
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
}) as unknown as CanvasRenderingContext2D) as unknown as HTMLCanvasElement['getContext']

// Mock Canvas toBlob and toDataURL
HTMLCanvasElement.prototype.toBlob = vi.fn(function (
  this: HTMLCanvasElement,
  callback: BlobCallback,
  type?: string | null
) {
  const mimeType = type || 'image/png'
  const blob = new Blob([`fake image data ${this.width}x${this.height} ${mimeType}`], { type: mimeType })
  callback(blob)
}) as unknown as HTMLCanvasElement['toBlob']

HTMLCanvasElement.prototype.toDataURL = vi.fn(function (this: HTMLCanvasElement, type?: string) {
  const mimeType = type || 'image/png'
  const payloadLength = Math.max(120, Math.ceil((this.width * this.height) / 1000))
  return `data:${mimeType};base64,${'a'.repeat(payloadLength)}`
}) as unknown as HTMLCanvasElement['toDataURL']

// Mock Audio API for alerts
globalThis.Audio = vi.fn(() => ({
  play: vi.fn(() => Promise.resolve()),
  pause: vi.fn(),
  load: vi.fn(),
}) as unknown as HTMLAudioElement) as unknown as typeof Audio

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
}
