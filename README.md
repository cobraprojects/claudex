# Claudex

Run Claude Code with GPT models from a ChatGPT Codex subscription through a
local compatibility proxy.

## One-command install

Supported: macOS and Linux on Apple Silicon/ARM64 and Intel/AMD64.

```bash
curl -fsSL https://raw.githubusercontent.com/cobraprojects/claudex/main/install.sh | bash
```

The installer downloads a checksum-verified precompiled binary from GitHub
Releases, configures a per-user background service, installs Claude Code from
Anthropic's official installer when necessary, and opens the ChatGPT login
flow. Client machines do **not** need Rust, a compiler, or Homebrew.

After installation, open a new terminal and run:

```bash
claudex
```

`claudex` starts Claude Code with `--dangerously-skip-permissions`. This disables
permission confirmations and should only be used in environments where you
accept that risk.

Claudex uses Claude Code's normal `~/.claude` configuration. Your existing MCP
servers, skills, plugins, settings, projects, and history remain available. The
launcher adds temporary session settings only for the local proxy connection;
it does not create or switch to a separate Claude configuration directory.

## Models

- GPT-5.4
- GPT-5.5
- GPT-5.6 Luna
- GPT-5.6 Terra
- GPT-5.6 Sol (default)

Use `/model` inside Claude Code to switch models and `/effort` to choose the
reasoning effort.

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
