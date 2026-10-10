# Security

Security fixes target the latest release.

Report vulnerabilities through [GitHub's private reporting form](https://github.com/mchl-schrdng/dwell-terminal/security/advisories/new). Please include reproduction steps and the affected version. Do not publish credentials or sensitive project files in an issue.

Dwell's renderer is sandboxed. Preview paths are restricted to the open project, text and image reads are bounded, and Markdown is sanitized. Previews do not execute code or load remote images. Git previews disable external diff, text conversion, filesystem-monitor commands and clean/process filters without changing Git configuration or the index. Files using filters (such as LFS) are compared without transformation, so their status can differ from a normal Git invocation. The desktop orb has a separate, limited renderer bridge.

The terminal is a real shell with your normal account permissions. The project boundary applies to previews, not to commands you run. Dwell is not a sandbox for untrusted shell commands.

Claude integration is opt-in through the Help menu. Setup merges only Dwell-owned hooks into Claude's user settings and removal preserves other hooks. The bundled hook uses macOS tools, accepts bounded JSON and emits only fixed terminal status sequences; it does not read transcripts, execute message contents or open a network service. Any program in a terminal can emit a bell or progress sequence, so orb states are indicators rather than trusted proof of a program's identity or success.

This release is not Apple-notarized. Release archives include SHA-256 checksums. Dwell itself adds no telemetry or cloud services; programs launched inside it retain their own network behavior.
