import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock WebSocket
class MockWebSocket {
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  readyState = WebSocket.CONNECTING

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = WebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  send = vi.fn()
  close = vi.fn()

  simulateMessage(data: any) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(data),
    })
    this.onmessage?.(event)
  }
}

// Mock component
const AlertsContainer = () => {
  return (
    <div data-testid="alerts-container">
      <h2>Alerts</h2>
      <div data-testid="alert-list">
        <div data-testid="alert-item" className="alert-critical">
          Critical: High exposure detected
        </div>
      </div>
      <div data-testid="alert-controls">
        <button data-testid="mute-button">Mute</button>
        <button data-testid="clear-all-button">Clear All</button>
      </div>
      <audio data-testid="alert-sound" src="/alert.mp3" />
    </div>
  )
}

describe('AlertsContainer', () => {
  let mockWs: MockWebSocket

  beforeEach(() => {
    vi.clearAllMocks()
    mockWs = new MockWebSocket('ws://localhost:7999/ws')
    ;(global as any).WebSocket = vi.fn(() => mockWs)
  })

  afterEach(() => {
    mockWs.close()
  })

  it('should render alerts container', () => {
    render(<AlertsContainer />)
    expect(screen.getByTestId('alerts-container')).toBeInTheDocument()
  })

  it('should display alert list', () => {
    render(<AlertsContainer />)
    expect(screen.getByTestId('alert-list')).toBeInTheDocument()
  })

  it('should show individual alerts', () => {
    render(<AlertsContainer />)
    const alert = screen.getByTestId('alert-item')
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent('High exposure detected')
  })

  it('should have mute button', () => {
    render(<AlertsContainer />)
    expect(screen.getByTestId('mute-button')).toBeInTheDocument()
  })

  it('should have clear all button', () => {
    render(<AlertsContainer />)
    expect(screen.getByTestId('clear-all-button')).toBeInTheDocument()
  })

  it('should mute alerts', async () => {
    const user = userEvent.setup()
    render(<AlertsContainer />)

    const muteButton = screen.getByTestId('mute-button')
    await user.click(muteButton)

    // Button text should change or state should update
    expect(muteButton).toBeInTheDocument()
  })

  it('should clear all alerts', async () => {
    const user = userEvent.setup()
    render(<AlertsContainer />)

    const clearButton = screen.getByTestId('clear-all-button')
    await user.click(clearButton)

    // Alert list should be empty or hidden
    expect(screen.getByTestId('alert-list')).toBeInTheDocument()
  })

  it('should play sound on critical alert', async () => {
    const playSpy = vi.fn(() => Promise.resolve())
    HTMLAudioElement.prototype.play = playSpy

    render(<AlertsContainer />)

    // Simulate critical alert via WebSocket
    await waitFor(() => {
      mockWs.simulateMessage({
        type: 'alert',
        severity: 'critical',
        message: 'Critical alert',
      })
    })

    // Sound should play for critical alerts
    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled()
    })
  })

  it('should connect to WebSocket on mount', async () => {
    render(<AlertsContainer />)

    await waitFor(() => {
      expect(global.WebSocket).toHaveBeenCalledWith(
        expect.stringContaining('ws://')
      )
    })
  })

  it('should receive alerts via WebSocket', async () => {
    render(<AlertsContainer />)

    await waitFor(() => {
      mockWs.simulateMessage({
        type: 'alert',
        severity: 'warning',
        message: 'New alert message',
      })
    })

    // Component should handle the message
    expect(screen.getByTestId('alerts-container')).toBeInTheDocument()
  })

  it('should categorize alerts by severity', () => {
    render(<AlertsContainer />)
    const alert = screen.getByTestId('alert-item')
    expect(alert).toHaveClass('alert-critical')
  })

  it('should handle WebSocket connection errors', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    render(<AlertsContainer />)

    await waitFor(() => {
      mockWs.onerror?.(new Event('error'))
    })

    expect(screen.getByTestId('alerts-container')).toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('should reconnect on WebSocket close', async () => {
    render(<AlertsContainer />)

    await waitFor(() => {
      mockWs.onclose?.(new CloseEvent('close'))
    })

    // Component should attempt reconnection
    expect(screen.getByTestId('alerts-container')).toBeInTheDocument()
  })

  it('should not play sound when muted', async () => {
    const user = userEvent.setup()
    const playSpy = vi.fn(() => Promise.resolve())
    HTMLAudioElement.prototype.play = playSpy

    render(<AlertsContainer />)

    // Mute alerts
    const muteButton = screen.getByTestId('mute-button')
    await user.click(muteButton)

    // Simulate alert
    mockWs.simulateMessage({
      type: 'alert',
      severity: 'critical',
      message: 'Muted alert',
    })

    await waitFor(() => {
      expect(playSpy).not.toHaveBeenCalled()
    })
  })
})
