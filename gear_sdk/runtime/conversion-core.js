(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GearConversionCore = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const diagnostic = (code, severity, message, path = "") => ({ code, severity, message, path });

  const nonEmptyString = (value) => (value === null || value === undefined ? "" : String(value).trim());

  const asStringList = (value) => {
    if (Array.isArray(value)) return value.map(nonEmptyString).filter(Boolean);
    const text = nonEmptyString(value);
    return text ? text.split(",").map((item) => item.trim()).filter(Boolean) : [];
  };

  const workflowRoot = (workflowYaml) => {
    if (!workflowYaml || typeof workflowYaml !== "object") return {};
    return workflowYaml.GearMultiAgent && typeof workflowYaml.GearMultiAgent === "object"
      ? workflowYaml.GearMultiAgent
      : workflowYaml;
  };

  const normalizeEdges = (workflow) => {
    const candidates = workflow.Edges || workflow.Workflow?.Edges || workflow.Orchestration?.Edges || [];
    if (!Array.isArray(candidates)) return [];
    return candidates
      .map((edge, index) => ({
        from: nonEmptyString(edge?.From ?? edge?.FromNode ?? edge?.from),
        to: nonEmptyString(edge?.To ?? edge?.ToNode ?? edge?.to),
        index,
      }))
      .filter((edge) => edge.from || edge.to);
  };

  const moduleFromSource = (source, index) => {
    const name = nonEmptyString(source?.ModuleName) || `Module ${index + 1}`;
    const parallel = source?.Strategy?.Parallel;
    const loop = source?.Strategy?.Loop;
    if (parallel && typeof parallel === "object") {
      return {
        id: name,
        name,
        strategy: "parallel",
        agentRefs: asStringList(parallel.ParallelAgents),
        aggregator: nonEmptyString(parallel.Aggregator),
        source,
      };
    }
    if (loop && typeof loop === "object") {
      const parsedIterations = Number(loop.TurnCount);
      return {
        id: name,
        name,
        strategy: "loop",
        agentRefs: asStringList(loop.LoopAgents),
        maxIterations: Number.isFinite(parsedIterations) ? parsedIterations : null,
        stopCondition: nonEmptyString(loop.StopCondition),
        source,
      };
    }
    return { id: name, name, strategy: null, agentRefs: [], source };
  };

  const stableTopologicalLayers = (nodes, edges, diagnostics) => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const indegree = new Map(nodes.map((node) => [node.id, 0]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    edges.forEach((edge) => {
      if (!byId.has(edge.from) || !byId.has(edge.to)) return;
      outgoing.get(edge.from).push(edge.to);
      indegree.set(edge.to, indegree.get(edge.to) + 1);
    });

    const indexById = new Map(nodes.map((node, index) => [node.id, index]));
    let ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
    const layers = [];
    const visited = new Set();
    while (ready.length) {
      ready.sort((a, b) => indexById.get(a) - indexById.get(b));
      const layer = ready;
      layers.push(layer);
      ready = [];
      layer.forEach((id) => {
        visited.add(id);
        outgoing.get(id).forEach((target) => {
          indegree.set(target, indegree.get(target) - 1);
          if (indegree.get(target) === 0) ready.push(target);
        });
      });
    }
    if (visited.size !== nodes.length) {
      const cyclic = nodes.filter((node) => !visited.has(node.id)).map((node) => node.id);
      diagnostics.push(
        diagnostic(
          "GEAR-WORKFLOW-CYCLE",
          "error",
          `Workflow cycle detected outside an explicit loop module: ${cyclic.join(", ")}.`,
          "workflow.edges",
        ),
      );
    }
    return layers;
  };

  const buildGearIR = (input = {}) => {
    const diagnostics = [];
    const sourceAgents = Array.isArray(input.gearAgents) ? input.gearAgents : [];
    const sourceModules = Array.isArray(input.gearModules) ? input.gearModules : [];
    const sourceWorkflow = workflowRoot(input.workflowYaml || {});
    const rawItems = Array.isArray(input.workflowItems) ? input.workflowItems : [];
    const configuredItems = sourceWorkflow.Items && typeof sourceWorkflow.Items === "object" ? sourceWorkflow.Items : {};
    const requestedModuleRefs = new Set([
      ...rawItems.filter((item) => item?.type === "module").map((item) => nonEmptyString(item.label ?? item.id)),
      ...asStringList(configuredItems.Modules),
    ]);

    const agents = sourceAgents.map((source, index) => {
      const name = nonEmptyString(source?.AgentIdentity?.Name);
      if (!name) {
        diagnostics.push(
          diagnostic("GEAR-AGENT-NAME", "error", `Agent ${index + 1} has no name.`, `agents[${index}].name`),
        );
      }
      return { id: name || `agent_${index + 1}`, name: name || `agent_${index + 1}`, source };
    });
    const modules = sourceModules.map(moduleFromSource);

    const duplicateIds = (items, kind) => {
      const seen = new Set();
      items.forEach((item) => {
        if (seen.has(item.id)) {
          diagnostics.push(
            diagnostic(`GEAR-${kind.toUpperCase()}-DUPLICATE`, "error", `Duplicate ${kind} identifier: ${item.id}.`),
          );
        }
        seen.add(item.id);
      });
    };
    duplicateIds(agents, "agent");
    duplicateIds(modules, "module");

    const agentIds = new Set(agents.map((agent) => agent.id));
    modules.forEach((module) => {
      const selected = requestedModuleRefs.has(module.id);
      if (!module.strategy) {
        diagnostics.push(
          diagnostic(
            "GEAR-MODULE-STRATEGY",
            selected ? "error" : "warning",
            `Module ${module.name} has no supported strategy${selected ? "" : " and was ignored because it is not used by the workflow"}.`,
            module.name,
          ),
        );
      }
      module.agentRefs.forEach((ref) => {
        if (!agentIds.has(ref)) {
          diagnostics.push(
            diagnostic(
              "GEAR-MODULE-UNKNOWN-AGENT",
              selected ? "error" : "warning",
              `Module ${module.name} references unknown agent ${ref}.`,
              module.name,
            ),
          );
        }
      });
      if (module.aggregator && !agentIds.has(module.aggregator)) {
        diagnostics.push(
          diagnostic(
            "GEAR-MODULE-UNKNOWN-AGGREGATOR",
            selected ? "error" : "warning",
            `Module ${module.name} references unknown aggregator ${module.aggregator}.`,
            module.name,
          ),
        );
      }
    });

    const moduleIds = new Set(modules.map((module) => module.id));
    const fallbackItems = [
      ...asStringList(configuredItems.Agents).map((id) => ({ id, label: id, type: "agent" })),
      ...asStringList(configuredItems.Modules).map((id) => ({ id, label: id, type: "module" })),
    ];
    const selectedItems = rawItems.length ? rawItems : fallbackItems;
    const nodes = selectedItems.map((item, index) => ({
      id: nonEmptyString(item?.id) || `node_${index + 1}`,
      ref: nonEmptyString(item?.label ?? item?.ref ?? item?.id),
      type: item?.type === "module" ? "module" : "agent",
      index,
    }));
    duplicateIds(nodes, "workflow-node");

    nodes.forEach((node) => {
      const refs = node.type === "module" ? moduleIds : agentIds;
      if (!refs.has(node.ref)) {
        diagnostics.push(
          diagnostic(
            "GEAR-WORKFLOW-UNKNOWN-REF",
            "error",
            `Workflow node ${node.id} references unknown ${node.type} ${node.ref}.`,
            `workflow.nodes.${node.id}`,
          ),
        );
      }
    });

    const aliases = new Map();
    nodes.forEach((node) => {
      new Set([node.id, node.ref]).forEach((alias) => {
        if (!aliases.has(alias)) aliases.set(alias, []);
        aliases.get(alias).push(node.id);
      });
    });
    const resolveNode = (ref, edgeIndex, side) => {
      const matches = aliases.get(ref) || [];
      if (matches.length === 1) return matches[0];
      diagnostics.push(
        diagnostic(
          matches.length ? "GEAR-WORKFLOW-AMBIGUOUS-EDGE" : "GEAR-WORKFLOW-UNKNOWN-EDGE",
          "error",
          matches.length
            ? `Edge ${edgeIndex + 1} uses ambiguous ${side} reference ${ref}. Use the workflow node id.`
            : `Edge ${edgeIndex + 1} uses unknown ${side} reference ${ref}.`,
          `workflow.edges[${edgeIndex}].${side}`,
        ),
      );
      return null;
    };

    let rawEdges = normalizeEdges(sourceWorkflow);
    if (!rawEdges.length && nodes.length > 1) {
      rawEdges = nodes.slice(0, -1).map((node, index) => ({ from: node.id, to: nodes[index + 1].id, index }));
      diagnostics.push(
        diagnostic(
          "GEAR-WORKFLOW-DEFAULT-ORDER",
          "info",
          "No edges were supplied; workflow item order was compiled as a sequential chain.",
          "workflow.edges",
        ),
      );
    }
    const edges = rawEdges
      .map((edge, index) => ({
        from: resolveNode(edge.from, index, "from"),
        to: resolveNode(edge.to, index, "to"),
      }))
      .filter((edge) => edge.from && edge.to);
    const layers = stableTopologicalLayers(nodes, edges, diagnostics);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const executionLayers = layers.map((layer) => layer.map((id) => nodeById.get(id)));
    const executionOrder = executionLayers.flat();

    return {
      version: "1.0",
      agents,
      modules,
      workflow: {
        name: nonEmptyString(sourceWorkflow.WorkflowName) || "RootWorkflow",
        memory: sourceWorkflow.Memory === true,
        nodes,
        edges,
        executionLayers,
        executionOrder,
      },
      sourceDocuments: [...sourceAgents, ...sourceModules, sourceWorkflow],
      diagnostics,
      valid: !diagnostics.some((item) => item.severity === "error"),
    };
  };

  const collectLeafPaths = (value, prefix = "", output = new Set()) => {
    if (Array.isArray(value)) {
      if (prefix && value.length === 0) output.add(prefix);
      value.forEach((item) => collectLeafPaths(item, prefix, output));
      return output;
    }
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length && prefix) output.add(prefix);
      entries.forEach(([key, child]) => collectLeafPaths(child, prefix ? `${prefix}.${key}` : key, output));
      return output;
    }
    if (prefix && value !== undefined && value !== null && value !== "") output.add(prefix);
    return output;
  };

  const createConversionReport = ({ frameworkId, gearIR, mappingEntries = [], consumedPaths = [], diagnostics = [] }) => {
    const activePaths = new Set();
    (gearIR?.sourceDocuments || []).forEach((document) => collectLeafPaths(document, "", activePaths));
    const consumed = new Set(consumedPaths);
    const mappingsBySource = new Map();
    mappingEntries.forEach((entry) => {
      const sources = Array.isArray(entry?.from) ? entry.from : [entry?.from];
      sources.filter(Boolean).forEach((source) => {
        if (!mappingsBySource.has(source)) mappingsBySource.set(source, []);
        mappingsBySource.get(source).push(entry);
      });
    });

    const properties = Array.from(activePaths).sort().map((source) => {
      const sourceParts = source.split(".");
      let entries = [];
      for (let size = sourceParts.length; size > 0 && !entries.length; size -= 1) {
        entries = mappingsBySource.get(sourceParts.slice(0, size).join(".")) || [];
      }
      const supported = entries.find((entry) => entry.kind !== "not_mapped" && entry.to);
      const unsupported = entries.find((entry) => entry.kind === "not_mapped" || !entry.to);
      if (consumed.has(source)) {
        const fidelity = supported?.kind === "partial" ? "adapted" : supported?.kind === "equivalent" ? "equivalent" : "exact";
        return { source, target: supported?.to || null, status: fidelity, consumed: true, notes: supported?.notes || null };
      }
      if (unsupported) {
        return { source, target: null, status: "unsupported", consumed: false, notes: unsupported.notes || null };
      }
      if (supported) {
        return {
          source,
          target: supported.to,
          status: "dropped",
          consumed: false,
          notes: "A mapping exists, but the connector did not consume this property.",
        };
      }
      return { source, target: null, status: "unmapped", consumed: false, notes: "No mapping declared." };
    });
    const summary = properties.reduce(
      (acc, property) => {
        acc[property.status] = (acc[property.status] || 0) + 1;
        return acc;
      },
      {},
    );
    return {
      framework: frameworkId,
      ir_version: gearIR?.version || "unknown",
      valid: gearIR?.valid !== false && !diagnostics.some((item) => item.severity === "error"),
      summary,
      diagnostics: [...(gearIR?.diagnostics || []), ...diagnostics],
      properties,
    };
  };

  const mlflowBootstrap = (frameworkId) => [
    "# --- GEAR MLflow observability ---",
    "_gear_mlflow = None",
    "_gear_root_span = None",
    "_gear_root_context = None",
    "_gear_trace_closed = False",
    "",
    "def _gear_trace_value(value):",
    "    enabled = _gear_os.environ.get(\"GEAR_MLFLOW_LOG_OUTPUTS\", \"true\").strip().lower() in {\"1\", \"true\", \"yes\", \"on\"} if '_gear_os' in globals() else True",
    "    if not enabled:",
    "        return \"[redacted]\"",
    "    limit = int(_gear_os.environ.get(\"GEAR_MLFLOW_MAX_LOG_CHARS\", \"100000\")) if '_gear_os' in globals() else 100000",
    "    return str(value)[:limit]",
    "",
    "def _gear_trace_call(name, inputs, operation, attributes=None):",
    "    if _gear_mlflow is None or _gear_root_span is None:",
    "        return operation()",
    "    values = {str(key): str(value) for key, value in (attributes or {}).items()}",
    "    if _gear_mlflow.get_current_active_span() is None:",
    "        span = _gear_mlflow.start_span_no_context(name=name, span_type=\"AGENT\", parent_span=_gear_root_span, inputs={\"value\": _gear_trace_value(inputs)}, attributes=values)",
    "        try:",
    "            result = operation()",
    "            span.end(outputs={\"value\": _gear_trace_value(result)}, status=\"OK\")",
    "            return result",
    "        except Exception as error:",
    "            span.end(outputs={\"error\": _gear_trace_value(error)}, status=\"ERROR\")",
    "            raise",
    "    with _gear_mlflow.start_span(name=name, span_type=\"AGENT\", attributes=values) as span:",
    "        span.set_inputs({\"value\": _gear_trace_value(inputs)})",
    "        result = operation()",
    "        span.set_outputs({\"value\": _gear_trace_value(result)})",
    "        return result",
    "",
    "async def _gear_trace_async_call(name, inputs, operation, attributes=None):",
    "    if _gear_mlflow is None or _gear_root_span is None:",
    "        return await operation()",
    "    values = {str(key): str(value) for key, value in (attributes or {}).items()}",
    "    with _gear_mlflow.start_span(name=name, span_type=\"AGENT\", attributes=values) as span:",
    "        span.set_inputs({\"value\": _gear_trace_value(inputs)})",
    "        result = await operation()",
    "        span.set_outputs({\"value\": _gear_trace_value(result)})",
    "        return result",
    "",
    "try:",
    "    import atexit as _gear_atexit",
    "    import json as _gear_json",
    "    import os as _gear_os",
    "    import sys as _gear_sys",
    "    from dotenv import load_dotenv as _gear_load_dotenv",
    "    _gear_load_dotenv()",
    "    _gear_tracking_uri = _gear_os.environ.get(\"MLFLOW_TRACKING_URI\", \"\").strip()",
    "    _gear_mlflow_managed = _gear_os.environ.get(\"GEAR_MLFLOW_MANAGED\", \"\").strip().lower() in {\"1\", \"true\", \"yes\", \"on\"}",
    "    if _gear_tracking_uri:",
    `        if ${["adk", "microsoft-agent-framework"].includes(frameworkId) ? "True" : "False"}:`,
    "            _gear_os.environ[\"MLFLOW_USE_DEFAULT_TRACER_PROVIDER\"] = \"false\"",
    "        import mlflow as _gear_mlflow",
    "        _gear_mlflow.set_tracking_uri(_gear_tracking_uri)",
    "        _gear_experiment = _gear_mlflow.set_experiment(_gear_os.environ.get(\"MLFLOW_EXPERIMENT_NAME\", \"gear-framework-generated\"))",
    `        if ${["adk", "microsoft-agent-framework"].includes(frameworkId) ? "True" : "False"}:`,
    "            from mlflow.entities import MlflowExperimentLocation as _GearExperimentLocation",
    "            _gear_mlflow.tracing.set_destination(_GearExperimentLocation(_gear_experiment.experiment_id))",
    `        _gear_tags = {\"gear.source\": \"generated-code\", \"gear.target\": ${JSON.stringify(frameworkId)}, \"gear.user_id\": _gear_os.environ.get(\"GEAR_PARTICIPANT_ID\", \"\"), \"gear.session_id\": _gear_os.environ.get(\"GEAR_SESSION_ID\", \"\"), \"gear.project_id\": _gear_os.environ.get(\"GEAR_PROJECT_ID\", \"\"), \"gear.build_id\": _gear_os.environ.get(\"GEAR_BUILD_ID\", \"\")}`,
    "        if not _gear_mlflow_managed:",
    `            _gear_mlflow.start_run(run_name=${JSON.stringify(`gear-${frameworkId}`)})`,
    "            _gear_mlflow.set_tags(_gear_tags)",
    "            _gear_atexit.register(_gear_mlflow.end_run)",
    `        _gear_integration = ${JSON.stringify({ crewai: "crewai", langgraph: "langchain", "openai-agents": "openai", strands: "strands", "pydantic-ai": "pydantic_ai", autogen: "autogen", "semantic-kernel": "semantic_kernel", haystack: "haystack" })}.get(${JSON.stringify(frameworkId)})`,
    "        if _gear_integration:",
    "            try:",
    "                getattr(_gear_mlflow, _gear_integration).autolog()",
    "            except Exception as _gear_autolog_error:",
    "                print(f\"MLflow native tracing unavailable: {_gear_autolog_error}\", file=_gear_sys.stderr)",
    `        _gear_model_integration = ${JSON.stringify({ crewai: "litellm", adk: "litellm" })}.get(${JSON.stringify(frameworkId)})`,
    "        if _gear_model_integration:",
    "            try:",
    "                getattr(_gear_mlflow, _gear_model_integration).autolog()",
    "            except Exception as _gear_model_autolog_error:",
    "                print(f\"MLflow model tracing unavailable: {_gear_model_autolog_error}\", file=_gear_sys.stderr)",
    `        _gear_root_context = _gear_mlflow.start_span(name=${JSON.stringify(`gear.workflow.${frameworkId}`)}, span_type="CHAIN", attributes=_gear_tags)`,
    "        _gear_root_span = _gear_root_context.__enter__()",
    "        _gear_root_span.set_inputs({\"prompt\": _gear_trace_value(_gear_os.environ.get(\"GEAR_INPUT\", \"Run the configured Gear workflow.\"))})",
    "        _gear_mlflow.update_current_trace(tags=_gear_tags)",
    `        if ${frameworkId === "adk" ? "True" : "False"}:`,
    "            from opentelemetry import trace as _gear_otel_trace",
    "            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as _GearOTLPSpanExporter",
    "            from opentelemetry.sdk.trace import TracerProvider as _GearTracerProvider",
    "            from opentelemetry.sdk.trace.export import SimpleSpanProcessor as _GearSimpleSpanProcessor",
    "            _gear_provider = _GearTracerProvider()",
    "            _gear_exporter = _GearOTLPSpanExporter(endpoint=f\"{_gear_tracking_uri.rstrip('/')}/v1/traces\", headers={\"x-mlflow-experiment-id\": _gear_experiment.experiment_id})",
    "            _gear_provider.add_span_processor(_GearSimpleSpanProcessor(_gear_exporter))",
    "            _gear_otel_trace.set_tracer_provider(_gear_provider)",
    `        if ${frameworkId === "microsoft-agent-framework" ? "True" : "False"}:`,
    "            from agent_framework.observability import setup_observability as _gear_setup_observability",
    "            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as _GearOTLPSpanExporter",
    "            _gear_exporter = _GearOTLPSpanExporter(endpoint=f\"{_gear_tracking_uri.rstrip('/')}/v1/traces\", headers={\"x-mlflow-experiment-id\": _gear_experiment.experiment_id})",
    "            _gear_setup_observability(enable_sensitive_data=True, exporters=[_gear_exporter])",
    "        _gear_sys.stderr.write(\"__GEAR_TRACE_START__\\n\" + _gear_json.dumps({\"trace_id\": _gear_root_span.trace_id}) + \"\\n__GEAR_TRACE_END__\\n\")",
    "        _gear_sys.stderr.flush()",
    "        def _gear_finish_trace(error=None):",
    "            global _gear_trace_closed",
    "            if _gear_trace_closed or _gear_root_context is None:",
    "                return",
    "            _gear_trace_closed = True",
    "            if error is not None:",
    "                _gear_root_span.set_outputs({\"error\": _gear_trace_value(error)})",
    "                _gear_root_span.set_status(\"ERROR\")",
    "            _gear_root_context.__exit__(None, None, None)",
    "            _gear_mlflow.flush_trace_async_logging()",
    "        _gear_original_excepthook = _gear_sys.excepthook",
    "        def _gear_excepthook(error_type, error, traceback):",
    "            _gear_finish_trace(error)",
    "            _gear_original_excepthook(error_type, error, traceback)",
    "        _gear_sys.excepthook = _gear_excepthook",
    "        _gear_atexit.register(_gear_finish_trace)",
    "except Exception as _gear_mlflow_error:",
    "    print(f\"MLflow observability unavailable: {_gear_mlflow_error}\", file=__import__(\"sys\").stderr)",
    "# --- End GEAR MLflow observability ---",
    "",
  ].join("\n");

  const instrumentPython = (source, frameworkId) => {
    if (typeof source !== "string" || source.includes("# --- GEAR MLflow observability ---")) return source;
    const lines = source.split("\n");
    let insertionIndex = lines[0]?.startsWith("#!") ? 1 : 0;
    while (lines[insertionIndex]?.startsWith("from __future__ import ")) insertionIndex += 1;
    while (insertionIndex < lines.length && (/^(?:from\s+\S+\s+import|import\s+)/.test(lines[insertionIndex]) || !lines[insertionIndex].trim())) insertionIndex += 1;
    lines.splice(insertionIndex, 0, mlflowBootstrap(nonEmptyString(frameworkId) || "unknown"));
    return lines.join("\n");
  };

  const instrumentResult = (result, frameworkId) => {
    if (!result?.outputs || typeof result.outputs.orchestration !== "string") return result;
    return {
      ...result,
      outputs: {
        ...result.outputs,
        orchestration: instrumentPython(result.outputs.orchestration, frameworkId),
      },
    };
  };

  return { buildGearIR, collectLeafPaths, createConversionReport, instrumentPython, instrumentResult };
});
