# rTerm interface guide

The public screenshot uses test data only: `example.test`, `demo-user`, `/demo/project`, and sample filenames. Replace these with your own values locally; never publish real connection details.

## Workbench

The workbench keeps local and remote paths visible together. Confirm the current path on both sides before selecting a file action. The connection label should identify a test or local target when preparing screenshots.

## Connections

Use a recent or favorite connection to start. Review protocol, host, user, and starting directory before connecting. Credentials and keys remain in local secure storage and should not be copied into repository text or issue reports.

## File actions and transfers

Create, rename, copy, move, delete, preview, and inspect permissions from the file pane. For uploads and downloads, check the destination and conflict summary before confirming. Use a small sample file when documenting a workflow.

## Terminal and CLI

The terminal entry point is for explicit local or remote commands. For automation, prefer the JSON CLI: discover support with `capabilities --json`, list a directory with `browse list --json`, and test a connection with `connections test --json`.
