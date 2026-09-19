---
name: gpt-logout
description: Sign out of the ChatGPT account used by Claudex
disable-model-invocation: true
allowed-tools: Bash(${CLAUDE_PLUGIN_ROOT}/scripts/gpt-auth logout)
---

!`${CLAUDE_PLUGIN_ROOT}/scripts/gpt-auth logout`

Tell the user whether GPT logout succeeded. Do not perform any other action.
