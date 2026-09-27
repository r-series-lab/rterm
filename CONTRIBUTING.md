# Contributing

Thank you for helping improve rTerm. Read the [public repository boundary](PUBLIC_REPOSITORY.md) before opening a pull request.

## Development setup

```bash
npm run web:install
npm run web:build
npm run rust-check
cargo test --workspace
```

Keep pull requests focused and update `CHANGELOG.md` when a public behavior or CLI contract changes. Release packaging and tags are maintained according to [RELEASE.md](RELEASE.md).

Never commit real server addresses, usernames, passwords, private keys, connection exports, command history, local paths, or business data. Use placeholder hosts such as `example.com` and generic test paths.
