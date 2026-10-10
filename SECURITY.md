# Security

Security fixes target the latest release.

Report vulnerabilities through [GitHub's private reporting form](https://github.com/mchl-schrdng/dwell-terminal/security/advisories/new). Please include reproduction steps and the affected version. Do not publish credentials or sensitive project files in an issue.

Dwell's renderer is sandboxed. Preview paths are restricted to the open project, text and image reads are bounded, and Markdown is sanitized. Previews do not execute code or load remote images. Git previews disable external diff, text conversion and filesystem-monitor commands from repository configuration. The desktop orb has a separate, limited renderer bridge.

The terminal is a real shell with your normal account permissions. The project boundary applies to previews, not to commands you run. Dwell is not a sandbox for untrusted shell commands.

This release is not Apple-notarized. Release archives include SHA-256 checksums. Dwell itself adds no telemetry or cloud services; programs launched inside it retain their own network behavior.
