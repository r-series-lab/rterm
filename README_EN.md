# rTerm

rTerm is a local-first remote directory workbench for SFTP, SCP, FTP, FTPS, and WebDAV. It combines local and remote browsing, common file actions, transfer checks, terminal entry points, and a stable CLI for scripts and AI agents.

## Highlights

- Recent and favorite connections with saved directories.
- Two-pane local and remote browsing with create, rename, copy, move, delete, permission, preview, and checksum actions.
- Upload and download flows that keep the destination and conflicts visible.
- Local command entry, basic remote command entry, and target-terminal completion.
- JSON CLI commands: `info`, `capabilities`, `browse list`, and `connections test`.

## Safe sample data

The website examples use `example.test`, `demo-user`, and sample filenames only. Do not place real hosts, usernames, passwords, SSH keys, or customer files in screenshots, fixtures, or public issues.

## CLI

```sh
cargo run -- info --json
cargo run -- capabilities --json
cargo run -- browse list --json --path .
```

Before a real connection, review the target and run the connection test explicitly. JSON output is designed for automation and should not be treated as a place to expose secrets.

## Development

```sh
npm run web:build
npm run rust-check
```
