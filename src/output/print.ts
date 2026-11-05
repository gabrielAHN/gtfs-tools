import { getFlagString } from "../args.js";
import { commandName } from "../command-name.js";
import { IMPORT_USAGE } from "../remote/source.js";

// The command name in every help text: gtfs-tools, or gtfs-viz through the compatibility package.
const CLI = commandName();

const TRUNCATE_AT = 50;
const ESC = String.fromCharCode(27);
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "\u2026" : s);
const stripAnsi = (s: string) =>
  s.replaceAll(`${ESC}[0m`, "").replaceAll(`${ESC}[1m`, "").replaceAll(`${ESC}[2m`, "");

const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return "\x1b[2m-\x1b[0m";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

export const printTable = (result: { columns?: string[]; rows: Record<string, unknown>[] }) => {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const columns =
    Array.isArray(result.columns) && result.columns.length > 0
      ? result.columns
      : rows.length > 0
        ? Object.keys(rows[0])
        : [];

  if (columns.length === 0 || rows.length === 0) {
    console.log("\x1b[2mNo rows\x1b[0m");
    return;
  }

  const widths = columns.map((col) => {
    const dataMax = Math.max(...rows.map((row) => stripAnsi(formatValue(row[col])).length));
    return Math.min(Math.max(col.length, dataMax), TRUNCATE_AT);
  });

  const sep = "  ";
  const renderRow = (values: string[]) =>
    values
      .map((v, i) => {
        const plain = stripAnsi(v);
        const pad = Math.max(0, widths[i] - plain.length);
        return v + " ".repeat(pad);
      })
      .join(sep);

  console.log(`\x1b[1m${renderRow(columns)}\x1b[0m`);
  console.log(widths.map((w) => "\u2500".repeat(w)).join(sep));

  for (const row of rows) {
    const vals = columns.map((col, i) => {
      const raw = formatValue(row[col]);
      const plain = stripAnsi(raw);
      return plain.length > widths[i] ? truncate(plain, widths[i]) : raw;
    });
    console.log(renderRow(vals));
  }

  console.log(`\x1b[2m${rows.length} row${rows.length === 1 ? "" : "s"}\x1b[0m`);
};

export const printResult = (
  result: {
    sourcePath?: string;
    importedAt?: string;
    columns?: string[];
    rows: Record<string, unknown>[];
    stationId?: string;
    stationName?: string;
    nodeId?: string;
    nodeName?: string;
    stopId?: string;
    stopName?: string;
  },
  flags: Record<string, string | boolean>,
) => {
  const format = getFlagString(flags, "format", "table");
  if (format === "json") {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printTable(result);
  }
};

const commandHelp: Record<string, string> = {
  import: `${IMPORT_USAGE}

  Import a GTFS zip file into the local DuckDB database. Remote feeds download to
  ~/.gtfs-viz-cli/downloads first, must be a zip archive, and are deleted after the
  import. Download and validation failures (not a zip, no stops.txt) leave the
  current dataset untouched; a failure during the DuckDB import itself still
  clears it, as for local files.

  Arguments (one is required):
    <feed.zip>        Path to a local GTFS zip file
    <https://…>       HTTP(S) URL of a GTFS zip (redirects are followed; a pre-signed
                      URL's query string is used for the download but never stored)
    <s3://…>          S3 object (also s3a:// and s3n://), read through DuckDB
    <r2://…>          Cloudflare R2 object, read through DuckDB

  Never put a user name or password in a URL: such URLs are refused, and so is an
  unencoded @ in an http(s) URL path (percent-encode it as %40).

  Authentication for s3:// and r2:// uses DuckDB secrets, in this order:
    1. Any DuckDB secret that matches the URL, including persistent secrets:
         duckdb -c "CREATE PERSISTENT SECRET (TYPE s3, KEY_ID '…', SECRET '…', REGION 'us-east-1')"
    2. s3:// only: AWS credentials from environment variables (AWS_ACCESS_KEY_ID,
       AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN, AWS_REGION), an AWS profile or an
       SSO login, through a temporary credential_chain secret.
    3. s3:// only: an anonymous request, for public buckets.
  r2:// needs a secret:
         duckdb -c "CREATE PERSISTENT SECRET (TYPE r2, KEY_ID '…', SECRET '…', ACCOUNT_ID '…')"
  S3-compatible stores such as MinIO use an s3 secret with an ENDPOINT:
         duckdb -c "CREATE PERSISTENT SECRET (TYPE s3, KEY_ID '…', SECRET '…', ENDPOINT 'minio.example.com:9000', URL_STYLE 'path', USE_SSL true)"
  Secret values are never printed or stored by ${CLI}.

  The gtfs DuckDB extension installs from the DuckDB community repository, which
  needs a DuckDB v2.0.0 CLI; GTFS_EXTENSION_REPOSITORY selects another repository.

  Examples:
    ${CLI} import /path/to/feed.zip
    ${CLI} import https://example.com/gtfs/feed.zip
    ${CLI} import s3://my-bucket/gtfs/feed.zip`,

  export: `${CLI} export [flags]

  Export edited GTFS data as CSV files. Merges edits with original data.

  Flags:
    --output <dir>        Output directory (default: current directory)
    --no-stops            Skip stops.txt export
    --no-pathways         Skip pathways.txt export
    --no-routes           Skip routes.txt export
    --no-trips            Skip trips.txt export
    --no-stop-times       Skip stop_times.txt export
    --no-calendar         Skip calendar.txt and calendar_dates.txt export
    --force               Export even if there are no pending edits`,

  "install-skill": `${CLI} install-skill [provider] [flags]

  Install the bundled gtfs-tools agent skill for an AI provider.

  Providers:
    anthropic            Anthropic Claude Code (~/.claude/skills)
    openai               OpenAI Codex (~/.codex/skills)
    google               Google Gemini CLI (~/.gemini/skills)
    generic              Generic Agent Skills (~/.agents/skills)

  Flags:
    --provider <name>    Provider name
    --agent <name>       Backward-compatible alias for --provider
    --target-dir <dir>   Override the provider's skills directory
    --list-providers     List providers and resolved installation paths
    --force              Replace an existing gtfs-tools skill

  Examples:
    ${CLI} install-skill openai
    ${CLI} install-skill --provider anthropic
    ${CLI} install-skill google --force
    ${CLI} install-skill --list-providers

  A provider is required in non-interactive shells, including with --target-dir.`,

  version: `${CLI} version
  ${CLI} --version
  ${CLI} -v

  Show the installed gtfs-tools version.`,

  update: `${CLI} update [flags]

  Update the globally installed CLI to the latest npm release.

  Flags:
    --check              Check the installed and latest versions without updating
    --dry-run            Alias for --check
    --force              Reinstall latest even when already current
    --provider <name>    Refresh the skill for a provider after updating
    --target-dir <dir>   Override the refreshed skill directory

  Examples:
    ${CLI} update --check
    ${CLI} update
    ${CLI} update --provider openai`,

  station: `${CLI} station <name|id> [flags]

  Show station info in the dashboard, or print station data.

  Arguments:
    <name|id>               Station name or ID (positional)

  Flags:
    --station-id <id>       Select by exact ID
    --station-name <name>   Select by exact name
    --id <id>               Alias for --station-id
    --name <name>           Alias for --station-name
    --data                  Print rows instead of opening dashboard
    --format json           Output as JSON
    --view <view>           Dashboard view: info (default), map, table`,

  "stop-info": `${CLI} stop-info <name|id> [flags]

  Show stop in the dashboard map with popup, or print stop data.

  Arguments:
    <name|id>             Stop name or ID (positional)

  Flags:
    --stop-id <id>        Select by exact ID
    --stop-name <name>    Select by exact name
    --id <id>             Alias for --stop-id
    --name <name>         Alias for --stop-name
    --data                Print rows instead of opening dashboard
    --format json         Output as JSON
    --view <view>         Dashboard view: map (default), table`,

  station_connections: `${CLI} station_connections <name|id> [flags]

  Show station connection graph.

  Flags:
    --station-id <id>       Select by exact ID
    --id <id>               Alias for --station-id
    --data                  Print rows instead of opening dashboard
    --format json           Output as JSON
    --view <view>           Pathway view: flow (default), map, table, end`,

  station_pathways: `${CLI} station_pathways <name|id> [flags]

  Show station parts and pathways.

  Flags:
    --station-id <id>       Select station by exact ID
    --node-id <id>          Focus on a station part
    --stop-id <id>          Resolve a standalone stop
    --data                  Print rows instead of opening dashboard
    --format json           Output as JSON
    --view <view>           Pathway view: flow (default), map, table, end`,

  station_routes: `${CLI} station_routes <name|id> [flags]

  Show shortest-path routes between station parts.

  Flags:
    --station-id <id>          Select by exact ID
    --node-id <id>             Filter routes from/to a station part
    --time-interval <v>        Filter by time: <max> or <min,max> (seconds)
    --connection-type <type>   Filter by location type
    --data                     Print rows instead of opening dashboard
    --format json              Output as JSON`,

  station_shortest_route: `${CLI} station_shortest_route <name|id> [flags]

  Find the fastest entrance-to-exit route by time.

  Flags:
    --station-id <id>          Select by exact ID
    --data                     Print the route instead of opening dashboard
    --format json              Output as JSON`,

  edit_pathway: `${CLI} edit_pathway <name|id> [flags]

  Open the pathway edit form in the dashboard.

  Flags:
    --station-id <id>       Select station by exact ID
    --node-id <id>          Focus on a station part
    --data                  Print pathway data instead
    --view <view>           Pathway view: flow (default), map, table, end`,

  edit_stop: `${CLI} edit_stop <name|id> [flags]

  Open the stop/station-part edit form in the dashboard.

  Flags:
    --station-id <id>       Select station by exact ID
    --node-id <id>          Focus on a station part
    --stop-id <id>          Resolve a standalone stop
    --data                  Print stop data instead`,

  calendar: `${CLI} calendar [<service-id>] [flags]

  List services or show calendar data for a service. Opens dashboard by default.

  Filters:
    --service-id <id>       Service ID
    --service <id>          Alias for --service-id
    --route-id <id>         Filter by route ID
    --route <id>            Alias for --route-id

  Output:
    (default)               Open service view in dashboard
    --data                  Print rows in terminal
    --format json           JSON output

  Examples:
    ${CLI} calendar --data                        List all services
    ${CLI} calendar --route R1 --data             Services for route R1
    ${CLI} calendar SAT-1 --data                  Calendar for service SAT-1`,

  shapes: `${CLI} shapes [<shape-id>] [flags]

  List shapes or show shape points. Opens route map by default.

  Filters:
    --shape-id <id>         Shape ID
    --shape <id>            Alias for --shape-id
    --route-id <id>         Filter by route ID
    --route <id>            Alias for --route-id

  Output:
    (default)               Open route map in dashboard
    --data                  Print rows in terminal
    --format json           JSON output

  Examples:
    ${CLI} shapes --data                          List all shapes
    ${CLI} shapes --route R1 --data               Shapes for route R1
    ${CLI} shapes shape-123 --data                Points for shape-123`,

  "route-bands": `${CLI} route-bands [flags]

  Build the parallel route-line bands from the imported feed. Routes sharing a
  corridor are converged onto one centreline and assigned lateral lanes, written
  to RouteShapeBandsTable for the dashboard's Separate Route(s) view. Runs the
  DuckDB corridor macros (prepare_route_shape_lanes_* then
  refresh_route_shape_bands) against the local database.

  Flags:
    --status                Report the existing band counts without rebuilding
    --data                  Print band_rows, routes, widest_bundle as a row
    --format json           JSON output

  Examples:
    ${CLI} route-bands                             Build bands, print a summary
    ${CLI} route-bands --data                      Build bands, print counts
    ${CLI} route-bands --status --data             Report existing band counts`,

  edit_table: `${CLI} edit_table [table] [flags]

  Show edit tracking tables.

  Arguments:
    pathways              Show EditPathwayTable
    routes                Show EditRouteTable
    stops                 Show EditStopTable
    stop_times            Show EditStopTimesTable
    calendar              Show EditCalendarTable
    trips                 Show EditTripsTable
    (none)                Show all

  Flags:
    --format json         Output as JSON
    --url-only            Print the Edits & Export table-view URL
    --dashboard           Open Edits & Export in the dashboard
    --trips-page <n>      Open the trip edits table at page n
    --trips-page-size <n> Set trip edits page size: 10, 20, 30, or 50`,

  edits: `${CLI} edits [<trip-id>] [flags]

  Review pending edits by category or open Edits & Export.

  Flags:
    --trip <id>             Show one trip in terminal or expand it in category view
    --data                  Print categorized edits in terminal
    --format json           Print JSON data
    --dashboard             Open Edits & Export
    --url-only              Print the Edits & Export URL without opening it
    --view category         Open categorized edits (default)
    --view table            Open per-file edit tables
    --compare-view table    Open an expanded trip comparison as a table
    --compare-view map      Open an expanded reroute comparison on the map
    --trips-page <n>        Open the trip edits table at page n
    --trips-page-size <n>   Set trip edits page size: 10, 20, 30, or 50

  Examples:
    ${CLI} edits
    ${CLI} edits --url-only
    ${CLI} edits --trip trip-123 --compare-view map --url-only
    ${CLI} edits --view table --trips-page 3 --trips-page-size 20 --url-only`,

  reroute: `${CLI} reroute [flags]

  Replace a section of one trip with the stops from a donor trip.
  Donor schedule time does not need to overlap the affected trip. The shared
  boundaries must occur in the same order, and replacement times are fitted
  to the affected trip's boundary window.

  With only --trip, open that trip's reroute form. After a complete reroute,
  open the edited trip so the replaced stops are immediately visible.

  Flags:
    --trip <id>             Affected trip ID
    --via <id>              Donor trip ID
    --from <station>        Shared start boundary station
    --to <station>          Shared end boundary station
    --data                  Apply without opening the dashboard
    --url-only              Apply and print the edited trip URL without opening it

  Open form:
    ${CLI} reroute --trip <id>

  Apply:
    ${CLI} reroute --trip <id> --via <donor-id> --from "W 4 St-Wash Sq" --to "Jay St-MetroTech"

  Review:
    ${CLI} query --sql "SELECT * FROM get_trip_reroute_routes('trip-id')" --data
    ${CLI} edits --trip <id>
    ${CLI} edits --trip <id> --compare-view map --url-only
    ${CLI} trip <id> --compare <donor-id> --view map --url-only`,

  add_connection: `${CLI} add_connection [flags]

  Add a new pathway connection between two station parts.

  Flags:
    --from <stop_id>                 Source station part (required)
    --to <stop_id>                   Target station part (required)
    --pathway-mode <1-7>             Mode (default: 1 = walkway)
    --bidirectional                  Mark as bidirectional
    --traversal-time <seconds>       Traversal time
    --length <meters>                Length
    --stair-count <n>                Number of stairs
    --max-slope <ratio>              Max slope
    --min-width <meters>             Min width
    --signposted-as <text>           Signposted name
    --reversed-signposted-as <text>  Reversed signposted name
    --pathway-id <id>                Custom ID (auto-generated if omitted)`,

  update_connection: `${CLI} update_connection [flags]

  Update an existing pathway connection. Only provided flags change.

  Flags:
    --pathway-id <id>                Connection to update (required)
    --from <stop_id>                 New source
    --to <stop_id>                   New target
    --pathway-mode <1-7>             New mode
    --bidirectional                  Set bidirectional
    --traversal-time <seconds>       New traversal time
    --length <meters>                New length
    --stair-count <n>                New stair count
    --max-slope <ratio>              New max slope
    --min-width <meters>             New min width
    --signposted-as <text>           New signposted name
    --reversed-signposted-as <text>  New reversed signposted name`,

  delete_connection: `${CLI} delete_connection [flags]

  Delete a pathway connection.

  Flags:
    --pathway-id <id>    Connection to delete (required)`,

  add_node: `${CLI} add_node [flags]

  Add a new stop or station part.

  Flags:
    --stop-id <id>              Node ID (required)
    --stop-name <name>          Node name (defaults to stop-id)
    --lat <latitude>            Latitude (required)
    --lon <longitude>           Longitude (required)
    --location-type <type>      Type: Station, Stop, Exit/Entrance, Generic Node, Boarding Area
    --parent-station <id>       Parent station ID
    --level-id <id>             Level ID
    --wheelchair <status>       Wheelchair boarding status`,

  update_node: `${CLI} update_node [flags]

  Update an existing stop or station part. Only provided flags change.

  Flags:
    --stop-id <id>              Node to update (required)
    --stop-name <name>          New name
    --lat <latitude>            New latitude
    --lon <longitude>           New longitude
    --location-type <type>      New location type
    --parent-station <id>       New parent station
    --level-id <id>             New level ID
    --wheelchair <status>       New wheelchair status`,

  delete_node: `${CLI} delete_node [flags]

  Delete a stop or station part.

  Flags:
    --stop-id <id>    Node to delete (required)`,

  stations: `${CLI} stations [<id>] [flags]

  Browse stations, or select one by ID/name. Opens dashboard by default.

  Filters:
    --id <id>               Exact station ID
    --name <name>           Name (partial match)
    --wheelchair <status>   Wheelchair status emoji
    --pathways <status>     Pathways status emoji

  Output:
    (default)               Open in browser dashboard
    --data                  Print rows in terminal
    --format json           JSON output
    --url                   Open dashboard and print URL
    --url-only              Print URL without opening
    --view <view>           map (default), table`,

  stops: `${CLI} stops [<id>] [flags]

  Browse stops, or select one by ID/name. Opens dashboard by default.

  Filters:
    --id <id>               Exact stop ID
    --name <name>           Name (partial match)
    --wheelchair <status>   Wheelchair status emoji
    --location-type <type>  Location type

  Output:
    (default)               Open in browser dashboard
    --data                  Print rows in terminal
    --format json           JSON output
    --url                   Open dashboard and print URL
    --url-only              Print URL without opening
    --view <view>           map (default), table`,

  routes: `${CLI} routes [<id>] [flags]

  Browse routes, or select one by ID/name. Opens dashboard by default.

  Filters:
    --id <id>               Exact route ID
    --name <name>           Route name (partial match)
    --type <type>           Route type (name or number)

  Output:
    (default)               Open in browser dashboard
    --data                  Print rows in terminal
    --format json           JSON output
    --url                   Open dashboard and print URL
    --url-only              Print URL without opening
    --view <view>           Dashboard view (use -h with --view for details)

  Views:
    map                     Route shapes on map (default for list)
    table                   Tabular route list
    info                    Route details (default when --id given)
    service                 Trip/service schedule (use -h for subflags)`,

  "routes:service": `${CLI} routes --id <id> --view service [flags]
  ${CLI} route <name|id> --view service [flags]

  Show route service and trip schedule. Opens dashboard by default.

  Flags:
    --service-id <id>       Select a specific service
    --service <id>          Alias for --service-id
    --trip-id <id>          Select a specific trip
    --trip <id>             Alias for --trip-id
    --compare <t1,t2,...>   Compare trips side-by-side (max 5, with --data)
    --services-page <n>     Open the services table at page n
    --services-page-size <n> Set services page size: 10, 20, 30, or 50
    --service-trips-page <n> Open the selected service trips at page n
    --service-trips-page-size <n> Set service trips page size: 10, 20, 30, or 50
    --data                  Print service/trip data in terminal
    --format json           JSON output

  Examples:
    ${CLI} route "Red Line" service
    ${CLI} route "Red Line" --service weekday-1 --data
    ${CLI} route "Red Line" --trip trip-456 --data
    ${CLI} route "Red Line" --compare trip-1,trip-2 --data
    ${CLI} routes --id R1 --view service --format json`,

  route: `${CLI} route <name|id> [flags]

  Show route info in the dashboard, or print route data.

  Arguments:
    <name|id>               Route name or ID (positional)

  Flags:
    --data                  Print rows in terminal
    --format json           JSON output
    --view <view>           Dashboard view (use -h with --view for details)
    --service-id <id>       Select service (with --view service)
    --trip-id <id>          Select trip (with --view service)
    --compare <t1,t2,...>   Compare trips side-by-side (max 5, with --data)

  Views:
    info                    Route details (default)
    map                     Route on map
    table                   Tabular view
    service                 Trip/service schedule`,

  trips: `${CLI} trips [<trip-id>] [flags]

  List trips or show a single trip's stop times. Opens dashboard by default.

  Filters:
    --route-id <id>         Filter by route ID
    --route <id>            Alias for --route-id
    --service-id <id>       Filter by service ID
    --service <id>          Alias for --service-id
    --trip-id <id>          Show stop times for a specific trip
    --trip <id>             Alias for --trip-id

  Compare:
    --compare <t1,t2,...>   Compare trips side-by-side (max 5)

  Pagination:
    --page <n>              Open the trips table at page n
    --page-size <n>         Set page size: 10, 20, 30, or 50

  Views (dashboard mode):
    --view timetable        Stop times table (default)
    --view timeline         Time-based horizontal chart
    --view map              Stops on a map

  Output:
    (default)               Open trips view in dashboard
    --data                  Print rows in terminal
    --format json           JSON output

  Examples:
    ${CLI} trips --data                           List all trips
    ${CLI} trips --route R1 --data                Trips for route R1
    ${CLI} trips --route R1 --service SAT --data  Trips for route+service
    ${CLI} trips trip-123 --data                  Stop times for trip-123
    ${CLI} trips --compare t1,t2 --data           Compare stop times
    ${CLI} trips --compare t1,t2,t3               Compare trips in dashboard
    ${CLI} trips --compare t1,t2 --view map       Compare on map`,

  trip: `${CLI} trip <trip-id> [flags]

  Show trip stop times in the dashboard, or print trip data.

  Arguments:
    <trip-id>               Trip ID (positional, required)

  Flags:
    --data                  Print stop times in terminal
    --format json           JSON output
    --view <view>           Dashboard view or data mode
    --compare <t1,t2,...>   Compare with other trips (comma-separated)
    --page <n>              Open the trips table at page n
    --page-size <n>         Set page size: 10, 20, 30, or 50

  Views:
    timetable               Stop times table (default)
    timeline                Time-based horizontal chart
    map                     Stops on a map
    info                    Trip metadata (with --data)

  Examples:
    ${CLI} trip trip-123                              Open in dashboard
    ${CLI} trip trip-123 --view timeline               Open timeline view
    ${CLI} trip trip-123 --view map                    Open map view
    ${CLI} trip trip-123 --compare trip-456            Compare two trips
    ${CLI} trip trip-123 --compare trip-456 --view map Compare on map
    ${CLI} trip trip-123 --data                        Print stop times
    ${CLI} trip trip-123 --data --view info            Print trip metadata
    ${CLI} trip trip-123 --compare trip-456 --data     Compare stop times`,

  query: `${CLI} query [flags]

  Run SQL or a named query against the local DuckDB database.

  Flags:
    --sql <sql>             Raw SQL to execute
    --name <name>           Named query to execute
    --args-json <json>      JSON arguments for named queries
    --data                  Print rows (for named queries with dashboard routes)
    --format json           Output as JSON

  Named queries: stations, stops, station-info, station-stops,
    station-pathways, station-connections, pathway-aggregates,
    station-routes, routes, route-info, route-stops, route-stations,
    route-shapes, station-service-routes, stop-service-routes,
    edit-pathways, edit-stops`,

  view: `${CLI} view [flags]

  Open a dashboard view in the browser.

  Flags:
    --view <page>           Dashboard view (default: auto)
    --station-id <id>       Select a station
    --stop-id <id>          Select a stop
    --map-focus <v>         Map center: lat,lon,zoom
    --node-id <id>          Focus on a station part
    --page <n>              Table page
    --page-size <n>         Table page size: 10, 20, 30, or 50

  Views: auto, routes/map, routes/table, routes/info, routes/service,
    stations/info, stations/map, stations/table,
    stations/pathways/flow/radial, stations/pathways/map/directional,
    stations/pathways/table/start, stations/pathways/table/end,
    stops/map, stops/table, trips/table, export`,

  stop: `${CLI} stop

  Stop the dashboard daemon and clear session metadata. Imported data remains available.`,

  restart: `${CLI} restart

  Stop the dashboard daemon and remove the local DuckDB/feed import.
  Run ${IMPORT_USAGE} again before opening dashboard views.`,

  clean: `${CLI} clean

  Stop the dashboard daemon and remove all imported data and session metadata.`,
};

const commandAliases: Record<string, string> = {
  "route_bands": "route-bands",
  "station-connections": "station_connections",
  "station-pathways": "station_pathways",
  "station-routes": "station_routes",
  "station-shortest-route": "station_shortest_route",
  pathways: "station_pathways",
  "shortest-route": "station_shortest_route",
  "edit-pathway": "edit_pathway",
  "edit-stop": "edit_stop",
  "edit-table": "edit_table",
  "add-connection": "add_connection",
  "update-connection": "update_connection",
  "delete-connection": "delete_connection",
  "add-node": "add_node",
  "update-node": "update_node",
  "delete-node": "delete_node",
  stop_info: "stop-info",
  open: "view",
  dashboard: "view",
  "route:service": "routes:service",
  "route:map": "routes",
  "route:table": "routes",
  "route:info": "route",
  "self-update": "update",
};

export const printCommandHelp = (command: string): boolean => {
  const canonical = commandAliases[command] ?? command;
  const help = commandHelp[canonical];
  if (help) {
    console.log(help);
    return true;
  }
  return false;
};

export const printHelp = () => {
  console.log(`Usage: ${CLI} <command> [flags]

Start with ${IMPORT_USAGE}, then ${CLI} status. ${CLI} examples lists more.

Import & Status:
  import <feed.zip|https://…|s3://…|r2://…>
                                     Import a GTFS zip (local, URL or bucket) into local DuckDB
  status                             Show dataset info and session state
  tables                             List available DuckDB tables

Data:
  stations [filters]                 Browse/lookup stations
  stops [filters]                    Browse/lookup stops
  routes [filters]                   Browse/lookup routes
  trips [filters]                    Browse/lookup trips and stop times
  trip <trip-id>                     View trip stop times
  calendar [service-id]              Browse services/calendar
  shapes [shape-id]                  Browse route shapes
  route-bands [--status]             Build parallel route-line bands (Separate Route(s))

Edit:
  edit_table [table]                 Show edit tracking tables
  edits [--trip --view --url-only]   Review categorized edits or open Edits & Export
  reroute [--trip --via --from --to] Reroute a trip through donor stops
  export [--output --force]          Export the merged GTFS files

Query:
  query --sql <sql>                  Run SQL
  query --name <name> [--data]       Named query

Session:
  view [--view <page>]               Open dashboard view
  stop                               Stop dashboard session
  restart                            Stop session + remove local import
  clean                              Stop daemon + remove all data

Agent Skills:
  install-skill [provider]           Install the skill for an AI provider
  skill-path                         Print the packaged SKILL.md path

Version & Updates:
  version                            Show the installed CLI version
  update [--check]                   Update the CLI to the latest npm release

DuckDB memory:
  GTFS_VIZ_DUCKDB_THREADS            Override the reduced worker count
  GTFS_VIZ_DUCKDB_MEMORY_LIMIT       Override the host-aware memory cap
  GTFS_VIZ_DUCKDB_TEMP_DIRECTORY     Override the persistent spill directory

Help:
  h [command]                        Show general or command-specific help
  help [command]                     Same as h

Global flags: -v, --version, --data, --format json, --url-only, --view <view>
Run ${CLI} h <command>, ${CLI} help <command>, or ${CLI} <command> -h for details.`);
};

export const printExamples = () => {
  console.log(`Import & browse:
  ${CLI} import /path/to/feed.zip
  ${CLI} import https://example.com/gtfs/feed.zip
  ${CLI} import s3://my-bucket/gtfs/feed.zip
  ${CLI} status
  ${CLI} stations
  ${CLI} stations --name "Park" --pathways "✅"
  ${CLI} stations --format json
  ${CLI} stops --name "Albany"
  ${CLI} routes --type Bus
  ${CLI} route "Red Line"
  ${CLI} trips --route R1 --data
  ${CLI} trip trip-123 --data

Lookup & dashboard:
  ${CLI} station "Park Street"
  ${CLI} station --id place-pktrm --data
  ${CLI} stop-info --stop-id 10011
  ${CLI} route --id Red --data
  ${CLI} stations --view map
  ${CLI} route "Red Line" --view service --data
  ${CLI} view --view stops/map --map-focus 42.355,-71.06,12

Pathways & routes:
  ${CLI} station_connections "Park Street" --data
  ${CLI} station_pathways place-pktrm --node-id node-pktrm-stair7-gl --data
  ${CLI} station_routes "South Station" --data --time-interval 60
  ${CLI} station_routes "South Station" --data --connection-type "Exit/Entrance"
  ${CLI} station_shortest_route "South Station" --data

Edit connections:
  ${CLI} add_connection --from node-lobby --to node-platform --traversal-time 45
  ${CLI} add_connection --from door-1 --to node-lobby --bidirectional --pathway-mode 2
  ${CLI} update_connection --pathway-id pw-123 --traversal-time 60
  ${CLI} delete_connection --pathway-id pw-123

Edit nodes:
  ${CLI} add_node --stop-id door-new --stop-name "New Entrance" --lat 42.35 --lon -71.06 --location-type "Exit/Entrance" --parent-station place-pktrm
  ${CLI} update_node --stop-id door-new --stop-name "Main Entrance"
  ${CLI} delete_node --stop-id door-new
  ${CLI} edit_table
  ${CLI} edits --url-only
  ${CLI} edits --trip trip-123 --compare-view map --url-only
  ${CLI} edits --view table --trips-page 3 --trips-page-size 20 --url-only

Export:
  ${CLI} export
  ${CLI} export --output ./exported --no-pathways --no-routes
  ${CLI} export --force

SQL:
  ${CLI} query --sql "SELECT * FROM StationsTable"
  ${CLI} query --sql "SELECT * FROM get_station_stops('place-pktrm')"
  ${CLI} query --name station-info --args-json '{"stationId":"place-pktrm"}' --data

Cleanup:
  ${CLI} stop
  ${CLI} restart
  ${CLI} clean

Agent skills and help:
  ${CLI} --version
  ${CLI} update --check
  ${CLI} update
  ${CLI} install-skill --list-providers
  ${CLI} install-skill openai
  ${CLI} h install-skill
  ${CLI} h reroute
  ${CLI} h edits`);
};
