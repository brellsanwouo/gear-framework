from crewai import Agent, Crew, Task, Process, LLM
import os
import sys
from dotenv import load_dotenv

load_dotenv()

gearassistant_llm = LLM(
  model="gpt-4o-mini",
  api_key="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",
)

gearassistant = Agent(
  role="GearAssistant",
  goal="ecriture de poèmes en français sur des sujets techniques.",
  backstory="Vous êtes un assistant expert en écriture créative, spécialisé dans la création de poèmes en français.",
  llm=gearassistant_llm,
  verbose=False,
  allow_delegation=False,
  allow_code_execution=False,
  cache=False,
  reasoning=False,
  memory=False,
)

task_1 = Task(
  description="Écrire un poème en français sur un {name}.",
  expected_output="Liste structurée des exigences et priorités.",
  agent=gearassistant,
)

crew = Crew(
  agents=[gearassistant],
  tasks=[task_1],
  process=Process.sequential
)

result = crew.kickoff(inputs={"name": "Brell"})

print("Résultat du poème:")
print(result)   