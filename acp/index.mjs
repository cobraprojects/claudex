import { agent as acpAgent, ndJsonStream } from '@agentclientprotocol/sdk';
import { ClaudeAcpAgent, nodeToWebReadable, nodeToWebWritable } from '@agentclientprotocol/claude-agent-acp';
import { homedir } from 'node:os';
import { join } from 'node:path';
import packageJson from './package.json' with { type: 'json' };

const baseUrl = process.env.CLAUDEX_BASE_URL ?? 'http://127.0.0.1:18765';
const response = await fetch(`${baseUrl}/v1/models?limit=1000`, { signal: AbortSignal.timeout(75000) });
if (!response.ok) throw new Error(`Claudex model discovery failed (HTTP ${response.status}): ${await response.text()}`);
const catalog = (await response.json()).data.filter(model =>
  model.id.startsWith('claude-gpt-') && !model.id.endsWith('-fast') && model.visibility === 'list');
if (!catalog.length) throw new Error('Claudex did not discover any visible GPT models');

if (process.argv[2] === 'about') {
  console.log(JSON.stringify({ name: 'Claudex', cliVersion: packageJson.version, runtime: 'Claude Code' }));
  process.exit(0);
}

process.env.CLAUDE_CODE_EXECUTABLE = join(homedir(), '.local/bin/claudex');
console.log = console.error;
console.info = console.error;
console.debug = console.error;

function effortOption(model, currentValue = model.default_reasoning_effort) {
  const levels = model.supported_reasoning_efforts ?? [];
  if (!levels.length) return undefined;
  const defaultValue = model.default_reasoning_effort ?? 'default';
  return {
    id: 'effort', name: 'Reasoning', category: 'thought_level', type: 'select',
    currentValue: levels.some(level => level.effort === currentValue) ? currentValue : defaultValue,
    options: [...(defaultValue === 'default' ? [{ value: 'default', name: 'Provider default' }] : []), ...levels.map(level => ({
      value: level.effort,
      name: level.effort[0].toUpperCase() + level.effort.slice(1),
      description: level.description,
    }))],
  };
}

let agent;
const buildMode = process.argv.includes('--force') ? 'bypassPermissions'
  : process.argv.includes('--auto-review') ? 'auto' : 'default';
async function synchronizeSession(result, sessionId = result.sessionId) {
  const session = agent.sessions[sessionId];
  session.modelInfos = session.modelInfos.map(info => {
    const model = catalog.find(model => model.id === info.value);
    return model ? { ...info, supportsEffort: Boolean(model.supported_reasoning_efforts?.length),
      supportedEffortLevels: model.supported_reasoning_efforts?.map(level => level.effort) ?? [] } : info;
  });
  const model = catalog.find(model => model.id === session.models.currentModelId)
    ?? catalog.find(model => model.is_default) ?? catalog[0];
  if (session.models.currentModelId !== model.id) {
    await agent.setSessionConfigOption({ sessionId, configId: 'model', value: model.id });
  }
  session.models.availableModels = catalog.map(model => ({ modelId: model.id,
    name: model.display_name ?? model.id, description: model.description }));
  session.configOptions = session.configOptions.map(option => option.id === 'model'
    ? { ...option, options: catalog.map(model => ({ value: model.id,
      name: model.display_name ?? model.id, description: model.description })) } : option);
  const effort = effortOption(model, session.configOptions.find(option => option.id === 'effort')?.currentValue);
  session.configOptions = session.configOptions.filter(option => option.id !== 'effort');
  if (effort) {
    session.configOptions.push(effort);
    await agent.setSessionConfigOption({ sessionId, configId: 'effort', value: effort.currentValue });
  }
  return { ...result, models: session.models, configOptions: session.configOptions };
}

const app = acpAgent({ name: 'claudex' })
  .onConnect(connection => {
    const client = connection.client;
    agent = new ClaudeAcpAgent({
      sessionUpdate: params => client.notify('session/update', params),
      requestPermission: (params, signal) => client.request('session/request_permission', params, { cancellationSignal: signal }),
      readTextFile: params => client.request('fs/read_text_file', params),
      writeTextFile: params => client.request('fs/write_text_file', params),
      createElicitation: (params, signal) => client.request('elicitation/create', params, { cancellationSignal: signal }),
      completeElicitation: params => client.notify('elicitation/complete', params),
      extNotification: (method, params) => client.notify(method, params),
    });
  })
  .onRequest('initialize', async ({ params }) => {
    const result = await agent.initialize(params);
    delete result.agentCapabilities.auth;
    delete result.agentCapabilities.providers;
    delete result._meta?.steering;
    return { ...result,
      agentInfo: { name: 'claudex', title: 'Claudex', version: packageJson.version },
      authMethods: [{ id: 'cursor_login', name: 'ChatGPT', description: 'Sign in using claudex /gpt-login' }],
    };
  })
  // The launcher authenticates with ChatGPT before starting this connection.
  .onRequest('authenticate', ({ params }) => {
    if (params.methodId !== 'cursor_login') throw new Error(`Unknown authentication method: ${params.methodId}`);
    return {};
  })
  .onRequest('cursor/list_available_models', { parse: value => value }, () => ({
    models: catalog.map(model => ({ value: model.id, name: model.display_name ?? model.id,
      configOptions: [effortOption(model)].filter(Boolean) })),
  }))
  .onRequest('session/new', async ({ params }) => {
    const result = await synchronizeSession(await agent.newSession(params));
    await agent.setSessionMode({ sessionId: result.sessionId, modeId: buildMode });
    return result;
  })
  .onRequest('session/load', async ({ params }) => synchronizeSession(await agent.loadSession(params), params.sessionId))
  .onRequest('session/resume', async ({ params }) => synchronizeSession(await agent.resumeSession(params), params.sessionId))
  .onRequest('session/fork', async ({ params }) => synchronizeSession(await agent.unstable_forkSession(params)))
  .onRequest('session/set_config_option', async ({ params }) => {
    if (params.configId === 'model' && !catalog.some(model => model.id === params.value)) {
      throw new Error(`Model is not available in the Claudex catalog: ${params.value}`);
    }
    const result = await agent.setSessionConfigOption(params);
    return params.configId === 'model' ? synchronizeSession(result, params.sessionId) : result;
  })
  .onRequest('session/set_mode', ({ params }) => agent.setSessionMode({ ...params,
    modeId: ({ build: buildMode, plan: 'plan', ask: 'plan' })[params.modeId] ?? params.modeId }));

for (const [method, handler] of Object.entries({
  'session/prompt': 'prompt',
  'session/close': 'closeSession', 'session/list': 'listSessions',
  'session/delete': 'deleteSession',
})) app.onRequest(method, ({ params }) => agent[handler](params));
app.onNotification('session/cancel', ({ params }) => agent.cancel(params));

const connection = app.connect(ndJsonStream(nodeToWebWritable(process.stdout), nodeToWebReadable(process.stdin)));
async function shutdown() {
  await agent?.dispose();
  process.exit(0);
}
connection.closed.then(shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
