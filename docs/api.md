# HTTP API

The same Flask application serves the API and Studio.

## Product information

`GET /api/version` returns the GEAR and Studio versions used by the server:

```json
{
  "name": "gear-framework",
  "version": "0.2.0",
  "studio_version": "0.2.0"
}
```

## Local runner

`GET /api/run/status` reports whether local execution is enabled and its timeout. `POST /api/run` executes a generated artifact when the runner is enabled.

## Builds and executions

The Studio build routes create persistent records. Prefer the CLI when you need a stable automation interface; the web routes primarily support the Studio.
