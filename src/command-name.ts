// The command name printed in help, usage, hints, errors and --version: "gtfs-tools", or the name the
// @gabrielahn/gtfs-viz-cli compatibility package sets ("gtfs-viz") before it starts this CLI. The data
// directory (~/.gtfs-viz-cli), the GTFS_VIZ_* variables and the dashboard API keep their names.
export const commandName = (): string => process.env.GTFS_TOOLS_COMMAND_NAME || "gtfs-tools";
