import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExposureHeatmap } from '../ExposureHeatmap'

const { mockSubscribe } = vi.hoisted(() => ({
  mockSubscribe: vi.fn(() => vi.fn()),
}))

vi.mock('../../hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    subscribe: mockSubscribe,
  }),
}))

// Mock canvas context
const mockCanvasContext = {
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  strokeRect: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn(() => ({ width: 50 })),
  save: vi.fn(),
  restore: vi.fn(),
  scale: vi.fn(),
  translate: vi.fn(),
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  font: '',
  textAlign: 'left' as CanvasTextAlign,
  textBaseline: 'alphabetic' as CanvasTextBaseline,
}

describe('ExposureHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockReturnValue(vi.fn())
    HTMLCanvasElement.prototype.getContext = vi.fn(() => mockCanvasContext as unknown as CanvasRenderingContext2D) as HTMLCanvasElement['getContext']
    global.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16))
    global.cancelAnimationFrame = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should render the heatmap', () => {
    render(<ExposureHeatmap />)
    expect(screen.getByText('Exposure Heatmap')).toBeInTheDocument()
  })

  it('should render interval controls', () => {
    render(<ExposureHeatmap />)
    expect(screen.getByText('15m')).toBeInTheDocument()
    expect(screen.getByText('1h')).toBeInTheDocument()
    expect(screen.getByText('4h')).toBeInTheDocument()
    expect(screen.getByText('1d')).toBeInTheDocument()
  })

  it('should render canvas for heatmap', () => {
    const { container } = render(<ExposureHeatmap />)
    const canvas = container.querySelector('canvas')
    expect(canvas).toBeInTheDocument()
  })

  it('should display legend', () => {
    render(<ExposureHeatmap />)
    expect(screen.getByText(/Short \(-100%\)/)).toBeInTheDocument()
    expect(screen.getByText(/Neutral \(0%\)/)).toBeInTheDocument()
    expect(screen.getByText(/Long \(\+100%\)/)).toBeInTheDocument()
  })

  it('should fetch exposure data on mount', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        cells: [],
        symbols: [],
        timeRange: { start: Date.now(), end: Date.now() },
      }),
    } as Response)

    render(<ExposureHeatmap />)

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/analytics/exposure/heatmap')
      )
    })
  })

  it('should change interval on button click', async () => {
    const user = userEvent.setup()
    render(<ExposureHeatmap />)

    const fourHourButton = screen.getByText('4h')
    await user.click(fourHourButton)

    expect(fourHourButton).toHaveClass('bg-blue-600')
  })

  it('should reset view on button click', async () => {
    const user = userEvent.setup()
    render(<ExposureHeatmap />)

    const resetButton = screen.getByText('Reset View')
    await user.click(resetButton)

    expect(mockCanvasContext.clearRect).toHaveBeenCalled()
  })

  it('should draw on canvas', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        cells: [
          { symbol: 'EURUSD', time: Date.now(), exposure: 50, volume: 10, netPnL: 100 },
        ],
        symbols: ['EURUSD'],
        timeRange: { start: Date.now(), end: Date.now() },
      }),
    } as Response)

    render(<ExposureHeatmap />)

    await waitFor(() => {
      expect(mockCanvasContext.clearRect).toHaveBeenCalled()
      expect(mockCanvasContext.fillRect).toHaveBeenCalled()
    })
  })

  it('should handle API errors gracefully', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('API Error'))

    render(<ExposureHeatmap />)

    await waitFor(() => {
      expect(screen.getByText('Exposure Heatmap')).toBeInTheDocument()
    })

    consoleError.mockRestore()
  })

  it('should subscribe to WebSocket updates', () => {
    render(<ExposureHeatmap />)

    expect(mockSubscribe).toHaveBeenCalledWith(
      'exposure-updates',
      expect.any(Function)
    )
  })
})
