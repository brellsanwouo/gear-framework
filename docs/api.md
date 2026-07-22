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

The Studio sends `"async": true`. The server responds with HTTP 202 and a `job_id`, and `GET /api/run/jobs/<job_id>` returns HTTP 202 while the workflow is running followed by the JSON execution result. Jobs are isolated by participant identity and expire from the in-memory status registry after one hour; completed execution records remain in the regular history store.

## Builds and executions

The Studio build routes create persistent records. Prefer the CLI when you need a stable automation interface; the web routes primarily support the Studio.
