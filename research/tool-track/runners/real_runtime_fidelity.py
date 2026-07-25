"""Execute generated source on real framework runtimes with deterministic models."""

from __future__ import annotations

import asyncio
import os
import re
import sys
import time
from contextlib import ExitStack, contextmanager
from types import ModuleType
from typing import Any, Iterator

from gear_sdk import GearProject

from runtime_fidelity import TraceRecorder, _text


class _ParallelGate:
    """Make a deterministic model call wait for its declared parallel peers."""

    def __init__(self, project: GearProject):
        self._groups = [
            frozenset(module["Strategy"]["Parallel"]["ParallelAgents"])
            for module in project.data.get("modules", [])
            if "Parallel" in module["Strategy"]
        ]
        self._arrivals: dict[frozenset[str], set[str]] = {group: set() for group in self._groups}
        self._condition = __import__("threading").Condition()

    def wait(self, agent: str) -> None:
        group = next((group for group in self._groups if agent in group), None)
        if group is None:
            time.sleep(0.002)
            return
        with self._condition:
            self._arrivals[group].add(agent)
            if self._arrivals[group] >= group:
                self._condition.notify_all()
            else:
                self._condition.wait_for(lambda: self._arrivals[group] >= group, timeout=0.5)
        time.sleep(0.002)


class _AsyncParallelGate:
    """Async equivalent of the deterministic parallel rendezvous."""

    def __init__(self, project: GearProject):
        self._groups = [
            frozenset(module["Strategy"]["Parallel"]["ParallelAgents"])
            for module in project.data.get("modules", [])
            if "Parallel" in module["Strategy"]
        ]
        self._arrivals: dict[frozenset[str], set[str]] = {group: set() for group in self._groups}
        self._condition = asyncio.Condition()

    async def wait(self, agent: str) -> None:
        group = next((group for group in self._groups if agent in group), None)
        if group is None:
            await asyncio.sleep(0.002)
            return
        async with self._condition:
            self._arrivals[group].add(agent)
            if self._arrivals[group] >= group:
                self._condition.notify_all()
            else:
                try:
                    await asyncio.wait_for(
                        self._condition.wait_for(lambda: self._arrivals[group] >= group),
                        timeout=0.5,
                    )
                except TimeoutError:
                    pass
        await asyncio.sleep(0.002)


@contextmanager
def _attribute(target: Any, name: str, value: Any) -> Iterator[None]:
    original = getattr(target, name)
    setattr(target, name, value)
    try:
        yield
    finally:
        setattr(target, name, original)


@contextmanager
def _runtime_environment() -> Iterator[None]:
    updates = {
        "CREWAI_DISABLE_TELEMETRY": "true",
        "HAYSTACK_TELEMETRY_ENABLED": "False",
        "OTEL_SDK_DISABLED": "true",
        "DO_NOT_TRACK": "1",
    }
    originals = {name: os.environ.get(name) for name in updates}
    os.environ.update(updates)
    try:
        yield
    finally:
        for name, value in originals.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def _crewai_model(
    recorder: TraceRecorder, project: GearProject, parallel_gate: _ParallelGate
) -> type[Any]:
    from crewai import BaseLLM

    agent_names = [agent["AgentIdentity"]["Name"] for agent in project.data["agents"]]

    class DeterministicCrewLLM(BaseLLM):
        def __init__(self, model: str = "gear-deterministic", **values: Any):
            super().__init__(model="gear-deterministic", temperature=0)

        def call(
            self,
            messages: str | list[dict[str, str]],
            tools: list[dict[str, Any]] | None = None,
            callbacks: list[Any] | None = None,
            available_functions: dict[str, Any] | None = None,
            from_task: Any | None = None,
            from_agent: Any | None = None,
            **values: Any,
        ) -> str:
            prompt = _text(messages)
            agent = getattr(from_agent, "role", None)
            if not agent:
                system = "\n".join(
                    str(message.get("content", ""))
                    for message in messages
                    if isinstance(message, dict) and message.get("role") == "system"
                ) if isinstance(messages, list) else str(messages)
                agent = next(
                    (name for name in sorted(agent_names, key=len, reverse=True) if f"You are {name}." in system),
                    None,
                )
            if not agent:
                match = re.search(r"You are ([^.\n]+)\.", prompt)
                agent = match.group(1) if match else "UnknownCrewAgent"
            invocation = recorder.start_agent(str(agent), prompt)
            parallel_gate.wait(str(agent))
            return recorder.complete_agent(invocation)

    return DeterministicCrewLLM


def _adk_model(recorder: TraceRecorder, project: GearProject) -> type[Any]:
    from google.adk.models.base_llm import BaseLlm
    from google.adk.models.llm_response import LlmResponse
    from google.genai import types
    from pydantic import PrivateAttr

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicAdkLlm(BaseLlm):
        _agent_name: str = PrivateAttr()

        def __init__(self, model: str = "gear-deterministic", **values: Any):
            super().__init__(model="gear-deterministic")
            self._agent_name = next(names)

        async def generate_content_async(self, llm_request: Any, stream: bool = False):
            content = []
            for item in llm_request.contents:
                for part in item.parts or []:
                    if getattr(part, "text", None):
                        content.append(part.text)
            invocation = recorder.start_agent(self._agent_name, content)
            await asyncio.sleep(0.005)
            output = recorder.complete_agent(invocation)
            yield LlmResponse(
                content=types.Content(role="model", parts=[types.Part(text=output)]),
                partial=False,
                turn_complete=True,
            )

    return DeterministicAdkLlm


def _langgraph_model_factory(
    recorder: TraceRecorder, project: GearProject, parallel_gate: _ParallelGate
):
    from langchain_core.language_models.chat_models import BaseChatModel
    from langchain_core.messages import AIMessage, SystemMessage
    from langchain_core.outputs import ChatGeneration, ChatResult
    from pydantic import PrivateAttr

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicChatModel(BaseChatModel):
        _agent_name: str = PrivateAttr()

        def __init__(self, agent_name: str):
            super().__init__()
            self._agent_name = agent_name

        @property
        def _llm_type(self) -> str:
            return "gear-deterministic"

        def _generate(
            self,
            messages: list[Any],
            stop: list[str] | None = None,
            run_manager: Any | None = None,
            **values: Any,
        ) -> ChatResult:
            content = [message.content for message in messages if not isinstance(message, SystemMessage)]
            invocation = recorder.start_agent(self._agent_name, content)
            parallel_gate.wait(self._agent_name)
            output = recorder.complete_agent(invocation)
            return ChatResult(generations=[ChatGeneration(message=AIMessage(content=output))])

    def factory(**values: Any) -> DeterministicChatModel:
        return DeterministicChatModel(next(names))

    return factory


def _openai_agents_constructor(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    import agents
    from agents import ModelResponse
    from agents.models.interface import Model
    from agents.usage import Usage
    from openai.types.responses import ResponseOutputMessage, ResponseOutputText

    real_agent = agents.Agent

    class DeterministicOpenAIModel(Model):
        def __init__(self, agent_name: str):
            self.agent_name = agent_name

        async def get_response(
            self,
            system_instructions: str | None,
            input: Any,
            model_settings: Any,
            tools: list[Any],
            output_schema: Any,
            handoffs: list[Any],
            tracing: Any,
            *,
            previous_response_id: str | None,
            conversation_id: str | None,
            prompt: Any,
        ) -> ModelResponse:
            invocation = recorder.start_agent(self.agent_name, input)
            await parallel_gate.wait(self.agent_name)
            output = recorder.complete_agent(invocation)
            message = ResponseOutputMessage(
                id=f"gear-{invocation.token}",
                content=[
                    ResponseOutputText(
                        text=output,
                        type="output_text",
                        annotations=[],
                        logprobs=[],
                    )
                ],
                role="assistant",
                status="completed",
                type="message",
            )
            return ModelResponse(
                output=[message],
                usage=Usage(requests=1),
                response_id=f"gear-response-{invocation.token}",
            )

        async def stream_response(self, *args: Any, **kwargs: Any):
            if False:
                yield None
            raise NotImplementedError("The deterministic RQ5 model is non-streaming.")

    def constructor(*args: Any, **kwargs: Any):
        name = str(kwargs.get("name") or (args[0] if args else "UnknownOpenAIAgent"))
        kwargs["model"] = DeterministicOpenAIModel(name)
        return real_agent(*args, **kwargs)

    return constructor


def _microsoft_chat_client_factory(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    from agent_framework import BaseChatClient, ChatResponse, Message

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicMicrosoftChatClient(BaseChatClient):
        def __init__(self, agent_name: str):
            super().__init__()
            self.agent_name = agent_name

        async def _inner_get_response(
            self,
            *,
            messages: list[Any],
            stream: bool,
            options: dict[str, Any],
            **values: Any,
        ) -> ChatResponse:
            if stream:
                raise NotImplementedError("The deterministic RQ5 model is non-streaming.")
            invocation = recorder.start_agent(
                self.agent_name,
                [getattr(message, "text", str(message)) for message in messages],
            )
            await parallel_gate.wait(self.agent_name)
            output = recorder.complete_agent(invocation)
            return ChatResponse(
                messages=[Message("assistant", [output], author_name=self.agent_name)],
                response_id=f"gear-response-{invocation.token}",
                model="gear-deterministic",
                finish_reason="stop",
            )

    def factory(*args: Any, **kwargs: Any) -> DeterministicMicrosoftChatClient:
        return DeterministicMicrosoftChatClient(next(names))

    return factory


def _strands_model_factory(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    from strands.models import Model

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicStrandsModel(Model):
        def __init__(self, agent_name: str):
            self.agent_name = agent_name
            self.config: dict[str, Any] = {"model_id": "gear-deterministic"}

        def update_config(self, **model_config: Any) -> None:
            self.config.update(model_config)

        def get_config(self) -> dict[str, Any]:
            return dict(self.config)

        async def structured_output(self, *args: Any, **kwargs: Any):
            if False:
                yield None
            raise NotImplementedError("Structured output is outside the RQ5 protocol.")

        async def stream(
            self,
            messages: list[Any],
            tool_specs: list[Any] | None = None,
            system_prompt: str | None = None,
            **kwargs: Any,
        ):
            invocation = recorder.start_agent(self.agent_name, messages)
            await parallel_gate.wait(self.agent_name)
            output = recorder.complete_agent(invocation)
            yield {"messageStart": {"role": "assistant"}}
            yield {"contentBlockStart": {"start": {}}}
            yield {"contentBlockDelta": {"delta": {"text": output}}}
            yield {"contentBlockStop": {}}
            yield {"messageStop": {"stopReason": "end_turn"}}
            yield {
                "metadata": {
                    "usage": {"inputTokens": 0, "outputTokens": 0, "totalTokens": 0},
                    "metrics": {"latencyMs": 0},
                }
            }

    def factory(*args: Any, **kwargs: Any) -> DeterministicStrandsModel:
        return DeterministicStrandsModel(next(names))

    return factory


def _pydantic_ai_agent_constructor(
    recorder: TraceRecorder,
    parallel_gate: _AsyncParallelGate,
):
    import pydantic_ai
    from pydantic_ai import ModelResponse, TextPart
    from pydantic_ai.models.function import FunctionModel

    real_agent = pydantic_ai.Agent

    def constructor(*args: Any, **kwargs: Any):
        agent_name = str(kwargs.get("name") or "UnknownPydanticAIAgent")

        async def respond(messages: list[Any], info: Any) -> ModelResponse:
            invocation = recorder.start_agent(agent_name, messages)
            await parallel_gate.wait(agent_name)
            output = recorder.complete_agent(invocation)
            return ModelResponse(
                parts=[TextPart(output)],
                model_name="gear-deterministic",
                provider_name="gear",
            )

        model = FunctionModel(respond, model_name=f"gear-deterministic-{agent_name}")
        if args:
            args = (model, *args[1:])
        else:
            kwargs["model"] = model
        return real_agent(*args, **kwargs)

    return constructor


def _autogen_chat_client_factory(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    from autogen_core.models import ChatCompletionClient, CreateResult, ModelInfo, RequestUsage

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicAutoGenChatClient(ChatCompletionClient):
        def __init__(self, agent_name: str):
            self.agent_name = agent_name
            self._usage = RequestUsage(prompt_tokens=0, completion_tokens=0)
            self._model_info = ModelInfo(
                vision=False,
                function_calling=False,
                json_output=False,
                family="unknown",
                structured_output=False,
            )

        async def create(self, messages: Any, **values: Any) -> CreateResult:
            invocation = recorder.start_agent(self.agent_name, messages)
            await parallel_gate.wait(self.agent_name)
            output = recorder.complete_agent(invocation)
            return CreateResult(
                finish_reason="stop",
                content=output,
                usage=self._usage,
                cached=False,
            )

        async def create_stream(self, messages: Any, **values: Any):
            yield await self.create(messages, **values)

        async def close(self) -> None:
            return None

        def actual_usage(self) -> RequestUsage:
            return self._usage

        def total_usage(self) -> RequestUsage:
            return self._usage

        def count_tokens(self, messages: Any, **values: Any) -> int:
            return len(_text(messages).split())

        def remaining_tokens(self, messages: Any, **values: Any) -> int:
            return 100_000

        @property
        def capabilities(self) -> Any:
            return self._model_info

        @property
        def model_info(self) -> ModelInfo:
            return self._model_info

    def factory(*args: Any, **kwargs: Any) -> DeterministicAutoGenChatClient:
        return DeterministicAutoGenChatClient(next(names))

    return factory


def _semantic_kernel_chat_service_factory(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    from pydantic import PrivateAttr
    from semantic_kernel.connectors.ai.chat_completion_client_base import (
        ChatCompletionClientBase,
    )
    from semantic_kernel.connectors.ai.open_ai import OpenAIChatPromptExecutionSettings
    from semantic_kernel.contents import ChatMessageContent
    from semantic_kernel.contents.utils.author_role import AuthorRole

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    class DeterministicSemanticKernelService(ChatCompletionClientBase):
        _agent_name: str = PrivateAttr()

        def __init__(self, agent_name: str):
            super().__init__(ai_model_id="gear-deterministic")
            self._agent_name = agent_name

        def get_prompt_execution_settings_class(self) -> type[Any]:
            return OpenAIChatPromptExecutionSettings

        async def _inner_get_chat_message_contents(
            self,
            chat_history: Any,
            settings: Any,
        ) -> list[ChatMessageContent]:
            invocation = recorder.start_agent(self._agent_name, chat_history.messages)
            await parallel_gate.wait(self._agent_name)
            output = recorder.complete_agent(invocation)
            return [
                ChatMessageContent(
                    role=AuthorRole.ASSISTANT,
                    content=output,
                    name=self._agent_name,
                    ai_model_id=self.ai_model_id,
                )
            ]

    def factory(*args: Any, **kwargs: Any) -> DeterministicSemanticKernelService:
        return DeterministicSemanticKernelService(next(names))

    return factory


def _haystack_chat_generator_factory(
    recorder: TraceRecorder,
    project: GearProject,
    parallel_gate: _AsyncParallelGate,
):
    from haystack import component
    from haystack.dataclasses import ChatMessage

    names = iter(agent["AgentIdentity"]["Name"] for agent in project.data["agents"])

    @component
    class DeterministicHaystackChatGenerator:
        def __init__(self, agent_name: str):
            self.agent_name = agent_name

        @component.output_types(replies=list[ChatMessage])
        def run(
            self,
            messages: Any,
            streaming_callback: Any | None = None,
            generation_kwargs: dict[str, Any] | None = None,
            *,
            tools: Any | None = None,
            tools_strict: bool | None = None,
        ) -> dict[str, Any]:
            raise NotImplementedError("The deterministic RQ5 model is asynchronous.")

        @component.output_types(replies=list[ChatMessage])
        async def run_async(
            self,
            messages: Any,
            streaming_callback: Any | None = None,
            generation_kwargs: dict[str, Any] | None = None,
            *,
            tools: Any | None = None,
            tools_strict: bool | None = None,
        ) -> dict[str, Any]:
            invocation = recorder.start_agent(self.agent_name, messages)
            await parallel_gate.wait(self.agent_name)
            output = recorder.complete_agent(invocation)
            return {
                "replies": [
                    ChatMessage.from_assistant(output, name=self.agent_name)
                ]
            }

    def factory(*args: Any, **kwargs: Any) -> DeterministicHaystackChatGenerator:
        return DeterministicHaystackChatGenerator(next(names))

    return factory


def _execute_namespace(
    source: str, target: str, project: GearProject, user_input: str, recorder: TraceRecorder
) -> str:
    import dotenv

    module_name = "gear_generated_real_runtime"
    generated_module = ModuleType(module_name)
    namespace = generated_module.__dict__
    previous_module = sys.modules.get(module_name)
    sys.modules[module_name] = generated_module
    parallel_gate = _ParallelGate(project)
    async_parallel_gate = _AsyncParallelGate(project)
    with ExitStack() as stack:
        stack.enter_context(_runtime_environment())
        stack.enter_context(_attribute(dotenv, "load_dotenv", lambda *args, **kwargs: False))
        if target == "crewai":
            import crewai

            stack.enter_context(
                _attribute(crewai, "LLM", _crewai_model(recorder, project, parallel_gate))
            )
        elif target == "adk":
            import google.adk.models.lite_llm as lite_llm

            stack.enter_context(_attribute(lite_llm, "LiteLlm", _adk_model(recorder, project)))
        elif target == "langgraph":
            import langchain.chat_models as chat_models

            stack.enter_context(
                _attribute(
                    chat_models,
                    "init_chat_model",
                    _langgraph_model_factory(recorder, project, parallel_gate),
                )
            )
        elif target == "openai-agents":
            import agents

            agents.set_tracing_disabled(True)
            stack.enter_context(
                _attribute(
                    agents,
                    "Agent",
                    _openai_agents_constructor(recorder, project, async_parallel_gate),
                )
            )
        elif target == "microsoft-agent-framework":
            import agent_framework.openai as microsoft_openai

            stack.enter_context(
                _attribute(
                    microsoft_openai,
                    "OpenAIChatClient",
                    _microsoft_chat_client_factory(recorder, project, async_parallel_gate),
                )
            )
        elif target == "strands":
            import strands.models.openai as strands_openai

            stack.enter_context(
                _attribute(
                    strands_openai,
                    "OpenAIModel",
                    _strands_model_factory(recorder, project, async_parallel_gate),
                )
            )
        elif target == "pydantic-ai":
            import pydantic_ai
            import pydantic_ai.models

            stack.enter_context(_attribute(pydantic_ai.models, "ALLOW_MODEL_REQUESTS", False))
            stack.enter_context(
                _attribute(
                    pydantic_ai,
                    "Agent",
                    _pydantic_ai_agent_constructor(recorder, async_parallel_gate),
                )
            )
        elif target == "autogen":
            import autogen_ext.models.openai as autogen_openai

            stack.enter_context(
                _attribute(
                    autogen_openai,
                    "OpenAIChatCompletionClient",
                    _autogen_chat_client_factory(recorder, project, async_parallel_gate),
                )
            )
        elif target == "semantic-kernel":
            import semantic_kernel.connectors.ai.open_ai as semantic_kernel_openai

            stack.enter_context(
                _attribute(
                    semantic_kernel_openai,
                    "OpenAIChatCompletion",
                    _semantic_kernel_chat_service_factory(
                        recorder, project, async_parallel_gate
                    ),
                )
            )
        elif target == "haystack":
            import haystack.components.generators.chat as haystack_chat

            stack.enter_context(
                _attribute(
                    haystack_chat,
                    "OpenAIChatGenerator",
                    _haystack_chat_generator_factory(
                        recorder, project, async_parallel_gate
                    ),
                )
            )
        else:
            raise ValueError(f"No real-runtime deterministic model adapter for {target}.")

        try:
            exec(compile(source, f"<{target}-real-runtime>", "exec"), namespace)
            recorder.begin(user_input)
            if target in {
                "crewai",
                "adk",
                "openai-agents",
                "pydantic-ai",
                "autogen",
                "semantic-kernel",
                "haystack",
            }:
                return asyncio.run(namespace["run_workflow"](user_input))
            if target == "microsoft-agent-framework":
                events = asyncio.run(namespace["workflow"].run(user_input))
                outputs = events.get_outputs()
                return str(outputs[-1]) if outputs else ""
            if target == "strands":
                result = namespace["graph"](user_input)
                source_nodes = {edge[0].node_id for edge in result.edges}
                sink_ids = [node_id for node_id in result.results if node_id not in source_nodes]
                return "\n\n".join(
                    str(result.results[node_id].result).rstrip("\n") for node_id in sink_ids
                )
            message = namespace["HumanMessage"](content=user_input)
            result = namespace["workflow"].invoke(
                {"messages": [message]}, {"configurable": {"thread_id": "gear-real-rq5"}}
            )
            return result["messages"][-1].content
        finally:
            if previous_module is None:
                sys.modules.pop(module_name, None)
            else:
                sys.modules[module_name] = previous_module


def execute_real_runtime(
    source: str, target: str, project: GearProject, user_input: str
) -> list[dict[str, Any]]:
    """Run generated code with the real framework and a local deterministic model."""

    recorder = TraceRecorder()
    output = _execute_namespace(source, target, project, user_input, recorder)
    recorder.end(output)
    return recorder.events
