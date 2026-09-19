---
name: gpt-login
description: Sign in to the ChatGPT account used by Claudex
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/gpt-auth login)
---

!`${CLAUDE_PLUGIN_ROOT}/scripts/gpt-auth login`

Tell the user whether GPT login succeeded. Do not perform any other action.
