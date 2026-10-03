import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const launcher = resolve('bin/claudex');

async function launch(t, models, savedModel, status = 200) {
  const home = await mkdtemp(join(tmpdir(), 'claudex-launcher-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'bin'));
  await writeFile(join(home, 'bin', 'claude'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  if (savedModel) {
    await mkdir(join(home, '.claude'));
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ model: savedModel }));
  }
  const server = createServer((req, res) => {
    if (req.url === '/healthz') return res.end('ok');
    assert.equal(req.url, '/v1/models?limit=1000');
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: models }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { stdout } = await exec('/bin/sh', [launcher], {
    env: { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`,
      CLAUDEX_BASE_URL: `http://127.0.0.1:${server.address().port}` },
  });
  const args = stdout.trim().split('\n');
  return JSON.parse(args[args.indexOf('--settings') + 1]);
}

const model = (id, isDefault = false) => ({ id: `claude-${id}`, is_default: isDefault });

test('new catalog models appear and the service chooses the default', { concurrency: true }, async t => {
  const settings = await launch(t, [model('gpt-z-old'), model('gpt-next_future', true), model('gpt-next_future-fast')]);
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-next_future');
  assert.deepEqual(settings.modelPicker.options.map(option => option.model), ['claude-gpt-next_future', 'claude-gpt-z-old']);
  assert.ok(settings.modelPicker.options.every(option => option.behavesAs === 'claude-fable-5-1'));
});

test('a saved available model stays selected', { concurrency: true }, async t => {
  const settings = await launch(t, [model('gpt-next', true), model('gpt-saved')], 'claude-gpt-saved');
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-saved');
});

test('a removed saved model falls back to the catalog default', { concurrency: true }, async t => {
  const settings = await launch(t, [model('gpt-new', true)], 'claude-gpt-removed');
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-new');
});

test('discovery failure stops launch instead of inventing models', { concurrency: true }, async t => {
  await assert.rejects(launch(t, [], undefined, 502), error => error.code !== 0);
});

test('a missing default produces an explicit error', { concurrency: true }, async t => {
  await assert.rejects(launch(t, [model('gpt-new')]), error =>
    error.stderr.includes('did not advertise a default Codex GPT model'));
});

test('nested capability metadata preserves the default and model choices', { concurrency: true }, async t => {
  const discovered = {
    ...model('gpt-next', true),
    display_name: 'GPT Next',
    default_reasoning_effort: 'ultra',
    supported_reasoning_efforts: [
      { effort: 'low', description: 'Fast' },
      { effort: 'ultra', description: 'Deep' },
    ],
    context_window: 400000,
    input_modalities: ['text', 'image'],
    service_tiers: [{ id: 'priority', name: 'Fast' }],
    upgrade: { id: 'gpt-future' },
  };
  const settings = await launch(t, [discovered, model('gpt-other')]);
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-next');
  assert.deepEqual(settings.modelPicker.options.map(option => option.model), ['claude-gpt-next', 'claude-gpt-other']);
});
