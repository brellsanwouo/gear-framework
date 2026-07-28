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

  const traceMetadata = (gearIR) => {
    const agents = {};
    (gearIR?.agents || []).forEach((item) => {
      const source = item?.source || {};
      agents[item.name] = {
        purpose: nonEmptyString(source?.AgentIdentity?.Purpose),
        context: nonEmptyString(source?.AgentIdentity?.ContextDescription),
        task_name: nonEmptyString(source?.TaskSpecification?.TaskName),
        task: nonEmptyString(source?.TaskSpecification?.TaskDescription),
        expected_output: nonEmptyString(source?.TaskSpecification?.ExpectedOutput),
      };
    });
    return {
      workflow: {
        name: nonEmptyString(gearIR?.workflow?.name) || "GearWorkflow",
        agents: Object.keys(agents),
      },
      agents,
    };
  };

  const mlflowBootstrap = (frameworkId, metadata = {}) => [
    "# --- GEAR MLflow observability ---",
    "_gear_mlflow = None",
    "_gear_root_span = None",
    "_gear_root_context = None",
    "_gear_otel_provider = None",
    "_gear_trace_closed = False",
    `_gear_workflow_inputs = ${JSON.stringify(metadata.workflow || { name: "GearWorkflow", agents: [] })}`,
    `_gear_agent_tasks = ${JSON.stringify(metadata.agents || {})}`,
    "",
    "def _gear_trace_value(value):",
    "    enabled = _gear_os.environ.get(\"GEAR_MLFLOW_LOG_OUTPUTS\", \"true\").strip().lower() in {\"1\", \"true\", \"yes\", \"on\"} if '_gear_os' in globals() else True",
    "    if not enabled:",
    "        return \"[redacted]\"",
    "    limit = int(_gear_os.environ.get(\"GEAR_MLFLOW_MAX_LOG_CHARS\", \"100000\")) if '_gear_os' in globals() else 100000",
    "    return str(value)[:limit]",
    "",
    "def _gear_normalize_agent_name(value):",
    "    return ''.join(character if character.isalnum() else '_' for character in str(value)).strip('_').lower()",
    "",
    "def _gear_agent_task(name):",
    "    if name in _gear_agent_tasks:",
    "        return _gear_agent_tasks[name]",
    "    normalized = _gear_normalize_agent_name(name)",
    "    for candidate, task in _gear_agent_tasks.items():",
    "        if _gear_normalize_agent_name(candidate) == normalized:",
    "            return task",
    "    return next(iter(_gear_agent_tasks.values())) if len(_gear_agent_tasks) == 1 else {}",
    "",
    "def _gear_usage_mapping(value):",
    "    if value is None:",
    "        return {}",
    "    if isinstance(value, dict):",
    "        return value",
    "    for method_name in ('model_dump', 'dict'):",
    "        method = getattr(value, method_name, None)",
    "        if callable(method):",
    "            try:",
    "                mapped = method()",
    "                if isinstance(mapped, dict):",
    "                    return mapped",
    "            except Exception:",
    "                pass",
    "    try:",
    "        return vars(value)",
    "    except (TypeError, ValueError):",
    "        return {}",
    "",
    "def _gear_usage_int(value):",
    "    try:",
    "        return int(value) if value is not None else None",
    "    except (TypeError, ValueError):",
    "        return None",
    "",
    "def _gear_usage_from_result(value):",
    "    candidates = [getattr(value, 'usage_metrics', None), getattr(value, 'token_usage', None), value]",
    "    for candidate in candidates:",
    "        mapped = _gear_usage_mapping(candidate)",
    "        if not mapped:",
    "            continue",
    "        input_tokens = _gear_usage_int(mapped.get('input_tokens', mapped.get('prompt_tokens', mapped.get('prompt_token_count'))))",
    "        output_tokens = _gear_usage_int(mapped.get('output_tokens', mapped.get('completion_tokens', mapped.get('candidates_token_count'))))",
    "        total_tokens = _gear_usage_int(mapped.get('total_tokens', mapped.get('total_token_count')))",
    "        if total_tokens is None and input_tokens is not None and output_tokens is not None:",
    "            total_tokens = input_tokens + output_tokens",
    "        if input_tokens is None and output_tokens is None and total_tokens is None:",
    "            continue",
    "        usage = {'input_tokens': input_tokens or 0, 'output_tokens': output_tokens or 0, 'total_tokens': total_tokens or 0}",
    "        cached_tokens = _gear_usage_int(mapped.get('cached_prompt_tokens', mapped.get('cached_content_token_count')))",
    "        if cached_tokens is not None:",
    "            usage['cache_read_input_tokens'] = cached_tokens",
    "        return usage, _gear_usage_int(mapped.get('successful_requests'))",
    "    return None, None",
    "",
    "def _gear_model_and_provider(value):",
    "    if value is None:",
    "        return None, None",
    "    model = str(value).strip()",
    "    if not model:",
    "        return None, None",
    "    if '/' in model:",
    "        provider, model_name = model.split('/', 1)",
    "        if provider and model_name:",
    "            return model_name, provider",
    "    return model, None",
    "",
    "def _gear_apply_usage(span, usage, model=None, provider=None, call_count=None, source='framework-result'):",
    "    if span is None or not usage:",
    "        return False",
    "    span.set_attribute('mlflow.chat.tokenUsage', usage)",
    "    span.set_attribute('gear.usage_source', source)",
    "    if call_count is not None:",
    "        span.set_attribute('gear.llm.call_count', call_count)",
    "    normalized_model, inferred_provider = _gear_model_and_provider(model)",
    "    if normalized_model:",
    "        span.set_attribute('mlflow.llm.model', normalized_model)",
    "    selected_provider = provider or inferred_provider",
    "    if selected_provider:",
    "        span.set_attribute('mlflow.llm.provider', selected_provider)",
    "    return True",
    "",
    "def _gear_apply_result_usage(span, result, attributes=None):",
    "    usage, call_count = _gear_usage_from_result(result)",
    "    values = attributes or {}",
    "    model = values.get('mlflow.llm.model') or values.get('gen_ai.request.model')",
    "    provider = values.get('mlflow.llm.provider')",
    "    return _gear_apply_usage(span, usage, model=model, provider=provider, call_count=call_count, source='framework-result')",
    "",
    "def _gear_apply_root_usage(usage, model=None, provider=None, call_count=None, source='framework-events'):",
    "    normalized_usage, detected_calls = _gear_usage_from_result(usage)",
    "    return _gear_apply_usage(_gear_root_span, normalized_usage, model=model, provider=provider, call_count=call_count if call_count is not None else detected_calls, source=source)",
    "",
    "def _gear_trace_inputs(value, attributes=None):",
    "    agent_name = str((attributes or {}).get('gear.agent', ''))",
    "    task = {key: _gear_trace_value(item) for key, item in _gear_agent_task(agent_name).items() if item}",
    "    if isinstance(value, dict):",
    "        task.update({str(key): _gear_trace_value(item) for key, item in value.items()})",
    "    elif value not in (None, '', 'Run the configured Gear workflow.'):",
    "        task['prior_context'] = _gear_trace_value(value)",
    "    return task",
    "",
    "def _gear_trace_call(name, inputs, operation, attributes=None):",
    "    if _gear_mlflow is None or _gear_root_span is None:",
    "        return operation()",
    "    values = {str(key): str(value) for key, value in (attributes or {}).items()}",
    "    if _gear_mlflow.get_current_active_span() is None:",
    "        span = _gear_mlflow.start_span_no_context(name=name, span_type=\"AGENT\", parent_span=_gear_root_span, inputs=_gear_trace_inputs(inputs, attributes), attributes=values)",
    "        try:",
    "            result = operation()",
    "            _gear_apply_result_usage(span, result, attributes)",
    "            span.end(outputs={\"value\": _gear_trace_value(result)}, status=\"OK\")",
    "            return result",
    "        except Exception as error:",
    "            span.end(outputs={\"error\": _gear_trace_value(error)}, status=\"ERROR\")",
    "            raise",
    "    with _gear_mlflow.start_span(name=name, span_type=\"AGENT\", attributes=values) as span:",
    "        span.set_inputs(_gear_trace_inputs(inputs, attributes))",
    "        result = operation()",
    "        _gear_apply_result_usage(span, result, attributes)",
    "        span.set_outputs({\"value\": _gear_trace_value(result)})",
    "        return result",
    "",
    "async def _gear_trace_async_call(name, inputs, operation, attributes=None):",
    "    if _gear_mlflow is None or _gear_root_span is None:",
    "        return await operation()",
    "    values = {str(key): str(value) for key, value in (attributes or {}).items()}",
    "    with _gear_mlflow.start_span(name=name, span_type=\"AGENT\", attributes=values) as span:",
    "        span.set_inputs(_gear_trace_inputs(inputs, attributes))",
    "        result = await operation()",
    "        _gear_apply_result_usage(span, result, attributes)",
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
    `        if ${frameworkId === "microsoft-agent-framework" ? "True" : "False"}:`,
    "            from mlflow.entities.trace_location import MlflowExperimentLocation as _GearExperimentLocation",
    "            _gear_mlflow.tracing.set_destination(_GearExperimentLocation(_gear_experiment.experiment_id))",
    `        _gear_tags = {\"gear.source\": \"generated-code\", \"gear.framework\": ${JSON.stringify(frameworkId)}}`,
    "        try:",
    "            _gear_context_tags = _gear_json.loads(_gear_os.environ.get(\"GEAR_MLFLOW_CONTEXT_JSON\", \"{}\"))",
    "            if isinstance(_gear_context_tags, dict):",
    "                _gear_tags.update({str(key): str(value) for key, value in _gear_context_tags.items() if value not in (None, '')})",
    "        except Exception as _gear_context_error:",
    "            print(f\"Unable to load GEAR MLflow context: {_gear_context_error}\", file=_gear_sys.stderr)",
    "        if not _gear_mlflow_managed:",
    `            _gear_mlflow.start_run(run_name=${JSON.stringify(`gear-${frameworkId}`)})`,
    "            _gear_mlflow.set_tags(_gear_tags)",
    "            _gear_atexit.register(_gear_mlflow.end_run)",
    `        _gear_integration = ${JSON.stringify({ langgraph: "langchain", "openai-agents": "openai", strands: "strands", "pydantic-ai": "pydantic_ai", autogen: "autogen", "semantic-kernel": "semantic_kernel", haystack: "haystack" })}.get(${JSON.stringify(frameworkId)})`,
    "        if _gear_integration:",
    "            try:",
    "                getattr(_gear_mlflow, _gear_integration).autolog()",
    "            except Exception as _gear_autolog_error:",
    "                print(f\"MLflow native tracing unavailable: {_gear_autolog_error}\", file=_gear_sys.stderr)",
    `        if ${frameworkId === "crewai" ? "True" : "False"}:`,
    "            try:",
    "                # Generated CrewAI workflows use kickoff_async(); LiteLLM captures async LLM usage.",
    "                _gear_mlflow.litellm.autolog()",
    "            except Exception as _gear_litellm_autolog_error:",
    "                print(f\"MLflow LiteLLM tracing unavailable: {_gear_litellm_autolog_error}\", file=_gear_sys.stderr)",
    `        if ${frameworkId === "adk" ? "True" : "False"}:`,
    "            try:",
    "                from mlflow.entities.trace_location import MlflowExperimentLocation as _GearExperimentLocation",
    "                from opentelemetry import trace as _gear_otel_trace",
    "                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as _GearOTLPSpanExporter",
    "                from opentelemetry.sdk.trace import TracerProvider as _GearTracerProvider",
    "                from opentelemetry.sdk.trace.export import SimpleSpanProcessor as _GearSimpleSpanProcessor",
    "                _gear_mlflow.tracing.set_destination(_GearExperimentLocation(_gear_experiment.experiment_id))",
    "                _gear_otel_provider = _GearTracerProvider()",
    "                _gear_exporter = _GearOTLPSpanExporter(endpoint=f\"{_gear_tracking_uri.rstrip('/')}/v1/traces\", headers={\"x-mlflow-experiment-id\": _gear_experiment.experiment_id})",
    "                _gear_otel_provider.add_span_processor(_GearSimpleSpanProcessor(_gear_exporter))",
    "                _gear_otel_trace.set_tracer_provider(_gear_otel_provider)",
    "            except Exception as _gear_native_error:",
    "                print(f\"MLflow ADK native tracing unavailable: {_gear_native_error}\", file=_gear_sys.stderr)",
    "        _gear_trace_attributes = dict(_gear_tags)",
    "        _gear_experiment_user = _gear_tags.get(\"gear.experiment_user_id\")",
    "        _gear_session_id = _gear_os.environ.get(\"GEAR_SESSION_ID\", \"\").strip()",
    "        if _gear_experiment_user:",
    "            _gear_trace_attributes[\"user.id\"] = _gear_experiment_user",
    "        if _gear_session_id:",
    "            _gear_trace_attributes[\"session.id\"] = _gear_session_id",
    `        _gear_root_context = _gear_mlflow.start_span(name=${JSON.stringify(`gear.workflow.${frameworkId}`)}, span_type="CHAIN", attributes=_gear_trace_attributes)`,
    "        _gear_root_span = _gear_root_context.__enter__()",
    `        _gear_root_span.set_inputs({"workflow": _gear_workflow_inputs.get("name", "GearWorkflow"), "target": ${JSON.stringify(frameworkId)}, "agents": _gear_workflow_inputs.get("agents", [])})`,
    "        _gear_mlflow.update_current_trace(tags=_gear_tags)",
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
    "            else:",
    "                _gear_root_span.set_outputs({\"status\": \"completed\"})",
    "            _gear_root_context.__exit__(None, None, None)",
    "            if _gear_otel_provider is not None:",
    "                _gear_otel_provider.force_flush()",
    "                _gear_otel_provider.shutdown()",
    "            _gear_mlflow.flush_trace_async_logging(terminate=True)",
    "        _gear_original_excepthook = _gear_sys.excepthook",
    "        def _gear_excepthook(error_type, error, traceback):",
    "            _gear_finish_trace(error)",
    "            _gear_original_excepthook(error_type, error, traceback)",
    "        _gear_sys.excepthook = _gear_excepthook",
    "        _gear_atexit.register(_gear_finish_trace)",
    `        if ${frameworkId === "microsoft-agent-framework" ? "True" : "False"}:`,
    "            try:",
    "                from agent_framework.observability import configure_otel_providers as _gear_configure_otel_providers",
    "                from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as _GearOTLPSpanExporter",
    "                _gear_exporter = _GearOTLPSpanExporter(endpoint=f\"{_gear_tracking_uri.rstrip('/')}/v1/traces\", headers={\"x-mlflow-experiment-id\": _gear_experiment.experiment_id})",
    "                _gear_configure_otel_providers(enable_sensitive_data=_gear_os.environ.get(\"GEAR_MLFLOW_LOG_OUTPUTS\", \"true\").strip().lower() in {\"1\", \"true\", \"yes\", \"on\"}, exporters=[_gear_exporter])",
    "            except Exception as _gear_native_error:",
    "                print(f\"MLflow Microsoft Agent Framework native tracing unavailable: {_gear_native_error}\", file=_gear_sys.stderr)",
    "except Exception as _gear_mlflow_error:",
    "    print(f\"MLflow observability unavailable: {_gear_mlflow_error}\", file=__import__(\"sys\").stderr)",
    "# --- End GEAR MLflow observability ---",
    "",
  ].join("\n");

  const instrumentPython = (source, frameworkId, gearIR = null) => {
    if (typeof source !== "string" || source.includes("# --- GEAR MLflow observability ---")) return source;
    const lines = source.split("\n");
    let insertionIndex = lines[0]?.startsWith("#!") ? 1 : 0;
    while (lines[insertionIndex]?.startsWith("from __future__ import ")) insertionIndex += 1;
    while (insertionIndex < lines.length && (/^(?:from\s+\S+\s+import|import\s+)/.test(lines[insertionIndex]) || !lines[insertionIndex].trim())) insertionIndex += 1;
    lines.splice(insertionIndex, 0, mlflowBootstrap(nonEmptyString(frameworkId) || "unknown", traceMetadata(gearIR)));
    return lines.join("\n");
  };

  const instrumentResult = (result, frameworkId, gearIR = null) => {
    if (!result?.outputs || typeof result.outputs.orchestration !== "string") return result;
    return {
      ...result,
      outputs: {
        ...result.outputs,
        orchestration: instrumentPython(result.outputs.orchestration, frameworkId, gearIR),
      },
    };
  };

  return { buildGearIR, collectLeafPaths, createConversionReport, instrumentPython, instrumentResult };
});