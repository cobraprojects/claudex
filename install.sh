#!/bin/sh
set -eu

repo="${CLAUDEX_REPO:-cobraprojects/claudex}"
version="${CLAUDEX_VERSION:-latest}"
base_url="http://127.0.0.1:18765"
install_root="$HOME/.local/share/claudex"
bin_dir="$HOME/.local/bin"
proxy="$install_root/bin/claude-code-proxy"
launcher="$bin_dir/claudex"
label="com.cobraprojects.claudex-proxy"
minimum_claude_version="2.1.219"

say() {
  printf '%s\n' "claudex: $*"
}

fail() {
  printf '%s\n' "claudex: $*" >&2
  exit 1
}

version_at_least() {
  awk -v current="$1" -v required="$2" 'BEGIN {
    split(current, c, ".")
    split(required, r, ".")
    for (i = 1; i <= 3; i++) {
      if ((c[i] + 0) > (r[i] + 0)) exit 0
      if ((c[i] + 0) < (r[i] + 0)) exit 1
    }
    exit 0
  }'
}

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "only macOS and Linux are currently supported" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x86_64" ;;
  *) fail "unsupported CPU architecture: $(uname -m)" ;;
esac

asset="claudex-$os-$arch.tar.gz"
if [ -n "${CLAUDEX_RELEASE_URL:-}" ]; then
  release_url="$CLAUDEX_RELEASE_URL"
elif [ "$version" = "latest" ]; then
  release_url="https://github.com/$repo/releases/latest/download"
else
  release_url="https://github.com/$repo/releases/download/$version"
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/claudex-install.XXXXXX")"
trap 'rm -r "$tmp"' EXIT HUP INT TERM

say "downloading $asset"
curl -fL --retry 3 "$release_url/$asset" -o "$tmp/$asset"
curl -fL --retry 3 "$release_url/SHA256SUMS" -o "$tmp/SHA256SUMS"

expected="$(awk -v asset="$asset" '$2 == asset {print $1}' "$tmp/SHA256SUMS")"
[ -n "$expected" ] || fail "release checksum is missing for $asset"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
fi
[ "$actual" = "$expected" ] || fail "checksum verification failed"

mkdir -p "$install_root/bin" "$bin_dir" "$HOME/.local/state/claudex-proxy"
tar -xzf "$tmp/$asset" -C "$tmp"
install -m 0755 "$tmp/claude-code-proxy" "$proxy"
install -m 0755 "$tmp/claudex" "$launcher"

# Stop the Homebrew-managed proxy if a previous experimental installation is
# occupying the same port. The standalone claudex binary is not managed by brew.
if command -v brew >/dev/null 2>&1 \
  && brew list --formula raine/claude-code-proxy/claude-code-proxy >/dev/null 2>&1; then
  brew services stop raine/claude-code-proxy/claude-code-proxy >/dev/null 2>&1 || true
fi

if [ "$os" = "darwin" ]; then
  plist="$HOME/Library/LaunchAgents/$label.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>$proxy</string>
    <string>serve</string>
    <string>--no-monitor</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>XDG_STATE_HOME</key><string>$HOME/.local/state</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.local/state/claudex-proxy/service.log</string>
  <key>StandardErrorPath</key><string>$HOME/.local/state/claudex-proxy/service.log</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
else
  if command -v systemctl >/dev/null 2>&1 \
    && systemctl --user show-environment >/dev/null 2>&1; then
    unit_dir="$HOME/.config/systemd/user"
    mkdir -p "$unit_dir"
    cat >"$unit_dir/claudex-proxy.service" <<EOF
[Unit]
Description=Claudex local Codex subscription proxy
After=network-online.target

[Service]
ExecStart=%h/.local/share/claudex/bin/claude-code-proxy serve --no-monitor
Restart=always
Environment=XDG_STATE_HOME=%h/.local/state

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now claudex-proxy.service
  else
    nohup "$proxy" serve --no-monitor \
      >>"$HOME/.local/state/claudex-proxy/service.log" 2>&1 &
  fi
fi

attempt=0
until curl -fsS --max-time 2 "$base_url/healthz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  [ "$attempt" -lt 30 ] || fail "the proxy service did not start"
  sleep 0.25
done

models="$(curl -fsS --max-time 3 "$base_url/v1/models?limit=1000")"
for model in claude-gpt-5.4 claude-gpt-5.5 claude-gpt-5.6-luna claude-gpt-5.6-terra claude-gpt-5.6-sol; do
  case "$models" in
    *"\"id\":\"$model\""*) ;;
    *) fail "installed proxy did not advertise $model" ;;
  esac
done

profile="$HOME/.profile"
case "${SHELL:-}" in
  */zsh) profile="$HOME/.zshrc" ;;
  */bash) profile="$HOME/.bashrc" ;;
esac
if ! grep -Fq '# claudex-path' "$profile" 2>/dev/null; then
  {
    printf '\n# claudex-path\n'
    printf '%s\n' "export PATH=\"\$HOME/.local/bin:\$PATH\""
  } >>"$profile"
fi
export PATH="$bin_dir:$PATH"

if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
  say "installing Claude Code using Anthropic's official installer"
  curl -fsSL https://claude.ai/install.sh | bash
fi

if command -v claude >/dev/null 2>&1; then
  claude_bin="$(command -v claude)"
else
  claude_bin="$HOME/.local/bin/claude"
fi
claude_version="$("$claude_bin" --version | awk '{print $1}')"
if ! version_at_least "$claude_version" "$minimum_claude_version"; then
  say "updating Claude Code $claude_version for GPT model slots and Ultracode workflows"
  "$claude_bin" update
  claude_version="$("$claude_bin" --version | awk '{print $1}')"
  version_at_least "$claude_version" "$minimum_claude_version" \
    || fail "Claude Code $minimum_claude_version or newer is required"
fi

if "$proxy" codex auth status >/dev/null 2>&1; then
  say "Codex authentication is already configured"
else
  say "opening the ChatGPT/Codex login flow"
  "$proxy" codex auth login
fi

say "installed successfully"
say "open a new terminal or run: export PATH=\"$HOME/.local/bin:\$PATH\""
say "then launch: claudex"
