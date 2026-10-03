import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const executable = process.env.CLAUDEX_ACP_BINARY ?? resolve('claudex-acp');
const exec = promisify(execFile);

async function catalogServer(t, data, status = 200) {
  const server = createServer((req, res) => {
    assert.equal(req.url, '/v1/models?limit=1000');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { data } : { error: 'Catalog unavailable' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const home = await mkdtemp(join(tmpdir(), 'claudex-acp-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return { ...process.env, HOME: home, CLAUDEX_BASE_URL: `http://127.0.0.1:${server.address().port}` };
}

test('ACP discovers models and their actual effort choices without custom configuration', { concurrency: true }, async t => {
  const env = await catalogServer(t, [
    { id: 'claude-gpt-future', visibility: 'list', display_name: 'GPT Future', default_reasoning_effort: 'high',
      supported_reasoning_efforts: [{ effort: 'low', description: 'Fast' }, { effort: 'high', description: 'Deep' }, { effort: 'future', description: 'New effort' }] },
    { id: 'claude-gpt-no-effort', visibility: 'list' },
    { id: 'gpt-future', visibility: 'list' },
    { id: 'claude-gpt-hidden', visibility: 'hide' },
    { id: 'claude-gpt-future-fast', visibility: 'list' },
  ]);
  const child = spawn(executable, ['--force', 'acp'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.resume();
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout });
  let id = 0;
  function request(method, params) {
    const requestId = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`ACP ${method} timed out`)), 10000);
      const onLine = line => {
        const message = JSON.parse(line);
        if (message.id !== requestId) return;
        clearTimeout(timer);
        lines.off('line', onLine);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      };
      lines.on('line', onLine);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  const initialization = await request('initialize', { protocolVersion: 1, clientCapabilities: {} });
  assert.equal(initialization.agentInfo.name, 'claudex');
  await request('authenticate', { methodId: initialization.authMethods[0].id });
  const { models } = await request('cursor/list_available_models', {});
  assert.deepEqual(models.map(model => model.value), ['claude-gpt-future', 'claude-gpt-no-effort']);
  assert.equal(models[0].name, 'GPT Future');
  assert.equal(models[0].configOptions[0].currentValue, 'high');
  assert.deepEqual(models[0].configOptions[0].options, [
    { value: 'low', name: 'Low', description: 'Fast' },
    { value: 'high', name: 'High', description: 'Deep' },
    { value: 'future', name: 'Future', description: 'New effort' },
  ]);
  assert.deepEqual(models[1].configOptions, []);
  const { stdout } = await exec(executable, ['about', '--format', 'json'], { env });
  assert.equal(JSON.parse(stdout).runtime, 'Claude Code');
});

test('ACP reports catalog failures instead of returning fallback models', { concurrency: true }, async t => {
  const env = await catalogServer(t, [], 503);
  await assert.rejects(exec(executable, ['about'], { env }), error =>
    error.code === 1 && /HTTP 503.*Catalog unavailable/.test(error.stderr));
});
