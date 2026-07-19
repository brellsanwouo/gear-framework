# FAQ

## Do I need to write the entire project in YAML?

No. The Studio provides forms for common properties. YAML remains available for advanced settings and precise editing.

## Where can I find conversion and execution logs?

Open Build history in the Studio or use `gear builds list` and `gear logs list`. Records are stored in `.gear/gear.db` by default.

## Can I run generated code outside the Studio?

Yes. Download the generated Python script, install the target dependencies, and run it locally with the required environment variables.

## How do I convert a project to a framework?

Use `gear convert project.gear.yml --target <identifier>`, omit the option to use `project.targets`, or pass `--all-targets`. Run `gear connectors list` to see installed identifiers. Scripts are created under `dist/<project>/<target>/orchestration.py`. See the [conversion guide](/conversion).

## Why can a build be blocked?

A validation error usually indicates an unknown reference, duplicate identifier, or missing required configuration. Warnings often describe capability differences between GEAR and a target.

## How do I add a framework?

Start from `connectors/frameworks/_template`, register the connector in `connectors/registry.yml`, then add its mappings and assembly plugin.
