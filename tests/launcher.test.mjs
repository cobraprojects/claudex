import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const exec = promisify(execFile);
const launcher = resolve('bin/claudex');

async function launch(t, models, savedModel, status = 200, options = {}) {
  const home = await mkdtemp(join(tmpdir(), 'claudex-launcher-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, 'bin'));
  await writeFile(join(home, 'bin', 'claude'), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  const installRoot = join(home, '.local/share/claudex');
  await mkdir(join(installRoot, 'bin'), { recursive: true });
  await mkdir(join(installRoot, 'plugin/scripts'), { recursive: true });
  await copyFile(resolve('plugin/scripts/gpt-auth'), join(installRoot, 'plugin/scripts/gpt-auth'));
  if (!options.signedOut) await writeFile(join(home, '.authenticated'), 'yes');
  await writeFile(join(installRoot, 'bin/claude-code-proxy'), `#!/bin/sh
case "$3" in
  status) test -f "$HOME/.authenticated" ;;
  login)
    echo login >> "$HOME/auth-events"
    if [ "$CLAUDEX_TEST_LOGIN_FAIL" = 1 ]; then echo 'OAuth timeout'; exit 1; fi
    echo 'Open this URL in your browser to authorize:'
    echo '  https://example.test/oauth/authorize'
    until [ -f "$HOME/.authenticated" ]; do sleep 0.05; done
    ;;
  logout) rm -f "$HOME/.authenticated" ;;
esac
`, { mode: 0o755 });
  const browser = join(home, 'bin/browser');
  await writeFile(browser, `#!/bin/sh
printf '%s\\n' "$1" >> "$HOME/browser-urls"
touch "$HOME/.authenticated"
`, { mode: 0o755 });
  if (options.loggedOut) {
    await exec('/bin/sh', [join(installRoot, 'plugin/scripts/gpt-auth'), 'logout'], {
      env: { ...process.env, HOME: home },
    });
  }
  let catalogRequests = 0;
  if (savedModel) {
    await mkdir(join(home, '.claude'));
    await writeFile(join(home, '.claude', 'settings.json'), JSON.stringify({ model: savedModel }));
  }
  const server = createServer(async (req, res) => {
    if (req.url === '/healthz') return res.end('ok');
    assert.equal(req.url, '/v1/models?limit=1000');
    catalogRequests++;
    const authenticated = await readFile(join(home, '.authenticated')).then(() => true, () => false);
    assert.ok(authenticated, 'catalog must not be requested before sign-in');
    if (options.expired && catalogRequests === 1) {
      await rm(join(home, '.authenticated'));
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { type: 'authentication_error', message: 'Sign in again' } }));
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { data: models } : { error: { message: 'Codex catalog is unavailable' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { stdout, stderr } = await exec('/bin/sh', options.hook ? [resolve('plugin/scripts/gpt-auth-hook'), 'login'] : [launcher], {
    timeout: 10000,
    env: { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}`,
      CLAUDEX_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      CLAUDEX_GPT_AUTH: join(installRoot, 'plugin/scripts/gpt-auth'),
      CLAUDEX_BROWSER_OPEN: browser, CLAUDEX_TEST_LOGIN_FAIL: options.loginFails ? '1' : '0' },
  });
  if (options.verify) await options.verify({ home, catalogRequests, stdout, stderr });
  if (options.hook) return JSON.parse(stdout.trim());
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


test('a signed-out user signs in through the browser before model discovery', { concurrency: true }, async t => {
  const settings = await launch(t, [model('gpt-next', true)], undefined, 200, {
    signedOut: true,
    async verify({ home, catalogRequests, stderr }) {
      assert.equal(await readFile(join(home, 'browser-urls'), 'utf8'), 'https://example.test/oauth/authorize\n');
      assert.equal(await readFile(join(home, 'auth-events'), 'utf8'), 'login\n');
      assert.equal(catalogRequests, 1);
      assert.match(stderr, /ChatGPT sign-in succeeded/);
    },
  });
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-next');
});

test('rejected expired credentials trigger sign-in and resume discovery', { concurrency: true }, async t => {
  const settings = await launch(t, [model('gpt-next', true)], undefined, 200, {
    expired: true,
    async verify({ home, catalogRequests }) {
      assert.equal(await readFile(join(home, 'auth-events'), 'utf8'), 'login\n');
      assert.equal(catalogRequests, 2);
    },
  });
  assert.equal(settings.env.ANTHROPIC_MODEL, 'claude-gpt-next');
});

test('failed sign-in stops startup with an actionable error', { concurrency: true }, async t => {
  await assert.rejects(launch(t, [model('gpt-next', true)], undefined, 200, {
    signedOut: true, loginFails: true,
  }), error => error.stderr.includes('ChatGPT sign-in did not complete. Run claudex to try again.')
    && !error.stderr.includes('curl: (22)'));
});

test('catalog failures show the provider error instead of a bare curl error', { concurrency: true }, async t => {
  await assert.rejects(launch(t, [], undefined, 502), error =>
    error.stderr.includes('HTTP 502') && error.stderr.includes('Codex catalog is unavailable')
    && !error.stderr.includes('curl: (22)'));
});

test('valid credentials do not open a login browser', { concurrency: true }, async t => {
  await launch(t, [model('gpt-next', true)], undefined, 200, {
    async verify({ home }) {
      await assert.rejects(readFile(join(home, 'browser-urls')), { code: 'ENOENT' });
    },
  });
});


test('launching after logout signs in before loading the catalog', { concurrency: true }, async t => {
  await launch(t, [model('gpt-next', true)], undefined, 200, {
    loggedOut: true,
    async verify({ home, catalogRequests }) {
      assert.equal(await readFile(join(home, 'auth-events'), 'utf8'), 'login\n');
      assert.equal(catalogRequests, 1);
    },
  });
});


test('/gpt-login uses the browser login without model requests', { concurrency: true }, async t => {
  const response = await launch(t, [], undefined, 200, {
    signedOut: true, hook: true,
    async verify({ home, catalogRequests }) {
      assert.equal(catalogRequests, 0);
      assert.equal(await readFile(join(home, 'browser-urls'), 'utf8'), 'https://example.test/oauth/authorize\n');
    },
  });
  assert.deepEqual(response, { decision: 'block', reason: 'GPT login succeeded.' });
});

test('/gpt-login reports failure without leaking non-JSON hook output', { concurrency: true }, async t => {
  const response = await launch(t, [], undefined, 200, {
    signedOut: true, hook: true, loginFails: true,
  });
  assert.equal(response.decision, 'block');
  assert.match(response.reason, /GPT login failed or timed out/);
});
