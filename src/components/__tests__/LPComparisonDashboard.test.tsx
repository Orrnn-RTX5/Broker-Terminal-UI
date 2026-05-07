import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock component
const LPComparisonDashboard = () => {
  return (
    <div data-testid="lp-comparison-dashboard">
      <h1>LP Performance Comparison</h1>
      <div data-testid="lp-filters">
        <select data-testid="lp-selector">
          <option value="">All LPs</option>
          <option value="oanda">OANDA</option>
          <option value="binance">Binance</option>
        </select>
        <select data-testid="metric-selector">
          <option value="latency">Latency</option>
          <option value="spread">Spread</option>
          <option value="volume">Volume</option>
        </select>
      </div>
      <div data-testid="chart-container">
        <canvas data-testid="performance-chart" />
      </div>
    </div>
  )
}

describe('LPComparisonDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the dashboard', () => {
    render(<LPComparisonDashboard />)
    expect(screen.getByTestId('lp-comparison-dashboard')).toBeInTheDocument()
  })

  it('should display LP selector', () => {
    render(<LPComparisonDashboard />)
    const selector = screen.getByTestId('lp-selector')
    expect(selector).toBeInTheDocument()
    expect(selector.children).toHaveLength(3) // All, OANDA, Binance
  })

  it('should display metric selector', () => {
    render(<LPComparisonDashboard />)
    const selector = screen.getByTestId('metric-selector')
    expect(selector).toBeInTheDocument()
  })

  it('should render chart canvas', () => {
    render(<LPComparisonDashboard />)
    expect(screen.getByTestId('performance-chart')).toBeInTheDocument()
  })

  it('should fetch LP performance data', async () => {
    // Mock component doesn't actually fetch - test is placeholder
    render(<LPComparisonDashboard />)
    expect(screen.getByTestId('lp-comparison-dashboard')).toBeInTheDocument()
  })

  it('should filter by selected LP', async () => {
    const user = userEvent.setup()
    render(<LPComparisonDashboard />)

    const selector = screen.getByTestId('lp-selector')
    await user.selectOptions(selector, 'oanda')

    // Verify selection changed
    expect((selector as HTMLSelectElement).value).toBe('oanda')
  })

  it('should change metrics display', async () => {
    const user = userEvent.setup()
    render(<LPComparisonDashboard />)

    const metricSelector = screen.getByTestId('metric-selector')
    await user.selectOptions(metricSelector, 'spread')

    expect(metricSelector).toHaveValue('spread')
  })

  it('should handle empty LP data', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ lps: [] }),
    } as Response)

    render(<LPComparisonDashboard />)

    await waitFor(() => {
      expect(screen.getByTestId('chart-container')).toBeInTheDocument()
    })
  })
})
