# Native framework baselines

This directory is reserved for hand-written framework-native implementations
used by RQ5. A baseline must:

1. implement exactly one versioned benchmark scenario;
2. use the same deterministic fake model and tools as generated code;
3. emit the normalized trace event schema defined by the runtime study;
4. document framework and dependency versions;
5. avoid GEAR runtime or generated-code imports;
6. pass the same topology and data-flow oracle as its generated counterpart.

The executable native baseline is implemented in
`runners/runtime_fidelity.py`. It interprets the GEAR graph directly without
using generated source or connector code. This deliberately small reference
engine provides an independent trace for the same oracle; it is not presented
as an idiomatic hand-written application for every framework.

Framework-specific hand-written baselines remain required for the later
real-runtime study. Keeping those separate prevents contract-double evidence
from being misreported as full runtime compatibility.
