#!/usr/bin/env bash
# Runs once at container creation (postCreateCommand).
set -euo pipefail

# Git credential helper: reads per-project installation token from the
# read-only mount at /run/gh-token/token. Fails loudly if the file is
# missing/empty instead of emitting an empty password and 401'ing silently.
git config --global credential.helper '!f() { t=/run/gh-token/token; [ -s "$t" ] || { echo "claude-sandbox: $t missing or empty (gh-token.timer dead? token dir cleaned up?)" >&2; exit 1; }; printf "username=x-access-token\npassword=%s\n" "$(cat "$t")"; }; f'

# Egress firewall (Layer 2). Idempotent-ish: drops everything else, allows
# only github + configured registries. Re-running flushes and re-applies.
if [ -x /workspace/.devcontainer/claude-sandbox-firewall.sh ]; then
    sudo /workspace/.devcontainer/claude-sandbox-firewall.sh || true
fi

mkdir -p "$HOME/.claude"
if [ ! -f "$HOME/.claude/settings.json" ]; then
    echo '{}' > "$HOME/.claude/settings.json"
fi

# Token-optimizer: enable the plugin from the read-only mount at /opt/token-optimizer.
if [ -d /opt/token-optimizer ]; then
    TMP=$(mktemp)
    jq '
        .enabledPlugins["token-optimizer@alexgreensh-token-optimizer"] = true
        | .extraKnownMarketplaces["alexgreensh-token-optimizer"] = {
            source: { source: "directory", path: "/opt/token-optimizer" }
          }
        | .statusLine = {
            type: "command",
            command: "node /opt/token-optimizer/skills/token-optimizer/scripts/statusline.js"
          }
    ' "$HOME/.claude/settings.json" > "$TMP" && mv "$TMP" "$HOME/.claude/settings.json"
fi

# Continuous-learning-v2: observation capture only. Observer analysis runs on
# host (reads homunculus/ via the bind mount from staging). We wire the
# observe.sh PreToolUse + PostToolUse hooks but rely on CLV2_CONFIG
# (containerEnv) pointing at /workspace/.devcontainer/cl-v2-container-config.json
# which has observer.enabled=false so lazy-start stays quiet.
if [ -x "$HOME/.claude/skills/continuous-learning-v2/hooks/observe.sh" ]; then
    TMP=$(mktemp)
    jq '
        .hooks.PreToolUse = ((.hooks.PreToolUse // []) | map(select(
            (.hooks // []) | all(.command // "" | contains("continuous-learning-v2") | not)
        )) + [{
            matcher: "*",
            hooks: [{ type: "command", command: "~/.claude/skills/continuous-learning-v2/hooks/observe.sh pre" }]
        }])
        | .hooks.PostToolUse = ((.hooks.PostToolUse // []) | map(select(
            (.hooks // []) | all(.command // "" | contains("continuous-learning-v2") | not)
        )) + [{
            matcher: "*",
            hooks: [{ type: "command", command: "~/.claude/skills/continuous-learning-v2/hooks/observe.sh post" }]
        }])
    ' "$HOME/.claude/settings.json" > "$TMP" && mv "$TMP" "$HOME/.claude/settings.json"
fi
