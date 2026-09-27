# Miko

<div>
  <a href="https://github.com/mikoagents/miko/actions">
    <img src="https://github.com/mikoagents/miko/actions/workflows/ci.yml/badge.svg" alt="CI">
  </a>

</div>

**Miko is an open-source, self-hosted AI coding agent.** It takes tasks from GitHub, GitLab, Linear, Slack and Zulip, works on them in isolated Git worktrees, and sends progress and results back to your team. Bring your own API keys or coding-agent subscriptions — choose Claude Code, Codex, Cursor, Gemini, OpenCode or Grok as the coding engine.

## Why Miko

- **Open source, self-hosted AI coding agent** — Miko is open source (Apache 2.0) and runs on your own machine or server. Your code and API keys stay on your infrastructure.
- **Works where your team already is** — take tasks from GitHub Issues & PRs, GitLab MRs, Linear, Slack and Zulip, and post progress and results back to the same place.
- **Any coding engine** — run tasks with Claude Code, Codex, Cursor, Gemini, OpenCode or Grok.
- **Bring your own keys** — use your own API keys or existing coding-agent subscriptions. No markup, no middleman.
- **Isolated by default** — every task gets its own Git worktree, so parallel tasks never step on each other.
- **Reports back** — progress and results land on the issue, PR, MR or channel that started the task.
- **AI-guided setup** — one command installs Miko from source, and an interactive `/miko-setup` session handles auth, integrations and repositories. No manual runbook to follow.
- **Local status board** — live tasks and searchable logs at `/board`, served from your own instance.
- **Automations** — schedule recurring repository tasks and inspect run history.
- **Self-updating** — source installations follow `main`, build updates while the current version keeps running, restart only when tasks are idle, and roll back automatically if a startup fails.

## Integrations

Miko works inside the tools your team already uses. Each integration runs on your own accounts — your GitHub App, your GitLab and Linear OAuth apps, your Slack App — and every task reports back to the issue, PR, MR or channel where it started.

| Platform | How you use Miko | Docs |
| --- | --- | --- |
| **GitHub** | @mention Miko on any Issue or PR — it works in an isolated worktree and sends the result back as a pull request | [Git & GitHub Setup](./docs/GIT_GITHUB.md) |
| **GitLab** | @mention Miko on a merge request or issue — results come back as an MR | [Git & GitLab Setup](./docs/GIT_GITLAB.md) |
| **Linear** | Assign an issue to Miko — progress and results come back on the issue | [Self-Hosting Guide](./docs/SELF_HOSTING.md) |
| **Slack** | Mention the bot in any channel — use Miko as a Slack integration for Claude Code, Codex, Cursor, Gemini or OpenCode | [Self-Hosting Guide](./docs/SELF_HOSTING.md) |
| **Zulip** | Miko answers @mentions in Zulip topics and DMs | [Zulip Setup](./docs/ZULIP.md) |

Miko keeps running on your own machine or server — expose it to your integrations through your own domain or a [Cloudflare Tunnel](./docs/CLOUDFLARE_TUNNEL.md).

## Getting Started

### Self-Hosted Setup

Follow: https://atmiko.com/#get-started

### What to Expect

Running `/miko-setup` starts a guided conversation with your coding agent. It walks you through the following steps, checking existing configuration as it goes:

1. **Choose your agent's name and integrations.** Pick the services you want to use: Linear, GitHub, GitLab, or Slack. Setup only configures the integrations you select.
2. **Install Miko on your machine.** The agent checks prerequisites, helps you install missing tools, and downloads and builds Miko from source.
3. **Connect your coding credentials.** The default setup guides you through Claude Code authentication with your own API key, OAuth token, or supported provider account. Miko also supports other runners through its [configuration](./docs/CONFIG_FILE.md).
4. **Connect your chosen services.** Set up a public webhook URL using a tunnel or your own domain, then create and authorize the integration apps. The agent can help with browser steps or provide manual instructions; you sign in and approve access to your accounts.
5. **Add your repositories.** Choose the repositories Miko should work on. Setup clones them and saves Miko's settings under `~/.miko`.
6. **Start Miko and verify it works.** Review the setup summary, choose how to keep it running, and start the worker. The agent checks the local service and gives you the `/board` URL for tasks and logs.

**Try your first task:** assign a Linear issue to Miko, @mention it on a configured GitHub Issue/PR or GitLab MR, or mention the bot in Slack. It creates an isolated workspace for the task, runs the coding agent, and sends progress and results back to the connected service. Keep Miko running, along with any tunnel you use, so new tasks can reach it.

You can run `/miko-setup` again to add integrations or update your configuration.

New source installations automatically follow `main`: Miko checks in the background, builds updates while the current version keeps running, and restarts only when tasks are idle. A failed startup rolls back automatically. Unmodified default skills update with the runtime; your customized skills are preserved. Existing installations need one upgrade to receive this update mechanism. See [update controls and recovery](./docs/FORK_INSTALLATION.md#automatic-updates).

See **[Fork Installation](./docs/FORK_INSTALLATION.md)** for requirements, the verified launcher, updates and source commit verification. The existing npm version number alone does not identify a fork build.

Or follow the **[manual setup guide](./docs/SELF_HOSTING.md)** if you prefer.

---

## More Documentation

- **[Migration to Miko](./docs/MIKO_MIGRATION.md)** - New names and how to move an existing installation
- **[Automations](./docs/AUTOMATIONS.md)** - Schedule repository tasks and inspect run history
- **[Local Status Board](./docs/STATUS_BOARD.md)** - Live tasks and searchable logs at `/board`, on the same server as `/status`
- **[Self-Hosting Guide](./docs/SELF_HOSTING.md)** - Complete community manual setup
- **[Git & GitHub Setup](./docs/GIT_GITHUB.md)** - Git and GitHub CLI configuration for PRs
- **[Git & GitLab Setup](./docs/GIT_GITLAB.md)** - Git and GitLab CLI configuration for MRs
- **[Zulip Setup](./docs/ZULIP.md)** - Answer @mentions in Zulip topics and DMs
- **[Configuration Reference](./docs/CONFIG_FILE.md)** - Detailed config.json options
- **[Cloudflare Tunnel Setup](./docs/CLOUDFLARE_TUNNEL.md)** - Expose your local instance
- **[Setup Scripts](./docs/SETUP_SCRIPTS.md)** - Repository and global initialization scripts

---

## License

This project is licensed under the Apache 2.0 license - see the [LICENSE](LICENSE) file for details.

## Credits

This project builds on the technologies built by the awesome teams at Linear, and Claude by Anthropic:

- [Linear API](https://linear.app/developers)
- [Anthropic Claude Code](https://www.claude.com/product/claude-code)
