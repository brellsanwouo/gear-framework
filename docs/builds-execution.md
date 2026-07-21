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

## MLflow observability

Set a remote tracking server to record every Studio execution in MLflow:

```dotenv
MLFLOW_TRACKING_URI=http://mlflow.internal:5000
GEAR_MLFLOW_ENABLED=true
MLFLOW_EXPERIMENT_NAME=gear-framework-production
MLFLOW_HTTP_REQUEST_TIMEOUT=5
MLFLOW_HTTP_REQUEST_MAX_RETRIES=1
```

Each MLflow run records the GEAR build ID, target framework, success status,
duration, return code, output sizes, and bounded stdout/stderr artifacts. Set
`GEAR_MLFLOW_LOG_OUTPUTS=false` when execution output must not leave the
application host. MLflow failures are logged by GEAR but do not interrupt the
user workflow.
