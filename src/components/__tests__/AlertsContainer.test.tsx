import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AlertsContainer } from '../AlertsContainer'

class MockWebSocket extends EventTarget {
  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }))
  }
}

describe('AlertsContainer', () => {
  let ws: MockWebSocket
  let playSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    ws = new MockWebSocket()
    playSpy = vi.fn(() => Promise.resolve())
    vi.stubGlobal('Audio', vi.fn(function (this: HTMLAudioElement) {
      this.currentTime = 0
      this.volume = 0
      this.play = playSpy
      this.pause = vi.fn()
      this.load = vi.fn()
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing until a websocket alert arrives', () => {
    render(<AlertsContainer wsConnection={ws as unknown as WebSocket} />)

    expect(screen.queryByText('High exposure detected')).not.toBeInTheDocument()
  })

  it('renders incoming websocket alerts and plays the alert sound', async () => {
    render(<AlertsContainer wsConnection={ws as unknown as WebSocket} />)

    act(() => {
      ws.emit({
        type: 'alert',
        id: 'alert-1',
        severity: 'CRITICAL',
        message: 'High exposure detected',
        timestamp: 1767225600000,
      })
    })

    expect(await screen.findByText('High exposure detected')).toBeInTheDocument()
    expect(screen.getByText('CRITICAL')).toBeInTheDocument()
    await waitFor(() => expect(playSpy).toHaveBeenCalledTimes(1))
  })

  it('dismisses an alert from the stack', async () => {
    const user = userEvent.setup()
    render(<AlertsContainer wsConnection={ws as unknown as WebSocket} />)

    act(() => {
      ws.emit({
        type: 'alert',
        id: 'alert-2',
        severity: 'HIGH',
        message: 'Margin threshold reached',
        timestamp: 1767225600000,
      })
    })

    expect(await screen.findByText('Margin threshold reached')).toBeInTheDocument()
    await user.click(screen.getByTitle('Dismiss'))

    await waitFor(() => {
      expect(screen.queryByText('Margin threshold reached')).not.toBeInTheDocument()
    })
  })

  it('removes the websocket message listener on unmount', () => {
    const removeSpy = vi.spyOn(ws, 'removeEventListener')
    const { unmount } = render(<AlertsContainer wsConnection={ws as unknown as WebSocket} />)

    unmount()

    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function))
  })
})
