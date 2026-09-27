# Public Repository Boundary

This repository is intended to be public source code for rTerm. It contains application source, documentation, tests, manifests, and synthetic examples only.

The following must stay outside the repository:

- server addresses, usernames, passwords, private keys, connection exports, and remote file contents;
- API keys, access tokens, signing material, personal data, complete machine paths, and command history;
- internal endpoints, deployment details, generated build output, and local caches.

rTerm stores connection metadata locally and protects saved passwords with the operating system keychain where available. Publishing this repository does not publish a user's local SQLite database or keychain data. If sensitive data is found, report it privately as described in [SECURITY.md](SECURITY.md).
