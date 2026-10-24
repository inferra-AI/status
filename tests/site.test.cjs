const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(__dirname + '/../site/index.html', 'utf8');
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const start = Date.parse('2026-10-23T12:00:00Z');
const status = () => ({ updated: new Date(start).toISOString(), components: {
  api: { name: 'API', status: 'up', since: '2025-01-01', raw: [], days: { '2026-10-23': [10, 10] } },
} });
const issue = (n, state = 'closed') => ({ title: `Incident ${n}`, state,
  html_url: `https://github.com/inferra-AI/status/issues/${n}`, created_at: '2026-10-01T00:00:00Z',
  closed_at: state === 'closed' ? '2026-10-02T00:00:00Z' : null });
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => body });
async function page(incidents = () => response([]), data = () => response(status())) {
  let now = start;
  const timers = [], warnings = [];
  const dot = { className: 'dot' }, label = { textContent: '' };
  const elements = Object.fromEntries(['updated', 'components', 'incidents'].map(id => [id, { innerHTML: '', textContent: '' }]));
  elements.overall = { querySelector: () => dot, lastElementChild: label };
  const context = {
    Date: class extends Date { static now() { return now; } },
    document: { getElementById: id => elements[id], querySelector: selector => selector.startsWith('meta') ? { content: '300' } : label },
    fetch: async (url, options) => url === '/data.json' ? data(options) : incidents(new URL(url)),
    setInterval: (fn, ms) => timers.push({ fn, ms }), console: { warn: message => warnings.push(message) },
  };
  vm.runInNewContext(source, context);
  const settle = async () => { for (let i = 0; i < 500; i++) await Promise.resolve(); };
  await settle();
  return { elements, dot, label, warnings, async advance(ms) { now += ms; for (const timer of timers) timer.fn(); await settle(); } };
}
test('an open tab recomputes freshness when the checker stops', async () => {
  const p = await page();
  assert.equal(p.dot.className, 'dot up');
  await p.advance(21 * 60000);
  assert.match(p.label.textContent, /Checks delayed/);
  assert.equal(p.dot.className, 'dot ');
  assert.doesNotMatch(p.elements.components.innerHTML, /dot up/);
});
test('an open tab fetches changed service status', async () => {
  let value = status();
  const p = await page(undefined, () => response(value));
  value = status(); value.components.api.status = 'down';
  await p.advance(300000);
  assert.match(p.label.textContent, /not responding/);
});
test('rolling uptime names its calculation window instead of lifetime start', async () => {
  const p = await page();
  assert.match(p.elements.components.innerHTML, /100.00% of checks passed in the last 90 days/);
  assert.doesNotMatch(p.elements.components.innerHTML, /passed since/);
});
for (const [name, result] of [
  ['rate limit', () => response({ message: 'rate limited' }, false)],
  ['HTTP error with array body', () => response([], false)],
  ['invalid object', () => response({})],
  ['invalid incident', () => response([{}])],
  ['unsafe URL', () => response([{ ...issue(1), html_url: 'javascript:alert(1)' }])],
  ['network error', () => { throw Error('offline'); }],
  ['invalid JSON', () => ({ ok: true, json: async () => { throw SyntaxError(); } })],
]) test(`incident availability is unknown on ${name}`, async () => {
  const p = await page(result);
  assert.match(p.elements.incidents.innerHTML, /Incident availability unknown/);
  assert.doesNotMatch(p.elements.incidents.innerHTML, /No incidents reported/);
});
test('older ongoing incidents and later resolved history pages remain visible', async () => {
  const p = await page(url => {
    const state = url.searchParams.get('state');
    const page = Number(url.searchParams.get('page') || 1);
    if (state === 'open') return response(page === 1 ? [issue(1, 'open')] : []);
    if (state === 'closed') return response(page === 1 ? Array.from({length: 20}, (_, n) => issue(n + 2)) : page === 2 ? [issue(22)] : []);
    return response(Array.from({length: 20}, (_, n) => issue(n + 2)));
  });
  assert.match(p.elements.incidents.innerHTML, /Incident 1<\/a>/);
  assert.match(p.elements.incidents.innerHTML, /Ongoing/);
  assert.match(p.elements.incidents.innerHTML, /Incident 22<\/a>/);
});
test('successful empty incident lists report no incidents', async () => {
  const p = await page();
  assert.match(p.elements.incidents.innerHTML, /No incidents reported/);
});

test('a pending refresh cannot keep stale results green or start overlapping requests', async () => {
  let calls = 0;
  const p = await page(undefined, () => ++calls === 1 ? response(status()) : new Promise(() => {}));
  await p.advance(300000);
  await p.advance(21 * 60000);
  assert.match(p.label.textContent, /Checks delayed/);
  assert.equal(p.dot.className, 'dot ');
  assert.equal(calls, 2);
});
test('status fetch failures clear green and recover on the next refresh', async () => {
  let fail = false;
  const p = await page(undefined, () => fail ? response({}, false) : response(status()));
  fail = true;
  await p.advance(300000);
  assert.equal(p.label.textContent, 'Status data unavailable');
  assert.equal(p.dot.className, 'dot');
  assert.equal(p.elements.components.innerHTML, '');
  assert.match(p.warnings[0], /Status refresh failed/);
  fail = false;
  await p.advance(300000);
  assert.equal(p.dot.className, 'dot up');
});
test('incident loading works independently of unavailable status data', async () => {
  const p = await page(url => response(url.searchParams.get('state') === 'open' ? [issue(1, 'open')] : []),
    () => { throw Error('offline'); });
  assert.equal(p.label.textContent, 'Status data unavailable');
  assert.match(p.elements.incidents.innerHTML, /Ongoing/);
});
test('a later history page error preserves ongoing incidents and marks availability unknown', async () => {
  const p = await page(url => {
    if (url.searchParams.get('state') === 'open') return response([issue(1, 'open')]);
    return url.searchParams.get('page') === '1'
      ? response(Array.from({ length: 20 }, (_, n) => issue(n + 2))) : response({}, false);
  });
  assert.match(p.elements.incidents.innerHTML, /Incident 1<\/a>/);
  assert.match(p.elements.incidents.innerHTML, /Ongoing/);
  assert.match(p.elements.incidents.innerHTML, /Incident availability unknown/);
  assert.match(p.warnings[0], /Incident loading failed/);
});
test('open incidents are paginated and their titles are escaped', async () => {
  const p = await page(url => {
    if (url.searchParams.get('state') === 'closed') return response([]);
    return response(url.searchParams.get('page') === '1'
      ? Array.from({ length: 20 }, (_, n) => issue(n + 1, 'open'))
      : [{ ...issue(21, 'open'), title: '<img src=x onerror=alert(1)>' }]);
  });
  assert.match(p.elements.incidents.innerHTML, /issues\/21/);
  assert.match(p.elements.incidents.innerHTML, /&lt;img/);
  assert.doesNotMatch(p.elements.incidents.innerHTML, /<img/);
});
