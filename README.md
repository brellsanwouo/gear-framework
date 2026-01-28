

# Feature Modeling des agents et systèmes multi-agents


## Contexte et définitions

Dans cet travail, je m'interesse aux agents IA basés sur les LLM et aux systèmes multi-agents dans lesquels le comportement, la coordination et l'exécution des agents sont explicitement configurables.


**Définitions :**
- *Agent IA basé sur un LLM* : agent logiciel dont la prise de décision et l'exécution des tâches reposent principalement sur un LLM, avec des capacités configurables (outillage, mémoire, planification).
- *Système multi-agents* : ensembles d'agents coordonnés, avec des interactions, des rôles et des protocoles d'orchestration explicitement définis pour atteindre des objectifs communs.

---

## Étape 1 — Extraction des caractéristiques

**Objectif :**
Extraire et structurer les caractéristiquesdes agents et de l'orchestration multi-agents pour deux frameworks (CrewAI, Google ADK).
Les sources utilisées sont les documentations officielles et les références API.

J'ai uniquement pris en compte les Agents, l'Orchestration multi-agents et les Concepts associés.


**Fichiers de sortie**

Chaque fichier YAML correspond à un domaine précis et à une source documentaire :

- `crewai/crewai_agent.yml` : agents (CrewAI) — [documentation](https://docs.crewai.com/)
- `crewai/crewai_multiagent.yml` : orchestration multi-agents (CrewAI) — [documentation](https://docs.crewai.com/)
- `adk/adk_agent.yml` : agents (Google ADK) — [documentation](https://google.github.io/adk-docs/) + API reference
- `adk/adk_multiagent.yml` : orchestration multi-agents (Google ADK) — [documentation](https://google.github.io/adk-docs/)


**Typologie des listes**

Pour lever toute ambiguïté, les listes sont typées selon leur usage :

- **alternatives** : choix exclusif, une seule valeur possible (ex : `alternatives: [sequential, hierarchical]`)
- **options** : paramètres activables, plusieurs valeurs possibles (ex : `options: [streaming_mode, max_llm_calls]`)
- **collection** : ensemble d'éléments d'un même type, non exclusif (ex :
  - outils : `collection: [FunctionTool, BaseTool, AgentTool]` — tous les outils disponibles)


---


## Étape 2 — Formalisation et structuration des Feature Models

 Dans cette étape, je transforme toutes les infos récoltées en modèles de fonctionnalités (Feature Models). L’idée, c’est de rendre tout ça plus clair, plus structuré, et surtout de pouvoir comparer facilement les différentes façons de faire des agents et des systèmes multi-agents.

**Démarche :**
1. **Construction initiale (version « Full ») :**
  - À partir des fichiers YAML, j'ai construit des Feature Models exhaustifs intégrant l’ensemble des caractéristiques identifiées pour chaque framework (CrewAI, Google ADK).
  - Cette étape permet de capturer toute la richesse et la granularité des options de configuration, présentant ainsi toute la diversité des options possibles des architectures d’agents et de MAS.

2. **Raffinement (version « Lite ») :**
  - Pour des besoins d’expérimentation, de reproductibilité et de clarté, une version simplifiée des Feature Models a été élaborée.
  - Dans  cette version « Lite » j'ai exclut :
    - Les aspects spécifiques ou qui dépendent vraiment du développeur MAS pour ne pas surcharger l’arbre;
    - Les dimensions liées à la performance, l’optimisation, le monitoring, la gestion des erreurs, les paramètres de lancement (CLI), et l’observabilité;
  - L’objectif est de se concentrer sur les dimensions fondamentales et transversales, facilitant ainsi l’analyse comparative et la réutilisation scientifique.

**Enjeux:**
- Cette formalisation permet de se concentrer sur la variabilité, la modularité et la portabilité des architectures d’agents et de MAS.
- Elle permet des analyses automatisées et à la génération de configurations adaptées à des contextes d’usage variés.
- La démarche s’inscrit dans une perspective de reproductibilité et de partage des artefacts scientifiques.

**Objectif :**
Définir, comparer et exploiter les feature models des agents et des systèmes multi-agents à partir des caractéristiques extraites.

**Fichiers produits :**
- `crewai/crew_agent_FM-Full.uvl` : feature model agent complet (CrewAI)
- `crewai/crew_agent_FM-Lite.uvl` : feature model agent simplifié (CrewAI)
- `crewai/crewai_multiagent_FM-Full.uvl` : feature model multi-agents complet (CrewAI)
- `crewai/crewai_multiagent_FM-Lite.uvl` : feature model multi-agents simplifié (CrewAI)
- `adk/adk_agent_FM-Full.uvl` : feature model agent complet (Google ADK)
- `adk/adk_agent_FM-Lite.uvl` : feature model agent simplifié (Google ADK)
- `adk/adk_multiagent_FM-Full.uvl` : feature model multi-agents complet (Google ADK)
- `adk/adk_multiagent_FM-Lite.uvl` : feature model multi-agents simplifié (Google ADK)



## Examples Yaml (Gear Agent)
GearAgent:
  AgentIdentity:
    Name: GearAssistant
    Purpose: Résumer en deux phrase le poème
    ContextDescription: Vous êtes un assistant expert en résumé de poèmes en français.
  LLMConfiguration:
    Model: gemini:gemini-2.5-flash-lite
  TaskSpecification:
    TaskName: tache1
    TaskDescription: Ecrire le poème inspiré du nom DAN PASCAL
    ExpectedOutput: un poème court
  ExecutionControl:
    DelegationControl: false
    CodeExecutionControl: false
    AsyncExecutionControl: false
    HumanInteractionControl: false
    VerbosityControl: true
    CachingControl: false
  Memory: false
  Reasoning: false

GearAgent:
  AgentIdentity:
    Name: GearAssistant2
    Purpose: Résumer en deux phrase le poème
    ContextDescription: Vous êtes un assistant expert en résumé de poèmes en français.
  LLMConfiguration:
    Model: gemini:gemini-2.5-flash-lite
  TaskSpecification:
    TaskName: tache2
    TaskDescription: expliquer le poème
    ExpectedOutput: une phrase maximum
  ExecutionControl:
    DelegationControl: false
    CodeExecutionControl: false
    AsyncExecutionControl: false
    HumanInteractionControl: false
    VerbosityControl: true
    CachingControl: false
  Memory: false
  Reasoning: false






GearAgent:
  AgentIdentity:
    Name: GearAssistant
    Purpose: Résumer en deux phrase le poème
    ContextDescription: Vous êtes un assistant expert en résumé de poèmes en français.
  LLMConfiguration:
    Provider: gemini
    Model: gemini-2.5-flash-lite
  TaskSpecification:
    TaskDescription: Ecrire le poème inspiré du nom DAN PASCAL
    ExpectedOutput: un poème court
    TaskName: tache1
  ExecutionControl:
    VerbosityControl: true




  GearAgent:
  AgentIdentity:
    Name: GearAssistant2
    Purpose: Résumer en deux phrase le poème
    ContextDescription: Vous êtes un assistant expert en résumé de poèmes en français.
  LLMConfiguration:
    Provider: gemini
    Model: gemini-2.5-flash-lite
  TaskSpecification:
    TaskDescription: expliquer le poème
    ExpectedOutput: une phrase maximum
    TaskName: tache2
  ExecutionControl:
    VerbosityControl: true