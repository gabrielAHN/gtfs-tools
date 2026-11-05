#!/usr/bin/env node
// gtfs-viz: the gtfs-tools CLI under its former command name. Help, usage and hints say gtfs-viz; the
// data directory (~/.gtfs-viz-cli), the dashboard daemon and the environment variables are shared with
// gtfs-tools. The CLI entry resolves through the @gabrielahn/gtfs-tools package (a dependency pinned to
// this package's version) and runs on import, after the command name is set.
process.env.GTFS_TOOLS_COMMAND_NAME = "gtfs-viz"
await import("@gabrielahn/gtfs-tools/dist/index.js")
