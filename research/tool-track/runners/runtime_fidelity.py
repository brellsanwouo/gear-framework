"""Deterministic trace execution for generated orchestration and a native baseline."""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import threading
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass
from types import ModuleType, SimpleNamespace
from typing import Any, Iterator

from gear_sdk import GearProject


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "\n\n".join(_text(item) for item in value)
    content = getattr(value, "content", None)
    if content is not None:
        return _text(content)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, default=str)


@dataclass(frozen=True)
class Invocation:
    token: str
    agent: str
    occurrence: int
    started_event: str
    input_digest: str


class TraceRecorder:
    """Thread-safe normalized event recorder that never stores prompt content."""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []
        self._lock = threading.RLock()
        self._event_counter = 0
        self._occurrences: Counter[str] = Counter()
        self._completed_outputs: list[tuple[str, str]] = []

    def _append(self, event_type: str, **values: Any) -> dict[str, Any]:
        self._event_counter += 1
        event = {"id": f"e{self._event_counter:04d}", "type": event_type, **values}
        self.events.append(event)
        return event

    def begin(self, user_input: str) -> None:
        with self._lock:
            self._append("run_started", input_digest=_digest(user_input))

    def start_agent(self, agent: str, value: Any) -> Invocation:
        input_text = _text(value)
        with self._lock:
            self._occurrences[agent] += 1
            occurrence = self._occurrences[agent]
            token = f"{agent}#{occurrence}"
            sources = [event_id for event_id, output in self._completed_outputs if output in input_text]
            event = self._append(
                "agent_started",
                agent=agent,
                occurrence=occurrence,
                token=token,
                input_digest=_digest(input_text),
                input_sources=sources,
            )
            return Invocation(token, agent, occurrence, event["id"], _digest(input_text))

    def complete_agent(self, invocation: Invocation, output: str | None = None) -> str:
        output = output if output is not None else f"{invocation.agent}<{invocation.input_digest[:16]}>"
        with self._lock:
            event = self._append(
                "agent_completed",
                agent=invocation.agent,
                occurrence=invocation.occurrence,
                token=invocation.token,
                started_event=invocation.started_event,
                output_digest=_digest(output),
            )
            self._completed_outputs.append((event["id"], output))
        return output

    def end(self, output: Any) -> None:
        with self._lock:
            self._append("run_completed", output_digest=_digest(_text(output)))


def compare_trace(events: list[dict[str, Any]], oracle: dict[str, Any]) -> list[dict[str, str]]:
    """Return independently checkable oracle violations for a normalized trace."""

    violations: list[dict[str, str]] = []
    starts: dict[str, dict[str, Any]] = {}
    completions: dict[str, dict[str, Any]] = {}
    positions: dict[str, int] = {}
    for index, event in enumerate(events):
        positions[event["id"]] = index
        token = event.get("token")
        if event["type"] == "agent_started" and token:
            if token in starts:
                violations.append({"code": "DUPLICATE-START", "message": f"Duplicate start for {token}."})
            starts[token] = event
        elif event["type"] == "agent_completed" and token:
            if token in completions:
                violations.append(
                    {"code": "DUPLICATE-COMPLETION", "message": f"Duplicate completion for {token}."}
                )
            completions[token] = event

    actual_counts = Counter(event["agent"] for event in starts.values())
    for agent, expected in oracle["agent_counts"].items():
        actual = actual_counts.get(agent, 0)
        if actual != expected:
            violations.append(
                {
                    "code": "INVOCATION-COUNT",
                    "message": f"{agent} executed {actual} time(s); expected {expected}.",
                }
            )
    unexpected = sorted(set(actual_counts) - set(oracle["agent_counts"]))
    if unexpected:
        violations.append(
            {"code": "UNEXPECTED-AGENT", "message": f"Unexpected agents: {', '.join(unexpected)}."}
        )

    for token, start in starts.items():
        completion = completions.get(token)
        if completion is None:
            violations.append({"code": "MISSING-COMPLETION", "message": f"No completion for {token}."})
        elif positions[start["id"]] >= positions[completion["id"]]:
            violations.append(
                {"code": "INVALID-LIFECYCLE", "message": f"{token} completed before it started."}
            )

    for source_token, target_token in oracle.get("precedence", []):
        source = completions.get(source_token)
        target = starts.get(target_token)
        if source is None or target is None:
            continue
        if positions[source["id"]] >= positions[target["id"]]:
            violations.append(
                {
                    "code": "PRECEDENCE",
                    "message": f"{target_token} started before {source_token} completed.",
                }
            )

    for target_token, source_tokens in oracle.get("required_input_sources", {}).items():
        target = starts.get(target_token)
        if target is None:
            continue
        actual_sources = set(target.get("input_sources", []))
        for source_token in source_tokens:
            source = completions.get(source_token)
            if source is not None and source["id"] not in actual_sources:
                violations.append(
                    {
                        "code": "DATA-FLOW",
                        "message": f"{target_token} input does not include {source_token} output.",
                    }
                )

    for group in oracle.get("parallel_groups", []):
        group_starts = [starts.get(token) for token in group]
        group_completions = [completions.get(token) for token in group]
        if any(event is None for event in [*group_starts, *group_completions]):
            continue
        last_start = max(positions[event["id"]] for event in group_starts if event)
        first_completion = min(positions[event["id"]] for event in group_completions if event)
        if last_start >= first_completion:
            violations.append(
                {
                    "code": "PARALLEL-OVERLAP",
                    "message": f"Parallel group {', '.join(group)} did not overlap under the deterministic double.",
                }
            )

    run_starts = [event for event in events if event["type"] == "run_started"]
    run_completions = [event for event in events if event["type"] == "run_completed"]
    if len(run_starts) != 1 or len(run_completions) != 1:
        violations.append(
            {"code": "RUN-LIFECYCLE", "message": "Trace must contain one run start and one run completion."}
        )
    terminal = completions.get(oracle["terminal"])
    if terminal and run_completions and terminal["output_digest"] != run_completions[-1]["output_digest"]:
        violations.append(
            {
                "code": "TERMINAL-OUTPUT",
                "message": f"Run output does not originate from {oracle['terminal']}.",
            }
        )
    return violations


def _module(name: str, *, package: bool = False, **attributes: Any) -> ModuleType:
    module = ModuleType(name)
    module.__dict__.update(attributes)
    if package:
        module.__path__ = []  # type: ignore[attr-defined]
    return module


@contextmanager
def _installed_modules(modules: dict[str, ModuleType]) -> Iterator[None]:
    originals = {name: sys.modules.get(name) for name in modules}
    try:
        sys.modules.update(modules)
        yield
    finally:
        for name, original in originals.items():
            if original is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = original


def _dotenv_module() -> ModuleType:
    return _module("dotenv", load_dotenv=lambda *args, **kwargs: False)


def _crewai_modules(recorder: TraceRecorder) -> dict[str, ModuleType]:
    class LLM:
        def __init__(self, **values: Any):
            self.values = values

    class Agent:
        def __init__(self, role: str, **values: Any):
            self.role = role
            self.values = values

    class Task:
        def __init__(self, agent: Agent, **values: Any):
            self.agent = agent
            self.values = values

    class Crew:
        def __init__(self, tasks: list[Task], **values: Any):
            self.tasks = tasks
            self.values = values

        async def kickoff_async(self, inputs: dict[str, Any]) -> str:
            prompt = inputs.get("gear_input", "")
            invocation = recorder.start_agent(self.tasks[0].agent.role, prompt)
            await asyncio.sleep(0.002)
            return recorder.complete_agent(invocation)

    class Process:
        sequential = "sequential"

    return {
        "crewai": _module("crewai", Agent=Agent, Crew=Crew, Task=Task, Process=Process, LLM=LLM),
        "dotenv": _dotenv_module(),
    }


def _adk_modules(recorder: TraceRecorder) -> dict[str, ModuleType]:
    class GenerateContentConfig:
        def __init__(self, **values: Any):
            self.values = values

    class Agent:
        kind = "agent"

        def __init__(self, name: str, **values: Any):
            self.name = name
            self.values = values

    class SequentialAgent:
        kind = "sequential"

        def __init__(self, name: str, sub_agents: list[Any], **values: Any):
            self.name, self.sub_agents, self.values = name, sub_agents, values

    class ParallelAgent(SequentialAgent):
        kind = "parallel"

    class LoopAgent(SequentialAgent):
        kind = "loop"

        def __init__(self, name: str, sub_agents: list[Any], max_iterations: int, **values: Any):
            super().__init__(name, sub_agents, **values)
            self.max_iterations = max_iterations

    class LiteLlm:
        def __init__(self, **values: Any):
            self.values = values

    class Runner:
        def __init__(self, agent: Any, **values: Any):
            self.agent = agent
            self.values = values

        async def _execute(self, item: Any, prompt: str) -> str:
            if item.kind == "agent":
                invocation = recorder.start_agent(item.name, prompt)
                await asyncio.sleep(0.002)
                return recorder.complete_agent(invocation)
            if item.kind == "parallel":
                outputs = await asyncio.gather(*(self._execute(child, prompt) for child in item.sub_agents))
                return "\n\n".join(outputs)
            if item.kind == "loop":
                current = prompt
                for _ in range(item.max_iterations):
                    for child in item.sub_agents:
                        current = await self._execute(child, current)
                return current
            current = prompt
            for child in item.sub_agents:
                current = await self._execute(child, current)
            return current

        async def run_debug(self, user_input: str, quiet: bool = True) -> list[Any]:
            output = await self._execute(self.agent, user_input)
            part = SimpleNamespace(text=output)
            return [SimpleNamespace(content=SimpleNamespace(parts=[part]))]

    class EmptyService:
        pass

    class PreloadMemoryTool:
        pass

    modules = {
        "google": _module("google"),
        "google.adk": _module("google.adk"),
        "google.adk.agents": _module(
            "google.adk.agents",
            Agent=Agent,
            SequentialAgent=SequentialAgent,
            ParallelAgent=ParallelAgent,
            LoopAgent=LoopAgent,
        ),
        "google.adk.models": _module("google.adk.models"),
        "google.adk.models.lite_llm": _module("google.adk.models.lite_llm", LiteLlm=LiteLlm),
        "google.adk.runners": _module("google.adk.runners", Runner=Runner),
        "google.adk.sessions": _module("google.adk.sessions", InMemorySessionService=EmptyService),
        "google.adk.memory": _module("google.adk.memory", InMemoryMemoryService=EmptyService),
        "google.adk.tools": _module("google.adk.tools"),
        "google.adk.tools.preload_memory_tool": _module(
            "google.adk.tools.preload_memory_tool", PreloadMemoryTool=PreloadMemoryTool
        ),
        "google.genai": _module("google.genai"),
        "google.genai.types": _module(
            "google.genai.types", GenerateContentConfig=GenerateContentConfig
        ),
        "dotenv": _dotenv_module(),
    }
    modules["google.genai"].types = modules["google.genai.types"]
    return modules


def _langgraph_modules(recorder: TraceRecorder, project: GearProject) -> dict[str, ModuleType]:
    class Message:
        def __init__(self, content: str):
            self.content = content

    class HumanMessage(Message):
        pass

    class SystemMessage(Message):
        pass

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class FakeModel:
        def __init__(self, name: str):
            self.name = name

        def invoke(self, messages: list[Message]) -> Message:
            inputs = [message.content for message in messages if not isinstance(message, SystemMessage)]
            invocation = recorder.start_agent(self.name, inputs)
            time.sleep(0.005)
            return Message(recorder.complete_agent(invocation))

    def init_chat_model(**values: Any) -> FakeModel:
        return FakeModel(next(names))

    start_marker = "__start__"
    end_marker = "__end__"

    class StateGraph:
        def __init__(self, state_type: Any):
            self.nodes: dict[str, Any] = {}
            self.edges: list[tuple[str, str]] = []

        def add_node(self, name: str, function: Any) -> None:
            self.nodes[name] = function

        def add_edge(self, source: str, target: str) -> None:
            self.edges.append((source, target))

        def compile(self, **values: Any) -> Any:
            nodes, edges = dict(self.nodes), list(self.edges)

            class CompiledGraph:
                def invoke(self, state: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
                    current = {"messages": list(state.get("messages", []))}
                    completed: set[str] = {start_marker}
                    pending = set(nodes)
                    predecessors = {
                        node: {source for source, target in edges if target == node and source != start_marker}
                        for node in nodes
                    }
                    while pending:
                        ready = [name for name in nodes if name in pending and predecessors[name] <= completed]
                        if not ready:
                            raise RuntimeError("Fake LangGraph found an unresolved cycle.")
                        snapshot = {"messages": list(current["messages"])}
                        if len(ready) == 1:
                            results = [nodes[ready[0]](snapshot)]
                        else:
                            from concurrent.futures import ThreadPoolExecutor

                            with ThreadPoolExecutor(max_workers=len(ready)) as executor:
                                results = list(executor.map(lambda name: nodes[name](snapshot), ready))
                        for name, result in zip(ready, results):
                            current["messages"].extend(result.get("messages", []))
                            completed.add(name)
                            pending.remove(name)
                    return current

            return CompiledGraph()

    class InMemorySaver:
        pass

    return {
        "langchain": _module("langchain"),
        "langchain.chat_models": _module("langchain.chat_models", init_chat_model=init_chat_model),
        "langchain_core": _module("langchain_core"),
        "langchain_core.messages": _module(
            "langchain_core.messages",
            AnyMessage=Message,
            HumanMessage=HumanMessage,
            SystemMessage=SystemMessage,
        ),
        "langgraph": _module("langgraph"),
        "langgraph.checkpoint": _module("langgraph.checkpoint"),
        "langgraph.checkpoint.memory": _module(
            "langgraph.checkpoint.memory", InMemorySaver=InMemorySaver
        ),
        "langgraph.graph": _module(
            "langgraph.graph", END=end_marker, START=start_marker, StateGraph=StateGraph
        ),
        "langgraph.graph.message": _module("langgraph.graph.message", add_messages=lambda left, right: left + right),
        "dotenv": _dotenv_module(),
    }


def execute_generated(source: str, target: str, project: GearProject, user_input: str) -> list[dict[str, Any]]:
    recorder = TraceRecorder()
    if target == "crewai":
        modules = _crewai_modules(recorder)
    elif target == "adk":
        modules = _adk_modules(recorder)
    elif target == "langgraph":
        modules = _langgraph_modules(recorder, project)
    else:
        raise ValueError(f"No deterministic contract double for {target}.")

    namespace: dict[str, Any] = {"__name__": "gear_generated_trace"}
    with _installed_modules(modules):
        exec(compile(source, f"<{target}-generated>", "exec"), namespace)
        recorder.begin(user_input)
        if target in {"crewai", "adk"}:
            output = asyncio.run(namespace["run_workflow"](user_input))
        else:
            message = namespace["HumanMessage"](content=user_input)
            result = namespace["workflow"].invoke(
                {"messages": [message]}, {"configurable": {"thread_id": "gear-rq5"}}
            )
            output = result["messages"][-1].content
        recorder.end(output)
    return recorder.events


async def _native_agent(recorder: TraceRecorder, name: str, prompt: str) -> str:
    invocation = recorder.start_agent(name, prompt)
    await asyncio.sleep(0.002)
    return recorder.complete_agent(invocation)


async def _native_module(
    recorder: TraceRecorder, module: dict[str, Any], prompt: str
) -> str:
    strategy = module["Strategy"]
    if "Parallel" in strategy:
        parallel = strategy["Parallel"]
        outputs = await asyncio.gather(
            *(_native_agent(recorder, name, prompt) for name in parallel["ParallelAgents"])
        )
        combined = "\n\n".join(outputs)
        aggregator = parallel.get("Aggregator")
        return await _native_agent(recorder, aggregator, combined) if aggregator else combined
    loop = strategy["Loop"]
    current = prompt
    for _ in range(loop["TurnCount"]):
        for name in loop["LoopAgents"]:
            current = await _native_agent(recorder, name, current)
    return current


async def _native_workflow(recorder: TraceRecorder, project: GearProject, user_input: str) -> str:
    workflow = project.data["workflow"]
    nodes = {node["id"]: node for node in workflow["nodes"]}
    modules = {module["ModuleName"]: module for module in project.data.get("modules", [])}
    predecessors: dict[str, set[str]] = {node_id: set() for node_id in nodes}
    for edge in workflow["edges"]:
        predecessors[edge["to"]].add(edge["from"])
    pending = set(nodes)
    completed: set[str] = set()
    outputs: dict[str, str] = {}
    while pending:
        ready = [node_id for node_id in nodes if node_id in pending and predecessors[node_id] <= completed]
        if not ready:
            raise RuntimeError("Native baseline found an unresolved workflow cycle.")

        async def execute_node(node_id: str) -> tuple[str, str]:
            sources = [outputs[source] for source in nodes if source in predecessors[node_id]]
            prompt = "\n\n".join(sources) if sources else user_input
            node = nodes[node_id]
            if node["type"] == "module":
                output = await _native_module(recorder, modules[node["ref"]], prompt)
            else:
                output = await _native_agent(recorder, node["ref"], prompt)
            return node_id, output

        for node_id, output in await asyncio.gather(*(execute_node(node_id) for node_id in ready)):
            outputs[node_id] = output
            completed.add(node_id)
            pending.remove(node_id)
    terminals = [node_id for node_id in nodes if not any(edge["from"] == node_id for edge in workflow["edges"])]
    return "\n\n".join(outputs[node_id] for node_id in terminals)


def execute_native(project: GearProject, user_input: str) -> list[dict[str, Any]]:
    recorder = TraceRecorder()
    recorder.begin(user_input)
    output = asyncio.run(_native_workflow(recorder, project, user_input))
    recorder.end(output)
    return recorder.events
