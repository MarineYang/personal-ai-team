import assert from 'node:assert/strict';


// This script never starts inference. Run against an already running local server:
// npm run smoke -- http://127.0.0.1:18940
const base = new URL(process.argv[2] || process.env.TEAM_URL || 'http://127.0.0.1:18940');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Smoke checks are restricted to a loopback server');
let checks = 0;
async function check(name, fn) {
  await fn();
  checks += 1;
  console.log(`✓ ${name}`);
}
const get = path => fetch(new URL(path, base), { signal: AbortSignal.timeout(6000) });
let state;
try {
  await check('State API returns all configured roles without starting work', async () => {
    const response = await get('/api/state');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /application\/json/i);
    state = await response.json();
    assert.ok(Array.isArray(state.agents));
    assert.equal(state.agents[0].id, 'director');
    assert.equal(state.agents.length, 1 + state.teamSpecs.length);
    assert.equal(state.roleVersion, 4);
    for (const a of state.agents) {
      assert.equal(typeof a.name, 'string');
      assert.equal(typeof a.role, 'string');
      assert.ok(['idle', 'running', 'queued', 'paused', 'error', 'waiting_approval'].includes(a.status));
      assert.ok(Array.isArray(a.messages));
    }
    assert.ok(['connecting', 'ready', 'error'].includes(state.connection?.status));
    for (const key of ['events', 'artifacts', 'approvals']) assert.ok(Array.isArray(state[key]), `${key} must be an array`);
  });
  await check('HTML and bundled JavaScript/CSS are served', async () => {
    for (const [path, pattern] of [['/', /id="mission-form"/], ['/app.js', /EventSource/], ['/style.css', /\.agent-grid/]]) {
      const response = await get(path);
      assert.equal(response.status, 200, path);
      assert.match(await response.text(), pattern, path);
    }
  });
  await check('Cross-origin mutation is rejected without starting inference', async () => {
    // Selecting the current model is harmless even if the origin guard regresses.
    // Never use a start/message endpoint for a security smoke test.
    const response = await fetch(new URL('/api/model', base), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
      body: JSON.stringify({ model: state.model }),
      signal: AbortSignal.timeout(6000),
    });
    assert.equal(response.status, 403, 'Server must reject untrusted Origin with 403');
  });
  await check('SSE endpoint provides a live state event', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    let reader;
    try {
      const response = await fetch(new URL('/api/events', base), { signal: controller.signal });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/event-stream/i);
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      while (!/event:\s*state\r?\ndata:/.test(text)) {
        const { done, value } = await reader.read();
        assert.equal(done, false, 'SSE closed before initial state');
        text += decoder.decode(value, { stream: true });
        assert.ok(text.length < 5_000_000, 'SSE initial event exceeded reasonable size');
      }
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });
  if (state.artifacts.length) {
    await check('Existing artifact can be read', async () => {
      const response = await get(`/api/artifacts/${encodeURIComponent(state.artifacts[0].id)}`);
      assert.equal(response.status, 200);
      const artifact = await response.json();
      assert.equal(typeof artifact.content, 'string');
      assert.equal(typeof artifact.title, 'string');
    });
  }
  console.log(`\n${checks} checks passed. No model tasks were submitted.`);
} catch (error) {
  console.error(`\nSmoke check failed: ${error.message}`);
  process.exitCode = 1;
}
