# Security

The 0.1 series is experimental. It is intended for a single user on the local machine. The server binds to loopback and requires its session link; do not expose it through a public proxy or tunnel. Do not share a live session URL or diagnostics containing private file paths.

Report suspected vulnerabilities privately using the repository's **Security → Report a vulnerability** option when enabled. If unavailable, ask a maintainer for a private reporting channel without posting exploit details, private media or secrets in a public issue. Include the affected version, minimal reproduction and impact. There is no guaranteed response time or independent security certification.

The application invokes installed Chrome and FFmpeg and parses imported files. Keep these tools current and review media provenance. Never commit API keys, `.env` files, browser credentials or private footage. The source-file audit detects a limited set of accidental disclosures; it is not a full security audit.
