import assert from 'node:assert/strict';
import { brokerDisplayName, isBrokerName } from '../src/services/brokerDisplayName.ts';

// Test 1: Achiever Financials URL resolves to Achiever Financials
assert.equal(brokerDisplayName('https://service.achieverfinancials.com'), 'Achiever Financials');
assert.equal(brokerDisplayName('https://service.achieverfinancials.com/'), 'Achiever Financials');
assert.equal(brokerDisplayName('https://service.achieverfinancials.com', 'Broker'), 'Achiever Financials');

// Test 2: achiever-financials broker id resolves to Achiever Financials
assert.equal(brokerDisplayName('achiever-financials'), 'Achiever Financials');

// Test 3: Other known brokers
assert.equal(brokerDisplayName('https://services.growtradingacademy.com'), 'Grow Trading Academy');
assert.equal(brokerDisplayName('grow-trading-academy'), 'Grow Trading Academy');
assert.equal(brokerDisplayName('https://fxtrustbrokerbackend.orrnn.com'), 'FX Trust');

// Test 4: Named servers are preserved
assert.equal(brokerDisplayName('MetaQuotes-Demo'), 'MetaQuotes-Demo');
assert.equal(brokerDisplayName('Named Broker'), 'Named Broker');

// Test 5: Supplied names override
assert.equal(brokerDisplayName('https://random.example', 'Custom Broker LLC'), 'Custom Broker LLC');

// Test 6: isBrokerName validation
assert.equal(isBrokerName('Broker'), false);
assert.equal(isBrokerName('broker'), false);
assert.equal(isBrokerName('RTX 5 Web Terminal'), false);
assert.equal(isBrokerName('RTX Terminal'), false);
assert.equal(isBrokerName('https://service.achieverfinancials.com'), false);
assert.equal(isBrokerName('Achiever Financials'), true);

// Test 7: Non-desktop fallback for unknown URL
assert.equal(brokerDisplayName('https://unknown-broker.example'), 'Broker');

// Test 8: In Desktop environment (simulated window.electron)
globalThis.window = { electron: { window: {} } };
assert.equal(brokerDisplayName('https://unknown-broker.example'), 'Achiever Financials');
assert.equal(brokerDisplayName(''), 'Achiever Financials');
assert.equal(brokerDisplayName('Broker'), 'Achiever Financials');
assert.equal(brokerDisplayName('RTX 5 Web Terminal'), 'Achiever Financials');
assert.equal(brokerDisplayName('https://service.achieverfinancials.com'), 'Achiever Financials');

console.log('ALL BROKER DISPLAY NAME TESTS PASSED!');
