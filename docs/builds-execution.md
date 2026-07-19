# Build and execution

## Generate both targets

```bash
gear validate examples/minimal.gear.yml
gear convert examples/minimal.gear.yml --all-targets --output dist
```

Conversion is transactional from a validation perspective: every target is preflighted before artifacts are written. A blocking error cancels the entire command.

See [Convert a GEAR project](/conversion) for detailed behavior and artifact paths.

For one target:

```bash
gear convert examples/minimal.gear.yml --target crewai --output dist
```

## History

Each build receives an ID and stores its target, status, conversion report, and artifacts in `.gear/gear.db`.

```bash
gear builds list
gear builds show <build-id>
```

## Run

```bash
gear run <build-id>
```

Standard output, errors, return code, duration, and optional trace ID remain correlated with the build.

```bash
gear logs list
gear logs show <run-id>
```

The Studio exposes the same information in its Console tab and recent history.
