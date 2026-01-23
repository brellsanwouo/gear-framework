# Table de conversion — GearAgent → CrewAgent

**Version**: 1.4  
**Date**: 2026-01-22  
**Source**: gear-framework/gear-agent.uvl, gear-framework/gear-agent.yml, gear-framework/gear-multiagent.uvl, gear-framework/gear-multiagent.yml  
**Cible**: crewai/crew_agent_FM-Lite.uvl, crewai/crew_agent_FM-Lite.yml, crewai/crewai_multiagent_FM-Lite.uvl, crewai/crewai_multiagent_FM-Lite.yml, adk/adk_agent_FM-Lite.uvl, adk/adk_agent_FM-Lite.yml, adk/adk_multiagent_FM-Lite.uvl, adk/adk_multiagent_FM-Lite.yml  

---

## 📖 Légende
- ✅ **Direct** : mapping 1–1
- 🔄 **Équivalent** : concept similaire, nom différent
- ⚙️ **Partiel** : nécessite adaptation / choix
- ⚠️ **Non mappé** : pas d’équivalent direct

---

## 1) Identité de l’agent

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `AgentIdentity.Name` | `Identity.Role` | 🔄 | CrewAI utilise `Role` comme identifiant principal. |
| `AgentIdentity.Purpose` | `Identity.Goal` | 🔄 | Objectif fonctionnel de l’agent. |
| `AgentIdentity.ContextDescription` | `Identity.Backstory` | 🔄 | Contexte et persona de l’agent. |

---

## 2) Configuration LLM

### 2.1 Modèle

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `LLMConfiguration.Model` | `LLMConfiguration.Model` | ✅ | Nom du modèle. |

### 2.2 Paramètres du modèle

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `ModelParameters.Temperature` | `LLMConfiguration.Advanced_configs.Temperature` | ✅ | Température identique. |
| `ModelParameters.MaxTokens` | `LLMConfiguration.Advanced_configs.MaxTokens` | ✅ | Nombre max de tokens. |
| `ModelParameters.TopP` | `LLMConfiguration.Advanced_configs.Top_p` | 🔄 | Nommage différent (`TopP` → `Top_p`). |
| `ModelParameters.StopSequences` | `LLMConfiguration.Advanced_configs.Stop` | 🔄 | Même concept (liste de stop). |
| `ModelParameters.TopK` | ⚠️ | ⚠️ | Non exposé dans CrewAI Lite. |
| `ModelParameters.FrequencyPenalty` | `LLMConfiguration.Advanced_configs.FrequencyPenalty` | ✅ | Mapping direct. |
| `ModelParameters.PresencePenalty` | `LLMConfiguration.Advanced_configs.PresencePenalty` | ✅ | Mapping direct. |
| `ModelParameters.Seed` | `LLMConfiguration.Advanced_configs.Seed` | ✅ | Mapping direct. |
| `ModelParameters.AdditionalParams` | ⚠️ | ⚠️ | A intégrer manuellement si nécessaire. |

### 2.3 Configuration API

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `APIConfiguration.APIKey` | `LLMConfiguration.API_KEY` | 🔄 | CrewAI attend une clé directe. |
| `APIConfiguration.Timeout` | `LLMConfiguration.Advanced_configs.Timeout` | ✅ | Délai d’appel. |
| `APIConfiguration.MaxRetries` | `LLMConfiguration.Advanced_configs.MaxRetries` | ✅ | Politique de retry. |

---

## 3) Spécification de tâche

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `TaskSpecification.TaskName` | `Task.Essential.Name` | ✅ | Nom de la tâche. |
| `TaskSpecification.TaskDescription` | `Task.Essential.Description` | ✅ | Description principale. |
| `TaskSpecification.ExpectedOutput` | `Task.Essential.ExpectedOutput` | ✅ | Attendu (texte). |
| `TaskSpecification.AssignedAgent` | `Task.Essential.This_Agent` | 🔄 | Identifiant de l’agent assigné. |

---

## 4) Outils

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `Tools[]` | `Agent_Tools[]` | ⚙️ | Par défaut, outils au niveau agent. |
| `Tools[]` | `Task.Execution.Task_Tools[]` | ⚙️ | Si outils spécifiques à la tâche. |

---

## 5) Contrôles d’exécution

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `ExecutionControl.DelegationControl` | `BehavioralControls.AllowDelegation` | 🔄 | Booléen direct. |
| `ExecutionControl.CodeExecutionControl` | `BehavioralControls.AllowCodeExecution` | 🔄 | Booléen direct. |
| `ExecutionControl.AsyncExecutionControl` | `Task.Execution.AsyncExecution` | 🔄 | Asynchrone au niveau tâche. |
| `ExecutionControl.HumanInteractionControl` | `Task.Execution.HumanInput` | 🔄 | Input humain. |
| `ExecutionControl.VerbosityControl` | `BehavioralControls.Verbose` | 🔄 | Niveau de verbosité. |
| `ExecutionControl.CachingControl` | `BehavioralControls.Cache` | 🔄 | Cache (si pris en charge). |

---

## 6) Capacités générales

| GearAgent | CrewAgent | Type | Notes |
|---|---|---|---|
| `Memory` | `Memory` | ✅ | Booléen direct. |
| `Reasoning` | `Reasoning` | ✅ | Booléen direct. |

---

## 7) Champs CrewAI non couverts par Gear

- `Task.Execution.Context`
- `Task.Execution.Markdown`
- `Task.Output.*`
- `Task.ValidationAndSafety.*`

---

## 8) Règles rapides de conversion (Gear → CrewAI)

- `AgentIdentity` → `Identity`
- `LLMConfiguration` → `LLMConfiguration`
- `TaskSpecification` → `Task.Essential`
- `Tools[]` → `Agent_Tools[]` (ou `Task.Execution.Task_Tools[]` si outils spécifiques)
- `ExecutionControl.*` → `BehavioralControls.*` et `Task.Execution.*`
- `Memory`, `Reasoning` → mêmes booléens

---

# Table de conversion — GearMultiAgent → CrewAIMultiAgent

## 1) Composants essentiels

| GearMultiAgent | CrewAIMultiAgent | Type | Notes |
|---|---|---|---|
| `Agents` | `Crew.EssentialComponents.Agents` | ✅ | Liste d’agents multi‑agent. |

## 2) Orchestration

| GearMultiAgent | CrewAIMultiAgent | Type | Notes |
|---|---|---|---|
| `Orchestration.Sequential` | `Crew.EssentialComponents.Process = Sequential` | ✅ | Exécution séquentielle. |
| `Orchestration.Parallel` | ⚠️ | ⚠️ | Pas d’équivalent direct dans CrewAI Lite. |
| `Orchestration.Loop` | ⚠️ | ⚠️ | Pas d’équivalent direct dans CrewAI Lite. |
| `Orchestration.Loop.TurnCount` | ⚠️ | ⚠️ | Aucun champ natif. |
| `Orchestration.Parallel.Aggregator` | ⚠️ | ⚠️ | Aucun champ natif. |

## 3) Paramètres optionnels

| GearMultiAgent | CrewAIMultiAgent | Type | Notes |
|---|---|---|---|
| `RootAgent` | `Crew.AdvancedFeatures.ManagerAgent` | ⚙️ | Approximatif (si orchestration hiérarchique). |
| `Memory` | `Crew.MemoryAndPerformance.Memory` | 🔄 | Booléen direct. |

---

Si tu veux, je peux aussi générer un fichier YAML de binding prêt à être consommé par un convertisseur.

---

# Table de conversion — GearAgent → ADKAgent (Google ADK)

## 1) Identité de l’agent

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `AgentIdentity.Name` | `BaseAgent.Name` | ✅ | Identifiant principal. |
| `AgentIdentity.Purpose` | `BaseAgent.Description` | ⚙️ | ADK n’a pas de champ “Purpose”; concaténer si nécessaire. |
| `AgentIdentity.ContextDescription` | `BaseAgent.Description` | ⚙️ | Contexte ajouté à la description si besoin. |

---

## 2) Configuration LLM

### 2.1 Modèle

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `LLMConfiguration.Model` | `LLMAgentConfig.Model` | ✅ | Nom du modèle. |

### 2.2 Paramètres du modèle

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `ModelParameters.Temperature` | `LLMAgentConfig.GenerateContentConfig.Temperature` | ✅ | Température identique. |
| `ModelParameters.MaxTokens` | `LLMAgentConfig.GenerateContentConfig.MaxOutputTokens` | 🔄 | `MaxTokens` → `MaxOutputTokens`. |
| `ModelParameters.TopP` | `LLMAgentConfig.GenerateContentConfig.TopP` | ✅ | Mapping direct. |
| `ModelParameters.StopSequences` | `GenerateContentConfig.SafetySettings` | ⚙️ | Pas d’équivalent direct; adapter via SafetySettings. |
| `ModelParameters.TopK` | `LLMAgentConfig.GenerateContentConfig.TopK` | ✅ | Mapping direct. |
| `ModelParameters.FrequencyPenalty` | ⚠️ | ⚠️ | Non exposé dans ADK Lite. |
| `ModelParameters.PresencePenalty` | ⚠️ | ⚠️ | Non exposé dans ADK Lite. |
| `ModelParameters.Seed` | ⚠️ | ⚠️ | Non exposé dans ADK Lite. |
| `ModelParameters.AdditionalParams` | ⚠️ | ⚠️ | Non exposé dans ADK Lite. |

### 2.3 Configuration API

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `APIConfiguration.APIKey` | ⚠️ | ⚠️ | Géré hors schéma ADK Lite. |
| `APIConfiguration.Timeout` | ⚠️ | ⚠️ | Timeout géré côté runtime. |
| `APIConfiguration.MaxRetries` | ⚠️ | ⚠️ | Retry géré côté runtime. |

---

## 3) Spécification de tâche

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `TaskSpecification.TaskName` | `Configurations.DataStructure.OutputKey` | ⚙️ | Peut servir de clé de sortie. |
| `TaskSpecification.TaskDescription` | `Configurations.Instruction` | ✅ | Instruction principale. |
| `TaskSpecification.ExpectedOutput` | `Configurations.DataStructure.OutputSchema` | ⚙️ | Utiliser un schéma si disponible. |
| `TaskSpecification.AssignedAgent` | `BaseAgent.Name` | ⚙️ | Mono‑agent: peut surcharger le nom. |

---

## 4) Outils

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `Tools[]` | `Configurations.Tools[]` | ⚙️ | Outils au niveau agent. |
| `Tools[]` | ⚠️ | ⚠️ | Pas de séparation outils/tâche en ADK Lite. |

---

## 5) Contrôles d’exécution

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `ExecutionControl.DelegationControl` | `BaseAgent.SubAgents` | ⚙️ | ADK expose SubAgents, pas un booléen. |
| `ExecutionControl.CodeExecutionControl` | `Configurations.CodeExecutor` | 🔄 | Booléen direct. |
| `ExecutionControl.AsyncExecutionControl` | ⚠️ | ⚠️ | Pas de champ explicite en ADK Lite. |
| `ExecutionControl.HumanInteractionControl` | `Guardrails.AgentLifecycle.BeforeAgentCallback` | ⚙️ | À gérer via callbacks. |
| `ExecutionControl.VerbosityControl` | `Guardrails.AgentLifecycle.AfterAgentCallback` | ⚙️ | À gérer via callbacks/logging. |
| `ExecutionControl.CachingControl` | `Guardrails.ModelInteraction.BeforeModelCallback` | ⚙️ | À gérer via middleware/runtime. |

---

## 6) Capacités générales

| GearAgent | ADKAgent | Type | Notes |
|---|---|---|---|
| `Memory` | `Runner.memory_service` + tools (`load_memory`, `PreloadMemoryTool`) | ⚙️ | Dans ADK, la mémoire long-terme est gérée par un `MemoryService` (ex: `InMemoryMemoryService` / `VertexAiMemoryBankService`) attaché au `Runner`, et utilisée via des tools. À distinguer de `session.state` (scratchpad) et `session.events` (historique). |
| `Reasoning` | `Planner.BuiltInPlanner.ThinkingConfig.IncludeThoughts` | ⚙️ | Activer la pensée explicite si supportée. |

---

## 7) Champs ADK non couverts par Gear

- `BaseAgent.AgentType`
- `BaseAgent.AgentCardReference.*`
- `Configurations.IncludeContents`
- `Configurations.Planner.PlanReactPlanner`
- `Configurations.DataStructure.InputSchema`
- `Guardrails.*`

---

# Table de conversion — GearMultiAgent → ADKMultiAgent

## 1) Composants essentiels

| GearMultiAgent | ADKMultiAgent | Type | Notes |
|---|---|---|---|
| `Agents` | `BaseAgent.SubAgents` | ⚙️ | Utilisé par Sequential/Parallel/Loop. |

## 3) Mémoire (système)

| GearMultiAgent | ADKMultiAgent | Type | Notes |
|---|---|---|---|
| `Memory` | `Runner.memory_service` (partagé) + tools (`load_memory`, `PreloadMemoryTool`) | ⚙️ | La mémoire multi-agent Gear correspond typiquement à un backend mémoire partagé par tout le workflow/team (même `MemoryService`) accessible par le root agent et/ou les sub-agents. |

## 2) Orchestration

| GearMultiAgent | ADKMultiAgent | Type | Notes |
|---|---|---|---|
| `Orchestration.Sequential` | `SequentialAgent.sub_agents` | 🔄 | Pipeline déterministe (A → B → C). |
| `Orchestration.Parallel` | `ParallelAgent.sub_agents` | 🔄 | Exécution concurrente (A | B | C). |
| `Orchestration.Loop` | `LoopAgent.sub_agents` | 🔄 | Cycle de raffinement. |
| `Orchestration.Loop.TurnCount` | `LoopAgent.max_iterations` | 🔄 | Contrôle du nombre d’itérations. |
| `Orchestration.Parallel.Aggregator` | `SequentialAgent (après ParallelAgent)` | ⚙️ | Pattern: ParallelAgent → AggregatorAgent. |

## 3) Syntaxe de pattern (éditeur d’orchestration)

| Syntaxe Gear | ADK | Type | Notes |
|---|---|---|---|
| `A -> B -> C` | `SequentialAgent` | 🔄 | Séquence. |
| `A | B | C` | `ParallelAgent` | 🔄 | Parallèle. |
| `(A -> B)` | `LoopAgent` | 🔄 | Boucle sur le groupe. |