// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchBugReportOptions, submitBugReport, validateAttachment } from './bugReportService';

vi.mock('../config/api', () => ({ API_V2_BASE_URL: '/api/v2' }));
vi.mock('../api/client', () => ({ getAuthToken: () => 'test-auth', getDynamicUrl: (url: string) => url }));
vi.mock('../api/brokerRequestGuard', () => ({ assertBrokerRequestAllowed: () => undefined }));

const form = {
  title: 'Trade row selection', description: 'The selected row stays highlighted.',
  category: 'ui_ux', severity: 'low', steps: '1. Select a row\n2) Click the chart',
  expected: 'Selection clears', actual: 'Selection remains',
};
const fetchMock = vi.fn();

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe('bug report transport', () => {
  it('sends the multipart report, reproduction steps, attachment and chart context to the gateway', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ report_id: 'report-test-1', status: 'submitted' })));
    const file = new File(['diagnostic text'], 'terminal.txt', { type: 'text/plain' });
    const receipt = await submitBugReport({ form, attachments: [file], context: { symbol: 'EURJPY', timeframe: 'M1', connectionState: 'connected', quoteAgeMs: 250 } });
    expect(receipt.report_id).toBe('report-test-1');
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v2/bug-reports');
    expect(request.method).toBe('POST');
    expect(request.headers.Authorization).toBe('Bearer test-auth');
    expect(request.headers).not.toHaveProperty('Content-Type');
    const payload = JSON.parse(request.body.get('payload'));
    expect(payload).toMatchObject({ title: form.title, description: form.description, category: 'ui_ux', severity: 'low', steps_to_reproduce: ['Select a row', 'Click the chart'], expected_behavior: form.expected, actual_behavior: form.actual, symbol: 'EURJPY', timeframe: 'M1', connection_state: 'connected', quote_age_ms: 250 });
    expect(JSON.stringify(payload)).not.toContain('test-auth');
    expect(request.body.getAll('attachments')).toHaveLength(1);
    expect(request.body.get('attachments').name).toBe('terminal.txt');
  });

  it.each(['{}', 'null', '<html>Unexpected gateway page</html>', '{"report_id":" "}'])('rejects an unconfirmed success response: %s', async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    await expect(submitBugReport({ form })).rejects.toThrow('The server did not confirm the report');
  });

  it.each([
    [503, 'Bug reporting is not enabled'],
    [502, 'The support service could not be reached'],
    [401, 'Please sign in again'],
  ])('preserves a useful server error for HTTP %s', async (status, message) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message }), { status }));
    await expect(submitBugReport({ form })).rejects.toThrow(message);
  });

  it('preserves partial attachment failure information in the confirmed receipt', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ report_id: 'report-test-2', status: 'submitted', failed_attachments: [0] })));
    await expect(submitBugReport({ form })).resolves.toMatchObject({ failed_attachments: [0] });
  });

  it('checks whether the broker has enabled bug reporting', async () => {
    fetchMock.mockResolvedValue(new Response('{"enabled":false}'));
    await expect(fetchBugReportOptions()).resolves.toEqual({ enabled: false });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v2/bug-reports/options');
  });

  it('rejects unsupported and oversized attachments', () => {
    expect(validateAttachment(new File(['text'], 'notes.txt', { type: 'text/plain' }))).toBeNull();
    expect(validateAttachment(new File(['video'], 'video.mp4', { type: 'video/mp4' }))).toContain('not an accepted type');
    expect(validateAttachment(new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }))).toContain('larger than 8 MB');
  });
});
