# Claudex

Run Claude Code with GPT models from a ChatGPT Codex subscription through a
local compatibility proxy.

## One-command install

Supported: macOS and Linux on Apple Silicon/ARM64 and Intel/AMD64.

On Debian or Ubuntu, install the required command-line tools first:

```bash
sudo apt install curl tar coreutils
```

```bash
curl -fsSL https://raw.githubusercontent.com/cobraprojects/claudex/main/install.sh | bash
```

The installer downloads a checksum-verified precompiled binary from GitHub
Releases, configures a per-user background service, installs Claude Code from
Anthropic's official installer when necessary, updates Claude Code if it is too
old for the dynamic model picker, and opens the ChatGPT login flow. Client
machines do **not** need Rust, a compiler, or Homebrew. Claude Code is not
pinned; the installer only requires version 2.1.261 or newer.

After installation, open a new terminal and run:

```bash
claudex
```

Inside Claudex, manage the ChatGPT account used for GPT models with:

```text
/gpt-login
/gpt-logout
```

These commands are bundled with Claudex and are available to every user after
installing or updating.

`claudex` starts Claude Code with `--dangerously-skip-permissions`. This disables
permission confirmations and should only be used in environments where you
accept that risk.

Claudex uses Claude Code's normal `~/.claude` configuration. Your existing MCP
servers, skills, plugins, settings, projects, and history remain available. The
launcher adds temporary session settings only for the local proxy connection;
it does not create or switch to a separate Claude configuration directory.

## Models

The proxy discovers GPT models directly from the authenticated Codex catalog.
The picker includes its visible non-fast GPT models. Your saved selection is
preserved while it remains available; otherwise Codex's highest-priority visible
model becomes the default.

Use `/model` inside Claude Code to switch models and `/effort` to choose the
reasoning effort. Each launch refreshes the catalog; request validation and
Responses Lite routing use the same catalog. New models appear without editing
a model list or updating the proxy. No other app installation or model cache is
used. OpenAI's public Codex release metadata supplies the protocol version
required by the catalog. Discovery errors are reported instead of substituting
a fixed model list. Restart Claudex to refresh an already-open picker.

The `/v1/models` response includes the catalog's display names and descriptions,
supported reasoning levels with their descriptions, default effort, context and
compaction limits, input modalities, image-detail support, reasoning-summary and
verbosity support, service tiers, and upgrade information when supplied by Codex.
Both raw GPT IDs and `claude-` compatibility IDs carry the same metadata.
Missing fields remain absent; the proxy does not invent model capabilities.

Reasoning options are exposed as `supported_reasoning_levels` and
`supported_reasoning_efforts`; defaults are exposed as `default_reasoning_level`
and `default_reasoning_effort`. Messages requests use `output_config.effort`,
Chat Completions requests use `reasoning_effort`, and Responses requests use
`reasoning.effort`. Omitted effort uses the catalog default. Unsupported levels
return a local HTTP 400 error. Catalog-defined levels, including `minimal`,
`ultra`, `persistent`, and future values, are forwarded without renaming them.
If the catalog omits supported levels, validation is left to Codex.

Other apps must read this metadata to offer the corresponding controls; model
discovery alone cannot add an effort selector to their UI. Claude Code's
`/effort` menu still follows its Fable compatibility profile and cannot expose
every GPT-specific level.

## Ultracode workflows

Every discovered GPT model uses Claude Code's `claude-fable-5-1` capability profile, which
includes dynamic workflows. Run `/effort ultracode`, or include `ultracode` in a
prompt, to enable the session-only mode. Ultracode is a workflow-orchestration
mode, not a thinking level: it manages subagents through dynamic workflows and
uses xhigh reasoning underneath.

## Up next

- Native Windows support: a Windows proxy executable, PowerShell installer,
  `claudex` launcher, startup/service integration, and signed release assets.
  Until then, Windows users can run the Linux installer inside WSL2.

## Updating

Run the installer again. It replaces only the isolated Claudex proxy and
launcher; Homebrew cannot overwrite them.

```bash
curl -fsSL https://raw.githubusercontent.com/cobraprojects/claudex/main/install.sh | bash
```

## How releases are built

GitHub Actions clones the proxy version recorded in `upstream-version`, applies
`patches/model-discovery.patch`, runs the compatibility test, and builds native
release binaries on GitHub-hosted macOS and Linux ARM64/x86_64 runners.

## Disclaimer

This is an unofficial compatibility project. It is not affiliated with,
endorsed by, or supported by Anthropic or OpenAI. Review the source before use
and ensure your usage complies with the applicable service terms. Authentication
is performed directly by the upstream proxy and stored using its platform-native
credential mechanism.

The underlying proxy is maintained at
[`raine/claude-code-proxy`](https://github.com/raine/claude-code-proxy).
