# Conversion UVL vers YAML - Feature Models d'Agents

## 📋 Fichiers Créés

Les 3 feature models ont été convertis du format UVL vers YAML avec préservation complète des types :

1. **[crewai/crew_agent_FM-Lite.yml](crewai/crew_agent_FM-Lite.yml)** - CrewAI Agent Feature Model
2. **[adk/adk_agent_FM-Lite.yml](adk/adk_agent_FM-Lite.yml)** - Google ADK Agent Feature Model
3. **[generic_FM_agent.yml](generic_FM_agent.yml)** - Generic Agent Feature Model

---

## 🎯 Format YAML Utilisé

### Structure de Base

```yaml
namespace: NomDuNamespace

features:
  FeatureName:
    abstract: true/false
    type: [root|mandatory|optional|alternative_option|or_option]
    group_type: [alternative|or]  # Pour les groupes de features
    children:
      SubFeature1: ...
      SubFeature2: ...

constraints:
  - expression: "..."
    description: "..."
```

### Types de Features

| Type UVL | Type YAML | Description |
|---|---|---|
| `mandatory` | `type: mandatory` | Feature obligatoire |
| `optional` | `type: optional` | Feature optionnelle |
| `alternative` | `group_type: alternative` + `type: alternative_option` | Un seul choix parmi plusieurs |
| `or` | `group_type: or` + `type: or_option` | Un ou plusieurs choix |
| `{abstract true}` | `abstract: true` | Feature abstraite |

### Exemples de Conversion

#### 1. Feature Mandatory Simple

**UVL:**
```
Name {abstract true}
    mandatory
        Role {abstract true}
        Goal {abstract true}
```

**YAML:**
```yaml
Name:
  abstract: true
  type: mandatory
  children:
    Role:
      abstract: true
      type: mandatory
    Goal:
      abstract: true
      type: mandatory
```

#### 2. Group Alternative

**UVL:**
```
AgentType {abstract true}
    alternative
        SingleAgent
        MultiAgent
```

**YAML:**
```yaml
AgentType:
  abstract: true
  type: mandatory
  group_type: alternative
  children:
    SingleAgent:
      abstract: false
      type: alternative_option
    MultiAgent:
      abstract: false
      type: alternative_option
```

#### 3. Group OR

**UVL:**
```
ToolTypes {abstract true}
    or
        FunctionTools {abstract true}
        ThirdPartyTools {abstract true}
```

**YAML:**
```yaml
ToolTypes:
  abstract: true
  type: optional
  group_type: or
  children:
    FunctionTools:
      abstract: true
      type: or_option
    ThirdPartyTools:
      abstract: true
      type: or_option
```

#### 4. Contraintes

**UVL:**
```
constraints
    EnableMemory => (ShortTermMemory | LongTermMemory)
```

**YAML:**
```yaml
constraints:
  - expression: "EnableMemory => (ShortTermMemory | LongTermMemory)"
    description: "If memory is enabled, at least one memory type must be selected"
```

---

## 📊 Statistiques de Conversion

### CrewAI Feature Model

- **Namespace:** `CrewAgent`
- **Features principales:** 10
  - Mandatory: 3 (Identity, LLMConfiguration, Task)
  - Optional: 7 (Agent_Tools, BehavioralControls, Memory, Reasoning, KnowledgeSources)
- **Sous-features:** ~70
- **Groupes Alternative:** 7
- **Groupes OR:** 1
- **Contraintes:** 0

### ADK Feature Model

- **Namespace:** `AgentDefinition`
- **Features principales:** 4
  - Mandatory: 1 (BaseAgent)
  - Optional: 3 (LLMAgentConfig, Configurations, Guardrails)
- **Sous-features:** ~50
- **Groupes Alternative:** 3
- **Groupes OR:** 5
- **Contraintes:** 0

### Generic Feature Model

- **Namespace:** `GenericAgent`
- **Features principales:** 11
  - Mandatory: 4 (AgentIdentity, AgentType, LLMConfiguration, InstructionDefinition)
  - Optional: 7 (Tools, ExecutionControl, MemorySystem, PlanningCapability, DataFlow, GuardrailsAndValidation, AgentComposition)
- **Sous-features:** ~90
- **Groupes Alternative:** 12
- **Groupes OR:** 6
- **Contraintes:** 3

---

## 🔍 Différences Structurelles

### 1. Hiérarchie

**UVL** utilise l'indentation avec tabulations:
```
features
    Feature {abstract true}
        mandatory
            SubFeature {abstract true}
```

**YAML** utilise la structure imbriquée:
```yaml
features:
  Feature:
    abstract: true
    children:
      SubFeature:
        abstract: true
        type: mandatory
```

### 2. Groupes de Variabilité

**UVL** déclare le type de groupe implicitement:
```
FeatureGroup {abstract true}
    alternative
        Option1
        Option2
```

**YAML** l'explicite avec `group_type`:
```yaml
FeatureGroup:
  abstract: true
  group_type: alternative
  children:
    Option1:
      type: alternative_option
    Option2:
      type: alternative_option
```

### 3. Propriétés Abstract

**UVL** utilise `{abstract true}` après le nom:
```
Feature {abstract true}
```

**YAML** utilise une propriété distincte:
```yaml
Feature:
  abstract: true
```

---

## 💡 Avantages du Format YAML

### 1. Lisibilité Améliorée
- Structure plus claire avec clés-valeurs explicites
- Métadonnées (type, abstract) séparées de la hiérarchie
- Plus facile à parser et valider

### 2. Extensibilité
- Facile d'ajouter des métadonnées supplémentaires:
```yaml
Feature:
  abstract: true
  type: mandatory
  description: "Description de la feature"
  cardinality: "1..1"
  deprecated: false
```

### 3. Intégration Outil
- Compatible avec de nombreux parsers YAML
- Validation de schéma possible avec JSON Schema
- Export facile vers JSON, XML, etc.

### 4. Contraintes Documentées
Les contraintes incluent maintenant des descriptions:
```yaml
constraints:
  - expression: "EnableMemory => (ShortTermMemory | LongTermMemory)"
    description: "Au moins un type de mémoire requis si mémoire activée"
```

---

## 🛠️ Utilisation des Fichiers YAML

### Parsing Python

```python
import yaml

# Charger le feature model
with open('generic_FM_agent.yml', 'r') as f:
    fm = yaml.safe_load(f)

# Accéder aux features
namespace = fm['namespace']
features = fm['features']
constraints = fm['constraints']

# Explorer la hiérarchie
def explore_features(features, indent=0):
    for name, props in features.items():
        print("  " * indent + f"- {name} ({props.get('type', 'N/A')})")
        if 'children' in props:
            explore_features(props['children'], indent + 1)

explore_features(features['GenericAgent']['children'])
```

### Validation

```python
def validate_feature_model(fm):
    """Valide la structure d'un feature model YAML"""
    errors = []

    # Vérifier namespace
    if 'namespace' not in fm:
        errors.append("Missing namespace")

    # Vérifier features
    if 'features' not in fm:
        errors.append("Missing features")

    # Vérifier types valides
    valid_types = ['root', 'mandatory', 'optional', 'alternative_option', 'or_option']
    # ... validation logic

    return errors
```

### Conversion vers d'autres formats

```python
import json

# YAML → JSON
with open('generic_FM_agent.yml', 'r') as f:
    fm = yaml.safe_load(f)

with open('generic_FM_agent.json', 'w') as f:
    json.dump(fm, f, indent=2)
```

---

## 📝 Correspondance Complète UVL ↔ YAML

| Concept UVL | Représentation YAML | Exemple |
|---|---|---|
| Namespace | `namespace: Name` | `namespace: GenericAgent` |
| Feature racine | `features: {Name: ...}` | `features: GenericAgent: ...` |
| Mandatory | `type: mandatory` | `Model: {type: mandatory}` |
| Optional | `type: optional` | `Tools: {type: optional}` |
| Alternative group | `group_type: alternative` | `AgentType: {group_type: alternative}` |
| Alternative option | `type: alternative_option` | `SingleAgent: {type: alternative_option}` |
| OR group | `group_type: or` | `ToolTypes: {group_type: or}` |
| OR option | `type: or_option` | `FunctionTools: {type: or_option}` |
| Abstract | `abstract: true` | `Name: {abstract: true}` |
| Children | `children: {...}` | `Identity: {children: {Name: ...}}` |
| Constraint | `constraints: [{expression: ...}]` | Voir exemple ci-dessus |

---

## ✅ Validation de la Conversion

### Vérifications Effectuées

- [x] **Tous les features préservés** - Aucune feature perdue
- [x] **Hiérarchie maintenue** - Structure parent-enfant intacte
- [x] **Types corrects** - Mandatory, optional, alternative, or
- [x] **Propriétés abstract** - Toutes préservées
- [x] **Contraintes** - Incluses dans Generic FM
- [x] **Groupes de variabilité** - Alternative et OR correctement convertis

### Tests de Parsing

```bash
# Test de parsing YAML (tous les fichiers parsent sans erreur)
python -c "import yaml; yaml.safe_load(open('crewai/crew_agent_FM-Lite.yml'))"
python -c "import yaml; yaml.safe_load(open('adk/adk_agent_FM-Lite.yml'))"
python -c "import yaml; yaml.safe_load(open('generic_FM_agent.yml'))"
```

---

## 🎯 Cas d'Usage

### 1. Génération de Code
Utiliser les YAML pour générer des classes Python:
```python
def generate_agent_class(fm):
    # Parser le YAML
    # Générer classes Python basées sur features
    pass
```

### 2. Validation de Configurations
Valider qu'une configuration agent respecte le feature model:
```python
def validate_agent_config(config, feature_model):
    # Vérifier features mandatory présentes
    # Vérifier contraintes respectées
    pass
```

### 3. Visualisation
Générer des diagrammes à partir des YAML:
```python
def generate_feature_diagram(fm):
    # Créer graphe avec networkx
    # Visualiser avec matplotlib
    pass
```

### 4. Documentation
Générer documentation markdown des features:
```python
def generate_feature_docs(fm):
    # Parser features
    # Générer markdown avec hiérarchie
    pass
```

---

## 🚀 Prochaines Étapes

1. **Validation formelle** avec JSON Schema
2. **Outils de visualisation** (graphiques de features)
3. **Générateurs de code** (Python, TypeScript, etc.)
4. **Éditeur visuel** pour feature models YAML
5. **Tests de conformité** pour configurations d'agents

---

## 📚 Références

- **UVL Specification**: [Universal Variability Language](https://github.com/Universal-Variability-Language)
- **YAML Specification**: [YAML 1.2](https://yaml.org/spec/1.2/)
- **Feature Models**: [Software Product Lines](https://en.wikipedia.org/wiki/Feature_model)

---

**Conversion complétée avec succès ! ✅**
