# Expected traces

`topology.yml` is a source-level oracle declared independently from connector
output. The static benchmark verifies that each input still matches this oracle
before collecting conversion data.

`runtime.yml` is the RQ5 orchestration oracle. It declares invocation counts,
completion-before-start constraints, required data sources, parallel groups,
and the terminal agent. Agent invocations use stable occurrence tokens such as
`Writer#2`.

Runtime trace oracles for RQ5 will extend each scenario with constraints rather
than a single total event order. This is necessary because legal parallel
executions can interleave differently. Each oracle will declare:

- required logical nodes and event types;
- predecessor constraints and fan-in barriers;
- allowed iteration interval for loop nodes;
- expected terminal node and data-flow digest relation;
- forbidden events, such as a node starting before all dependencies complete.

Do not derive these constraints from a connector's observed trace. Both native
baselines and generated implementations are compared with the same oracle.

The first RQ5 implementation uses framework-contract doubles. It executes the
generated orchestration while replacing model/runtime calls with deterministic
local APIs. This proves properties of generated control and data flow, not
compatibility with a particular installed framework release. Real-runtime
compatibility is evaluated in a separate pinned layer covering all ten
connectors; it preserves each framework's agent and orchestration runtime while
replacing only the remote model/provider extension point.
