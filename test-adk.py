from google.adk.agents import Agent, SequentialAgent, ParallelAgent, LoopAgent
from google.adk.models.google_llm import Gemini
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools import google_search

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

gearassistant = Agent(
  name="GearAssistant",
  model=Gemini(model="gemini-2.5-flash-lite"),
  instruction="Ecrire le poème inspiré de DAN PASCAL",
  output_key="tache1",
)

gearassistant2 = Agent(
  name="GearAssistant2",
  model=Gemini(model="gemini-2.5-flash-lite"),
  instruction="expliquer le poème",
  output_key="tache2",
)

root_agent = SequentialAgent(
  name="RootWorkflow",
  sub_agents=[gearassistant, gearassistant2],
)

# runner = Runner(agent=root_agent, session_service=InMemorySessionService(), app_name="gear-ui")

runner = Runner(agent=root_agent, session_service=InMemorySessionService(), app_name="gear-ui")
import asyncio
async def _run():
    return await runner.run_debug("{}")
result = asyncio.run(_run())
print(result)