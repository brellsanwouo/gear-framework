# Generated results

Benchmark outputs are written below this directory and ignored by Git. For a
paper or archival artifact, copy the complete selected run into a versioned
release and publish its checksum. `raw.json` is the source of truth;
`summary.json`, `summary.md`, and CSV files are derived views.

The static runner writes conversion coverage for the 18-system corpus and a
scalability table for validation and all ten connectors. Each scale observation
includes latency, generated output bytes, success/error state, and sampled peak
resident memory. Quick-profile results are diagnostics only; publication must
use the 30-repetition full profile.

The RQ5 runner writes `runtime-raw.json`, `runtime-summary.json`,
`runtime-summary.md`, and `runtime-records.csv` in a separate result directory.
Its `mode` field must remain visible whenever contract-double results are cited.

The pinned-runtime runner writes `real-runtime-raw.json`,
`real-runtime-summary.json`, `real-runtime-summary.md`, and
`real-runtime-records.csv`. Results collected with
`version_mismatch_allowed: true` are development diagnostics and must not be
used in a publication.
