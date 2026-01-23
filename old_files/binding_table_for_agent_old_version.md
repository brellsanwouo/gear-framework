# Table de Conversion et Déconversion - Agent Générique

> Mappings bidirectionnels entre le Feature Model Générique et les frameworks CrewAI et Google ADK

**Version**: 1.0
**Date**: 2026-01-14
**Frameworks**: CrewAI Agent Framework | Google Agent Development Kit (ADK)

---

## 📖 Guide de Lecture

- **Generic Feature**: Concept dans le modèle générique
- **CrewAI Mapping**: Chemin correspondant dans CrewAI
- **ADK Mapping**: Chemin correspondant dans Google ADK
- **Notes**: Explications sur les différences et stratégies de conversion

### Légendes
- ✅ Mapping direct (concepts identiques)
- 🔄 Mapping équivalent (concepts similaires, noms différents)
- ⚙️ Mapping alternatif (nécessite adaptation)
- ⚠️ Framework-specific (disponible dans un seul framework)

---

## 1. Agent Identity (Identité de l'Agent)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `AgentIdentity.Name` | `Identity.Role` | `BaseAgent.Name` | 🔄 | CrewAI utilise "Role" comme identifiant, ADK utilise "Name" |
| `AgentIdentity.Purpose` | `Identity.Goal` | `Configurations.Instruction` | 🔄 | CrewAI sépare goal de task, ADK combine dans instruction |
| `AgentIdentity.ContextDescription` | `Identity.Backstory` | `BaseAgent.Description` | 🔄 | Backstory (CrewAI) fournit contexte persona, Description (ADK) est plus simple |

**Conversion Generic → CrewAI**:
```
Name → Role
Purpose → Goal
ContextDescription → Backstory
```

**Conversion Generic → ADK**:
```
Name → BaseAgent.Name
Purpose → Configurations.Instruction
ContextDescription → BaseAgent.Description
```

---

## 2. Agent Type (Type d'Agent)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `AgentType.SingleAgent` | Comportement par défaut | `BaseAgent.AgentType.LlmAgent` | ⚙️ | CrewAI: agents sont single par défaut; ADK: type explicite requis |
| `AgentType.MultiAgent.SequentialAgent` | Orchestration Crew-level avec `Task.Execution.Context` | `BaseAgent.AgentType.SequentialAgent` | ⚙️ | CrewAI: au niveau crew; ADK: type built-in |
| `AgentType.MultiAgent.ParallelAgent` | Crew-level avec `Task.Execution.AsyncExecution` | `BaseAgent.AgentType.ParallelAgent` | ⚙️ | CrewAI: tâches async; ADK: type parallèle dédié |
| `AgentType.MultiAgent.LoopAgent` | Implémentation custom avec répétition de tâches | `BaseAgent.AgentType.LoopAgent` | ⚙️ | CrewAI: logique custom; ADK: type built-in |
| `AgentType.MultiAgent.CustomAgent` | Classe custom étendant `BaseAgent` | `BaseAgent.AgentType.CustomAgent` | ✅ | Les deux supportent implémentation custom |

**Stratégies de Conversion**:
- **Generic → CrewAI**: Utiliser orchestration au niveau Crew pour multi-agents
- **Generic → ADK**: Sélectionner le `AgentType` approprié explicitement
- **CrewAI → Generic**: Analyser structure Crew pour détecter type multi-agent
- **ADK → Generic**: Mapping direct depuis `AgentType`

---

## 3. LLM Configuration

### 3.1 Configuration de Base

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `LLMConfiguration.Model` | `LLMConfiguration.Model` | `LLMAgentConfig.Model` | ✅ | Mapping direct pour spécification du modèle |

### 3.2 Paramètres du Modèle

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `ModelParameters.Temperature` | `LLMConfiguration.Advanced_configs.Temperature` | `LLMAgentConfig.GenerateContentConfig.Temperature` | ✅ | Mapping direct, même concept |
| `ModelParameters.MaxTokens` | `LLMConfiguration.Advanced_configs.MaxTokens` | `LLMAgentConfig.GenerateContentConfig.MaxOutputTokens` | 🔄 | Noms différents, même fonctionnalité |
| `ModelParameters.TopP` | `LLMConfiguration.Advanced_configs.Top_p` | `LLMAgentConfig.GenerateContentConfig.TopP` | ✅ | Paramètre nucleus sampling |
| `ModelParameters.StopSequences` | `LLMConfiguration.Advanced_configs.Stop` | Config au niveau modèle (provider-specific) | ⚙️ | CrewAI: explicite; ADK: niveau provider |
| `ModelParameters.AdditionalParams.TopK` | Valeur par défaut (non exposé) | `LLMAgentConfig.GenerateContentConfig.TopK` | ⚠️ | ADK uniquement, omis lors conversion vers CrewAI |
| `ModelParameters.AdditionalParams.FrequencyPenalty` | `LLMConfiguration.Advanced_configs.FrequencyPenalty` | Valeur par défaut (non exposé) | ⚠️ | CrewAI uniquement, omis lors conversion vers ADK |
| `ModelParameters.AdditionalParams.PresencePenalty` | `LLMConfiguration.Advanced_configs.PresencePenalty` | Valeur par défaut (non exposé) | ⚠️ | CrewAI uniquement, omis lors conversion vers ADK |
| `ModelParameters.AdditionalParams.Seed` | `LLMConfiguration.Advanced_configs.Seed` | Valeur par défaut (déterminisme via config) | ⚙️ | CrewAI: seed explicite; ADK: autres mécanismes |

### 3.3 Configuration API

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `APIConfiguration.APIKey` | `LLMConfiguration.API_KEY` | Configuration environnement projet | ⚙️ | CrewAI: per-agent; ADK: niveau projet |
| `APIConfiguration.Timeout` | `LLMConfiguration.Advanced_configs.Timeout` | Timeout système (non agent-specific) | ⚙️ | CrewAI: per-agent; ADK: defaults système |
| `APIConfiguration.MaxRetries` | `LLMConfiguration.Advanced_configs.MaxRetries` | Logique retry dans guardrails ou config système | ⚙️ | CrewAI: explicite; ADK: via error handling |

### 3.4 Configuration de Sécurité

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `SafetyConfiguration` | `Task.ValidationAndSafety.Guardrail` | `LLMAgentConfig.GenerateContentConfig.SafetySettings` | ⚙️ | Approches différentes: CrewAI task-level, ADK model-level |

---

## 4. Instruction Definition (Définition des Instructions)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `InstructionDefinition.TaskSpecification.TaskName` | `Task.Essential.Name` | `BaseAgent.Name` (agent-level) | ⚙️ | CrewAI: tâches explicites; ADK: niveau agent |
| `InstructionDefinition.TaskSpecification.TaskDescription` | `Task.Essential.Description` | `Configurations.Instruction` | 🔄 | CrewAI: description séparée; ADK: combiné dans instruction |
| `InstructionDefinition.TaskSpecification.ExpectedOutput` | `Task.Essential.ExpectedOutput` | `Configurations.DataStructure.OutputSchema` | 🔄 | CrewAI: description texte; ADK: schéma structuré |
| `InstructionDefinition.TaskSpecification.AssignedAgent` | `Task.Essential.This_Agent` | Référence `BaseAgent` (implicite) | ⚙️ | CrewAI: assignation explicite; ADK: implicite dans structure |

**Conversion Notes**:
- CrewAI a un concept de Task explicite et structuré
- ADK intègre les instructions au niveau de l'agent
- Lors de la conversion Generic → ADK, combiner TaskName et TaskDescription dans Instruction

---

## 5. Tools (Outils)

### 5.1 Scope des Outils

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `Tools.ToolScope.AgentLevelTools` | `Agent_Tools` | `Configurations.Tools` | ⚙️ | CrewAI: sépare agent/task tools; ADK: unifié |
| `Tools.ToolScope.TaskLevelTools` | `Task.Execution.Task_Tools` | `Configurations.Tools` (identique agent-level) | ⚙️ | CrewAI: outils task-specific; ADK: tous au niveau agent |

### 5.2 Types d'Outils

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `Tools.ToolTypes.FunctionBasedTools` | `Agent_Tools` ou `Task.Execution.Task_Tools` | `Configurations.Tools.FunctionTools` | ✅ | Les deux supportent déclarations de fonctions |
| `Tools.ToolTypes.ThirdPartyIntegrations` | `Agent_Tools` (intégrations externes) | `Configurations.Tools.ThirdPartyTools` | ✅ | Les deux supportent intégrations externes |
| `Tools.ToolTypes.MCPTools` | `Agent_Tools` (via support protocole MCP) | `Configurations.Tools.MCPTools` | 🔄 | ADK: support MCP explicite; CrewAI: via intégration |
| `Tools.ToolTypes.BuiltInTools` | `Agent_Tools` (outils fournis par framework) | `Configurations.Tools.BaseTools` (GeminiTools, GoogleCloudTools) | ✅ | Outils built-in spécifiques à la plateforme |
| `Tools.ToolTypes.AgentAsToolReference` | `BehavioralControls.AllowDelegation` (mécanisme delegation) | `Configurations.Tools.AgentTool` | ⚙️ | CrewAI: delegation; ADK: agents comme outils appelables |

**Stratégie de Conversion**:
- **Generic → CrewAI**: Séparer outils en Agent_Tools (généraux) et Task_Tools (spécifiques)
- **Generic → ADK**: Placer tous les outils dans Configurations.Tools
- **CrewAI → Generic**: Merger Agent_Tools et Task_Tools dans système unifié
- **ADK → Generic**: Mapping direct depuis Configurations.Tools

---

## 6. Execution Control (Contrôle d'Exécution)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `ExecutionControl.DelegationControl` | `BehavioralControls.AllowDelegation` | `BaseAgent.SubAgents` (delegation implicite) | ⚙️ | CrewAI: flag explicite; ADK: via composition agents |
| `ExecutionControl.CodeExecutionControl` | `BehavioralControls.AllowCodeExecution` | `Configurations.CodeExecutor` | ✅ | Les deux supportent exécution code, mécanismes différents |
| `ExecutionControl.AsyncExecutionControl` | `Task.Execution.AsyncExecution` | `BaseAgent.AgentType` (ParallelAgent ou outils async) | ⚙️ | CrewAI: async task-level; ADK: basé sur agent-type |
| `ExecutionControl.HumanInteractionControl` | `Task.Execution.HumanInput` | Custom function tool pour input humain | ⚙️ | CrewAI: built-in; ADK: via custom tool |
| `ExecutionControl.VerbosityControl` | `BehavioralControls.Verbose` | Configuration logging (system-level) | ⚙️ | CrewAI: verbosité per-agent; ADK: logging système |
| `ExecutionControl.CachingControl` | `BehavioralControls.Cache` | Caching système (non exposé agent-level) | ⚙️ | CrewAI: contrôle cache explicite; ADK: caching automatique |

**Valeurs par Défaut**:

| Control | CrewAI Default | ADK Default |
|---|---|---|
| Delegation | `False_AllowedDelegation` | Pas de SubAgents |
| Code Execution | `False_AllowCode` | Pas de CodeExecutor |
| Async | `False_AsyncExec` | LlmAgent (synchrone) |
| Human Input | `False_HumanInput` | Pas de tool human input |
| Verbose | `False_Verbose` | Logging standard |
| Cache | `True_Cache` | Cache automatique |

---

## 7. Memory System (Système de Mémoire)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `MemorySystem.EnableMemory.ShortTermMemory` | `Memory.True_Memory.ShortTermMemory` | Gestion état dans exécution agent (implicite) | ⚙️ | CrewAI: types mémoire explicites; ADK: via state management |
| `MemorySystem.EnableMemory.LongTermMemory` | `Memory.True_Memory.LongTermMemory` | Stockage externe ou intégration KnowledgeSources | ⚙️ | CrewAI: built-in; ADK: implémentation externe requise |
| `MemorySystem.EnableMemory.EntityMemory` | `Memory.True_Memory.EntityMemory` | Tracking état avec logique custom | ⚙️ | CrewAI: tracking entités spécifique; ADK: implémentation custom |
| `MemorySystem.EnableMemory.ContextualMemory` | `Memory.True_Memory.ContextualMemory` | `Configurations.IncludeContents` (historique conversation) | 🔄 | CrewAI: système mémoire; ADK: inclusion contexte |
| `MemorySystem.DisableMemory` | `Memory.False_Memory` | Comportement par défaut | ✅ | Pas de mémoire persistante |

**Conversion avec Perte**:
- ⚠️ **CrewAI → ADK**: Perte de granularité des types de mémoire (ShortTerm, LongTerm, Entity)
- ⚠️ **ADK → CrewAI**: Nécessite décider quels types de mémoire activer

---

## 8. Planning Capability (Capacité de Planification)

### 8.1 Stratégies de Planification

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `PlanningCapability.PlanningStrategy.BuiltInPlanner` | `Reasoning` (planification implicite) | `Configurations.Planner.BuiltInPlanner` | ⚙️ | ADK: planner explicite; CrewAI: implicite dans reasoning |
| `PlanningCapability.PlanningStrategy.ReActPlanner` | `Reasoning` avec pattern d'usage d'outils | `Configurations.Planner.PlanReactPlanner` | ⚙️ | ADK: ReAct explicite; CrewAI: via pattern reasoning |
| `PlanningCapability.PlanningStrategy.CustomPlanner` | Implémentation reasoning custom | Implémentation planner custom | ✅ | Les deux supportent logique planification custom |

### 8.2 Configuration de Pensée

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `ThinkingConfiguration.IncludeThoughts` | Implicite dans output reasoning agent | `Configurations.Planner.BuiltInPlanner.ThinkingConfig.IncludeThoughts` | ⚙️ | ADK: output pensée explicite; CrewAI: implicite |
| `ThinkingConfiguration.ThinkingBudget` | Budget tokens via `LLMConfiguration.Advanced_configs.MaxTokens` | `Configurations.Planner.BuiltInPlanner.ThinkingConfig.ThinkingBudget` | ⚙️ | Mécanismes différents pour contrôler profondeur pensée |

---

## 9. Data Flow (Flux de Données)

### 9.1 Définition des Entrées

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `DataFlow.InputDefinition.InputSchema` | Contexte et paramètres Task (structure implicite) | `Configurations.DataStructure.InputSchema` | ⚙️ | ADK: schéma explicite; CrewAI: implicite via setup task |
| `DataFlow.InputDefinition.ContextSources` | `Task.Execution.Context` (références autres tasks) | `Configurations.IncludeContents` (historique conversation) | ⚙️ | Mécanismes de contexte différents |

### 9.2 Définition des Sorties

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `DataFlow.OutputDefinition.OutputSchema` | `Task.Output.OutputJson` ou `Task.Output.OutputPydantic` | `Configurations.DataStructure.OutputSchema` | ✅ | Les deux supportent schémas output structurés |
| `DataFlow.OutputDefinition.OutputFormat.FileOutput` | `Task.Output.OutputFile` | Custom function tool pour écriture fichier | ⚙️ | CrewAI: built-in; ADK: via custom tool |
| `DataFlow.OutputDefinition.OutputFormat.JSONOutput` | `Task.Output.OutputJson` | `Configurations.DataStructure.OutputSchema` (format JSON) | ✅ | Les deux supportent output JSON |
| `DataFlow.OutputDefinition.OutputFormat.StructuredOutput` | `Task.Output.OutputPydantic` | `Configurations.DataStructure.OutputSchema` | 🔄 | CrewAI: Pydantic; ADK: définitions schéma |
| `DataFlow.OutputDefinition.OutputFormat.MarkdownOutput` | `Task.Execution.Markdown` | Post-processing avec formatage output | ⚙️ | CrewAI: markdown explicite; ADK: via processing output |
| `DataFlow.OutputDefinition.OutputFormat.FileOutput.CreateDirectory` | `Task.Output.CreateDirectory` | Function tool avec opérations filesystem | ⚙️ | CrewAI: built-in; ADK: via custom tool |
| `DataFlow.OutputDefinition.OutputCallbacks` | `Task.Output.Task_Callback` | `Guardrails.AgentLifecycle.AfterAgentCallback` | ⚙️ | Mécanismes callback différents pour handling output |

---

## 10. Guardrails and Validation (Garde-fous et Validation)

### 10.1 Règles de Validation

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `GuardrailsAndValidation.ValidationRules.GuardrailMaxRetries` | `Task.ValidationAndSafety.GuardrailMaxRetries` | Logique retry custom dans callbacks | ⚙️ | CrewAI: retries explicites; ADK: via logique callback |
| `GuardrailsAndValidation.ValidationRules.ValidationStrategy.FunctionBasedValidation` | `Task.ValidationAndSafety.GuardrailTypes.FunctionBased` | `Guardrails.ToolExecution.BeforeToolCallback` | ✅ | Les deux supportent validation fonction-based |
| `GuardrailsAndValidation.ValidationRules.ValidationStrategy.LLMBasedValidation` | `Task.ValidationAndSafety.GuardrailTypes.LLMBased` | `Guardrails.ModelInteraction.BeforeModelCallback` | ✅ | Les deux supportent validation LLM-based |

### 10.2 Lifecycle Hooks

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `LifecycleHooks.BeforeAgentExecution` | Implémentation custom (extension framework) | `Guardrails.AgentLifecycle.BeforeAgentCallback` | ⚠️ | ADK: hook explicite; CrewAI: via implémentation custom |
| `LifecycleHooks.AfterAgentExecution` | `Task.Output.Task_Callback` | `Guardrails.AgentLifecycle.AfterAgentCallback` | ✅ | Les deux supportent callbacks post-exécution |
| `LifecycleHooks.BeforeModelCall` | Implémentation custom via LLM wrapper | `Guardrails.ModelInteraction.BeforeModelCallback` | ⚠️ | ADK: explicite; CrewAI: requiert intégration LLM custom |
| `LifecycleHooks.AfterModelCall` | Implémentation custom via LLM wrapper | `Guardrails.ModelInteraction.AfterModelCallback` | ⚠️ | ADK: explicite; CrewAI: requiert intégration LLM custom |
| `LifecycleHooks.BeforeToolCall` | `Task.ValidationAndSafety.Guardrail` | `Guardrails.ToolExecution.BeforeToolCallback` | ✅ | Les deux supportent validation pré-tool |
| `LifecycleHooks.AfterToolCall` | `Task.ValidationAndSafety.Guardrail` | `Guardrails.ToolExecution.AfterToolCallback` | ✅ | Les deux supportent validation post-tool |

**Conversion avec Perte**:
- ⚠️ **CrewAI → ADK**: Gain de hooks lifecycle complets
- ⚠️ **ADK → CrewAI**: Perte de hooks Before/After Model (nécessite custom implementation)

---

## 11. Agent Composition (Composition d'Agents)

| Generic Feature | CrewAI Mapping | ADK Mapping | Type | Notes |
|---|---|---|---|---|
| `AgentComposition.SubAgents` | `Task.Execution.Context` (dépendances tasks impliquent relations agents) | `BaseAgent.SubAgents` | ⚙️ | ADK: sub-agents explicites; CrewAI: via orchestration tasks |
| `AgentComposition.ExecutionConstraints` | Dépendances tasks et références Context | `BaseAgent.Constraints` | ⚙️ | Mécanismes contraintes différents |
| `AgentComposition.KnowledgeIntegration.IntegrationLevel` | `KnowledgeSources.IntegrationLevel` (AgentLevel ou CrewLevel) | Config outils agent-level vs système-level | ⚙️ | Les deux supportent différents scopes d'intégration knowledge |
| `AgentComposition.KnowledgeIntegration.SupportedFormats` | `KnowledgeSources.SupportedFormats` (TextBased, StructuredData) | Schémas `Configurations.DataStructure` et capacités outils | ✅ | Les deux gèrent multiples formats données |
| `AgentComposition.KnowledgeIntegration.StorageConfiguration` | `KnowledgeSources.Storage` | Stockage externe via custom tools ou intégrations third-party | ⚙️ | Approches différentes intégration stockage |

---

## 📊 Matrice de Conversion Rapide

### Generic → CrewAI

| Catégorie | Action | Éléments Clés |
|---|---|---|
| **Identity** | Mapper vers trinité Role-Goal-Backstory | Role, Goal, Backstory |
| **Task** | Créer structure Task explicite | Name, Description, ExpectedOutput |
| **Tools** | Séparer Agent_Tools et Task_Tools | Agent_Tools, Task_Tools |
| **Memory** | Activer explicitement (False par défaut) | True_Memory avec types spécifiques |
| **Hooks** | Utiliser Task_Callback (hooks limités) | Task_Callback |
| **Composition** | Utiliser Context pour dépendances | Task.Execution.Context |

### Generic → ADK

| Catégorie | Action | Éléments Clés |
|---|---|---|
| **Identity** | Mapper Name et embedder goal dans Instruction | Name, Description, Instruction |
| **Type** | Sélectionner AgentType approprié | LlmAgent pour single agents |
| **Tools** | Tout dans Configurations.Tools | Pas de distinction agent/task |
| **Context** | Utiliser IncludeContents | Remplace mémoire explicite |
| **Hooks** | Utiliser Guardrails complets | Lifecycle, Model, Tool callbacks |
| **Composition** | Utiliser SubAgents explicites | BaseAgent.SubAgents |

### CrewAI → Generic

| Source | Destination | Transformation |
|---|---|---|
| Role + Goal + Backstory | AgentIdentity structurée | Combiner dans identity unifiée |
| Structure Task | InstructionDefinition | Extraire spécification task |
| Agent_Tools + Task_Tools | Tools unifiés | Merger systèmes outils |
| Memory features | MemorySystem | Mapper types mémoire |
| BehavioralControls | ExecutionControl | Extraire flags contrôle |

### ADK → Generic

| Source | Destination | Transformation |
|---|---|---|
| Name + Description | AgentIdentity | Extraire composants identity |
| Instruction | InstructionDefinition | Convertir en spécification task structurée |
| AgentType | AgentType générique | SingleAgent ou MultiAgent variant |
| Guardrails callbacks | LifecycleHooks | Convertir callbacks en hooks |
| DataStructure schemas | DataFlow | Mapper définitions input/output |

---

## ⚠️ Conversions avec Perte

### CrewAI → ADK (Pertes)

| Feature CrewAI | Impact | Mitigation |
|---|---|---|
| **EntityMemory** | Types mémoire granulaires perdus | Implémenter via state management custom |
| **Per-agent Cache control** | Contrôle cache per-agent perdu | Utiliser caching système ADK |
| **Backstory riche** | Persona détaillée potentiellement perdue | Intégrer dans Description ou Instruction |
| **Task-level Markdown** | Contrôle output markdown explicite perdu | Post-processing output |

### ADK → CrewAI (Pertes)

| Feature ADK | Impact | Mitigation |
|---|---|---|
| **Extended Thinking Mode** | Thinking budget et configuration perdus | Utiliser MaxTokens pour budget approximatif |
| **Comprehensive Lifecycle Callbacks** | Before/After Model callbacks perdus | Wrapper LLM custom pour hooks |
| **RemoteA2AAgent** | Agents distribués non supportés | Architecture custom avec APIs |
| **Model-level SafetySettings** | Safety au niveau modèle perdu | Task-level Guardrail |
| **TopK parameter** | Paramètre sampling TopK perdu | Utiliser valeurs par défaut |

### Paramètres Framework-Specific

| Paramètre | Framework | Alternative dans l'autre |
|---|---|---|
| `TopK` | ADK uniquement | CrewAI: valeur par défaut |
| `FrequencyPenalty` | CrewAI uniquement | ADK: valeur par défaut |
| `PresencePenalty` | CrewAI uniquement | ADK: valeur par défaut |
| `Seed` | CrewAI uniquement | ADK: déterminisme via config |
| `ThinkingBudget` | ADK uniquement | CrewAI: via MaxTokens |

---

## 🎯 Recommandations d'Utilisation

### Pour une Conversion Optimale

1. **Analyser les Features Utilisées**
   - Identifier features spécifiques au framework source
   - Prévoir stratégies de mitigation pour pertes

2. **Valeurs par Défaut Intelligentes**
   - Generic → CrewAI: Memory=False, Cache=True, Verbose=False
   - Generic → ADK: AgentType=LlmAgent, IncludeContents=Default

3. **Documentation des Conversions**
   - Noter les features perdues dans conversion
   - Documenter alternatives implémentées

4. **Tests de Validation**
   - Tester comportement agent après conversion
   - Valider que output correspond aux attentes

### Cas d'Usage Recommandés

| Scénario | Framework Recommandé | Raison |
|---|---|---|
| Agents avec mémoire riche | CrewAI | Types mémoire granulaires (Entity, Contextual) |
| Planning complexe | ADK | BuiltInPlanner et ReActPlanner explicites |
| Hooks lifecycle complets | ADK | Before/After callbacks pour Model et Tool |
| Orchestration multi-tasks | CrewAI | Système Task avec Context et dépendances |
| Agents distribués | ADK | Support RemoteA2AAgent built-in |
| Prototypage rapide | CrewAI | Configuration plus simple, moins verbose |

---

## 📝 Notes Finales

### Principes de Design

1. **Aucun Mapping Vide**: Chaque feature générique a une correspondance dans chaque framework
2. **Mappings Intelligents**: Directs, équivalents ou alternatifs selon les cas
3. **Documentation Complète**: Notes explicatives pour chaque conversion
4. **Orienté Utilisateur**: Structure simple et intuitive

### Évolutions Futures

Cette table de conversion est évolutive et peut être enrichie avec:
- Nouveaux frameworks (LangChain, Autogen, etc.)
- Patterns de conversion complexes
- Exemples de code pour chaque mapping
- Scripts de conversion automatisés

### Support

Pour toute question ou suggestion d'amélioration:
- Consulter les feature models sources
- Analyser les guidelines de conversion
- Tester les conversions avec cas réels
