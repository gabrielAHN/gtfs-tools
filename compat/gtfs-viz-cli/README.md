# @gabrielahn/gtfs-viz-cli

Compatibility package for the GTFS command-line tools, which moved from
[gabrielAHN/gtfs-viz](https://github.com/gabrielAHN/gtfs-viz) to
[gabrielAHN/gtfs-tools](https://github.com/gabrielAHN/gtfs-tools) and are now published as
[`@gabrielahn/gtfs-tools`](https://www.npmjs.com/package/@gabrielahn/gtfs-tools) (command `gtfs-tools`).

This package installs the same CLI under its former command name, `gtfs-viz`:

```bash
npm install -g @gabrielahn/gtfs-viz-cli
gtfs-viz import ./feed.zip
gtfs-viz --version
```

- It depends on exactly the same version of `@gabrielahn/gtfs-tools` and has no code of its own beyond
  the `gtfs-viz` command, which runs the gtfs-tools CLI with `gtfs-viz` in its help and hints.
- `gtfs-viz` and `gtfs-tools` share the imported dataset (`~/.gtfs-viz-cli`), the dashboard daemon and
  the environment variables, so either command works on the same data.
- Install one of the two packages. To have both commands, install them in separate commands
  (`npm install -g @gabrielahn/gtfs-tools`, then `npm install -g @gabrielahn/gtfs-viz-cli`). Installed
  in one `npm install -g` command, npm shares one copy of `@gabrielahn/gtfs-tools` between them, and a
  later `npm uninstall -g @gabrielahn/gtfs-tools` breaks `gtfs-viz`.
- New installs should use `npm install -g @gabrielahn/gtfs-tools`. The agent skill is now `gtfs-tools`
  (`gtfs-viz install-skill <provider>` installs it).
- Upgrading from 1.5.x with its own `gtfs-viz update --provider <provider>` works: this package ships a
  `skills/gtfs-viz` copy of the `gtfs-tools` skill (same content, old name, a note that it was renamed)
  for the 1.5.x code to install. Run `gtfs-viz install-skill <provider>` afterwards to get `gtfs-tools`.

Docs: <https://gtfs-viz-production-f1a4.up.railway.app/docs/gtfs-tools/cli/>
