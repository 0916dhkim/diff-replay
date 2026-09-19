# Daemon Setup

Diff Replay is designed as a persistent, single-server background service. Instead of starting and stopping ad-hoc web servers during code review sessions, Diff Replay runs continuously in the background so your agents can publish manifests to it and you can review them in your browser at any time.

---

## macOS (launchd)

On macOS, configure Diff Replay as a user `launchd` agent.

### 1. Create the Launch Agent Plist

Save the following file to `~/Library/LaunchAgents/com.diff-replay.serve.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>com.diff-replay.serve</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/zsh</string>
		<string>-l</string>
		<string>-i</string>
		<string>-c</string>
		<string>cd /path/to/diff-replay && exec node dist/cli.js serve</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>/Users/USER/Library/Logs/diff-replay.log</string>
	<key>StandardErrorPath</key>
	<string>/Users/USER/Library/Logs/diff-replay.err.log</string>
	<key>ThrottleInterval</key>
	<integer>5</integer>
	<key>WorkingDirectory</key>
	<string>/path/to/diff-replay</string>
</dict>
</plist>
```

> **Note:** Replace `/path/to/diff-replay` with your actual repository path and `/Users/USER` with your home directory.

### 2. Load and Start the Agent

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.diff-replay.serve.plist
```

### 3. Management Commands

- **Restart service:**
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.diff-replay.serve
  ```
- **Stop / Unload service:**
  ```bash
  launchctl bootout gui/$(id -u)/com.diff-replay.serve
  ```
- **Inspect logs:**
  ```bash
  tail -f ~/Library/Logs/diff-replay.log
  tail -f ~/Library/Logs/diff-replay.err.log
  ```

---

## Linux (systemd User Service)

On Linux, configure Diff Replay as a systemd user service.

### 1. Create the Service Unit

Create `~/.config/systemd/user/diff-replay.service`:

```ini
[Unit]
Description=Diff Replay persistent local service
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/git/diff-replay
ExecStart=/usr/bin/env node dist/cli.js serve
Restart=on-failure
RestartSec=5s
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
```

> **Note:** Update `WorkingDirectory` and the path to `node` if installed via a version manager or specific prefix.

### 2. Enable and Start

```bash
systemctl --user daemon-reload
systemctl --user enable --now diff-replay.service
```

### 3. Management Commands

- **Check status:**
  ```bash
  systemctl --user status diff-replay
  ```
- **Restart service:**
  ```bash
  systemctl --user restart diff-replay
  ```
- **Follow logs:**
  ```bash
  journalctl --user -u diff-replay -f
  ```

---

## Health Check

Regardless of operating system, test that the service is responding:

```bash
curl -fsS http://127.0.0.1:7890/api/health
# returns {"ok":true}
```
