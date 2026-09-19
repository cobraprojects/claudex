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

GPT-6 Astra is the default. The picker also includes every non-fast Codex GPT
model advertised by the installed proxy, including the GPT-5.x families.

Use `/model` inside Claude Code to switch models and `/effort` to choose the
reasoning effort. Claudex builds the picker from the proxy's live model list,
so models added by future proxy updates appear without launcher changes.

## Ultracode workflows

Every discovered GPT model uses Claude Code's Fable capability profile, which
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
