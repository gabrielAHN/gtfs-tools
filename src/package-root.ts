import path from "node:path";
import { fileURLToPath } from "node:url";

// The installed @gabrielahn/gtfs-tools directory (package.json, dist/, dashboard/, skills/): the parent of
// the directory holding this module, which is dist/ in the bundle (dist/index.js) and .tsc-out/ in a tsc
// build. It comes from this file, not process.argv[1], so it is right however the bin is reached (an npm bin
// symlink, a shim or `node <path>`).
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
