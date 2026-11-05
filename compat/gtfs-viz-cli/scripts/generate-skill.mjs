#!/usr/bin/env node
/**
 * Generates skills/gtfs-viz/ in this compatibility package from the repository's skills/gtfs-tools/ (run by
 * `prepack`, so `npm pack` and `npm publish` of compat/gtfs-viz-cli always ship a fresh copy). The output is
 * not committed.
 *
 * Why: gtfs-viz-cli 1.5.x's own `gtfs-viz update --provider <p>` installs the new version, then, still running
 * the old code, deletes the installed `gtfs-viz` skill and copies `<this package>/skills/gtfs-viz` in its place.
 * Without this directory that copy fails and the user is left with no skill.
 *
 * The copy is the gtfs-tools skill with `name: gtfs-viz` and one note line saying the skill is now gtfs-tools;
 * every other byte, and every reference file, is the same.
 */
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const compatRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sourceDir = path.resolve(compatRoot, "..", "..", "skills", "gtfs-tools");
export const targetDir = path.join(compatRoot, "skills", "gtfs-viz");

export const renamedNote =
  "> This skill is now called `gtfs-tools`. This `gtfs-viz` copy keeps upgrades from `@gabrielahn/gtfs-viz-cli` 1.5.x working; run `gtfs-viz install-skill <provider>` to install `gtfs-tools`, then delete this directory.";

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const NAME_LINE = /^name: gtfs-tools$/m;

// The gtfs-tools SKILL.md as the gtfs-viz skill: the name changes and the note follows the frontmatter.
export const toCompatSkillMd = (skillMd) => {
  const match = FRONTMATTER.exec(skillMd);
  if (!match) throw new Error("skills/gtfs-tools/SKILL.md has no YAML frontmatter");
  if (!NAME_LINE.test(match[1])) throw new Error("skills/gtfs-tools/SKILL.md frontmatter has no `name: gtfs-tools` line");
  const frontmatter = match[1].replace(NAME_LINE, "name: gtfs-viz");
  return `---\n${frontmatter}\n---\n\n${renamedNote}\n${skillMd.slice(match[0].length)}`;
};

export const generateCompatSkill = async ({ from = sourceDir, to = targetDir } = {}) => {
  const skillMd = await readFile(path.join(from, "SKILL.md"), "utf8");
  const compatSkillMd = toCompatSkillMd(skillMd);
  await rm(to, { recursive: true, force: true });
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, { recursive: true });
  await writeFile(path.join(to, "SKILL.md"), compatSkillMd);
  return to;
};

const invokedAsScript = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  // stderr: npm passes lifecycle output through, and `npm pack --json` must stay valid JSON on stdout.
  generateCompatSkill().then(
    (to) => console.error(`Generated ${path.relative(process.cwd(), to) || to} from skills/gtfs-tools`),
    (error) => {
      console.error(`generate-skill: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
