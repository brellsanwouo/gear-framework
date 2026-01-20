# ✅ Feature Models Convertis en YAML

## 📦 Fichiers Créés

Tous les feature models UVL ont été convertis en YAML avec préservation complète des types !

### Feature Models YAML

| Framework | UVL Original | YAML Converti | Statut |
|---|---|---|---|
| **CrewAI** | [crew_agent_FM-Lite.uvl](crewai/crew_agent_FM-Lite.uvl) | [crew_agent_FM-Lite.yml](crewai/crew_agent_FM-Lite.yml) | ✅ |
| **Google ADK** | [adk_agent_FM-Lite.uvl](adk/adk_agent_FM-Lite.uvl) | [adk_agent_FM-Lite.yml](adk/adk_agent_FM-Lite.yml) | ✅ |
| **Generic** | [generic_FM_agent.uvl](generic_FM_agent.uvl) | [generic_FM_agent.yml](generic_FM_agent.yml) | ✅ |

### Documentation

- **[UVL_TO_YAML_CONVERSION.md](UVL_TO_YAML_CONVERSION.md)** - Documentation complète de la conversion
- **[parse_yaml_fm.py](parse_yaml_fm.py)** - Script Python pour parser et analyser les YAML

---

## 🎯 Structure YAML

### Format Unifié

```yaml
namespace: NomDuNamespace

features:
  FeatureRacine:
    abstract: true
    type: root
    children:
      SubFeature1:
        abstract: true
        type: mandatory
        children:
          # ...
      SubFeature2:
        abstract: true
        type: optional
        group_type: alternative
        children:
          Option1:
            type: alternative_option
          Option2:
            type: alternative_option

constraints:
  - expression: "Feature1 => Feature2"
    description: "Description de la contrainte"
```

### Types Préservés

| Type | Description | Exemple |
|---|---|---|
| `mandatory` | Feature obligatoire | `Model: {type: mandatory}` |
| `optional` | Feature optionnelle | `Tools: {type: optional}` |
| `alternative` | Choix exclusif (XOR) | `group_type: alternative` |
| `or` | Choix multiple (OR) | `group_type: or` |
| `abstract: true` | Feature abstraite | `Name: {abstract: true}` |

---

## 🚀 Utilisation

### 1. Parser un Feature Model

```bash
# Lancer le script de démonstration
python parse_yaml_fm.py
```

**Sortie attendue :**
```
🤖 Feature Model YAML Parser Demo
======================================================================

📄 Parsing CrewAI Feature Model...
======================================================================
Feature Model: CrewAgent
File: crew_agent_FM-Lite.yml
======================================================================

📊 Feature Hierarchy:
----------------------------------------------------------------------
├─ CrewAgent [A] (root)
  ├─ Identity [A] (mandatory)
    ├─ Role [A] (mandatory)
    ├─ Goal [A] (mandatory)
    ├─ Backstory [A] (mandatory)
  ├─ LLMConfiguration [A] (mandatory)
    ├─ Model [A] (mandatory)
    ├─ API_KEY [A] (mandatory)
    ...

✅ Mandatory Features (XX):
  • Identity
  • Identity.Role
  • Identity.Goal
  ...
```

### 2. Parser Programmatiquement

```python
from parse_yaml_fm import FeatureModelParser

# Charger un feature model
fm = FeatureModelParser('generic_FM_agent.yml')

# Obtenir le namespace
print(f"Namespace: {fm.namespace}")

# Explorer les features
fm.explore_features()

# Obtenir features mandatory
mandatory = fm.get_mandatory_features()
print(f"Mandatory features: {mandatory}")

# Obtenir groupes alternative
alt_groups = fm.get_alternative_groups()
for group, options in alt_groups.items():
    print(f"{group}: {options}")

# Afficher résumé complet
fm.print_summary()
```

### 3. Charger et Utiliser

```python
import yaml

# Charger le YAML
with open('generic_FM_agent.yml', 'r') as f:
    fm = yaml.safe_load(f)

# Accéder aux données
namespace = fm['namespace']
features = fm['features']
constraints = fm.get('constraints', [])

# Explorer features
def explore(features, indent=0):
    for name, props in features.items():
        print("  " * indent + name)
        if 'children' in props:
            explore(props['children'], indent + 1)

explore(features)
```

---

## 📊 Comparaison des 3 Feature Models

### Statistiques

| Metric | CrewAI | ADK | Generic |
|---|---|---|---|
| **Features principales** | 10 | 4 | 11 |
| **Mandatory** | 3 | 1 | 4 |
| **Optional** | 7 | 3 | 7 |
| **Sous-features** | ~70 | ~50 | ~90 |
| **Groupes Alternative** | 7 | 3 | 12 |
| **Groupes OR** | 1 | 5 | 6 |
| **Contraintes** | 0 | 0 | 3 |

### Features Uniques

#### CrewAI Uniquement
- `Memory` avec types granulaires (ShortTerm, LongTerm, Entity, Contextual)
- `Backstory` séparé de la description
- `Cache` control explicite
- `Task.Output.OutputPydantic`

#### ADK Uniquement
- `RemoteA2AAgent` pour agents distribués
- `TopK` parameter
- `Guardrails` complets (Before/After callbacks)
- `ThinkingConfig` avec budget

#### Generic (Concepts Unifiés)
- `AgentType` avec tous les variants
- `ExecutionControl` unifié
- `DataFlow` complet (Input/Output)
- `AgentComposition` avec SubAgents

---

## 🔧 Exemples d'Usage

### 1. Valider une Configuration

```python
def validate_config(config: dict, feature_model: dict) -> list:
    """Valide qu'une configuration respecte le feature model"""
    errors = []

    # Vérifier features mandatory
    mandatory = get_mandatory_features(feature_model)
    for feat in mandatory:
        if feat not in config:
            errors.append(f"Missing mandatory feature: {feat}")

    # Vérifier contraintes
    constraints = feature_model.get('constraints', [])
    for constraint in constraints:
        # Évaluer contrainte
        if not evaluate_constraint(constraint, config):
            errors.append(f"Constraint violated: {constraint['expression']}")

    return errors
```

### 2. Générer une Configuration par Défaut

```python
def generate_default_config(feature_model: dict) -> dict:
    """Génère une configuration par défaut avec toutes les features mandatory"""
    config = {}

    def add_mandatory(features, target):
        for name, props in features.items():
            if props.get('type') == 'mandatory':
                target[name] = {}
                if 'children' in props:
                    add_mandatory(props['children'], target[name])

    add_mandatory(feature_model['features'], config)
    return config
```

### 3. Convertir YAML → JSON

```python
import yaml
import json

# Charger YAML
with open('generic_FM_agent.yml', 'r') as f:
    fm = yaml.safe_load(f)

# Sauvegarder en JSON
with open('generic_FM_agent.json', 'w') as f:
    json.dump(fm, f, indent=2)
```

---

## 🎨 Visualisation (Futur)

### Générer un Graphe

```python
import networkx as nx
import matplotlib.pyplot as plt

def generate_feature_graph(fm: dict) -> nx.DiGraph:
    """Génère un graphe des features"""
    G = nx.DiGraph()

    def add_nodes(features, parent=None):
        for name, props in features.items():
            G.add_node(name, **props)
            if parent:
                G.add_edge(parent, name)
            if 'children' in props:
                add_nodes(props['children'], name)

    add_nodes(fm['features'])
    return G

# Utilisation
fm = yaml.safe_load(open('generic_FM_agent.yml'))
G = generate_feature_graph(fm)

# Visualiser
pos = nx.spring_layout(G)
nx.draw(G, pos, with_labels=True, node_color='lightblue')
plt.show()
```

---

## 📝 Exemples de Features

### CrewAI - Memory Configuration

```yaml
Memory:
  abstract: true
  type: optional
  group_type: alternative
  children:
    True_Memory:
      abstract: false
      type: alternative_option
      children:
        ShortTermMemory:
          abstract: true
          type: mandatory
        LongTermMemory:
          abstract: true
          type: mandatory
        EntityMemory:
          abstract: true
          type: mandatory
        ContextualMemory:
          abstract: true
          type: mandatory
    False_Memory:
      abstract: false
      type: alternative_option
```

### ADK - Agent Type

```yaml
AgentType:
  abstract: true
  type: mandatory
  group_type: alternative
  children:
    LlmAgent:
      abstract: true
      type: alternative_option
    SequentialAgent:
      abstract: true
      type: alternative_option
    ParallelAgent:
      abstract: true
      type: alternative_option
    LoopAgent:
      abstract: true
      type: alternative_option
    CustomAgent:
      abstract: true
      type: alternative_option
```

### Generic - Execution Control

```yaml
ExecutionControl:
  abstract: true
  type: optional
  children:
    DelegationControl:
      abstract: true
      type: optional
      group_type: alternative
      children:
        EnableDelegation:
          abstract: false
          type: alternative_option
        DisableDelegation:
          abstract: false
          type: alternative_option
    VerbosityControl:
      abstract: true
      type: optional
      group_type: alternative
      children:
        EnableVerbose:
          abstract: false
          type: alternative_option
        DisableVerbose:
          abstract: false
          type: alternative_option
```

---

## ✅ Avantages YAML vs UVL

### 1. Lisibilité
✅ Structure clé-valeur explicite
✅ Métadonnées séparées de la hiérarchie
✅ Plus facile à comprendre pour les non-experts

### 2. Parsing
✅ Nombreux parsers disponibles (Python, JavaScript, Java, etc.)
✅ Validation avec JSON Schema possible
✅ Conversion facile vers JSON, XML

### 3. Extensibilité
✅ Ajout facile de métadonnées
✅ Support des commentaires
✅ Documentation inline possible

### 4. Tooling
✅ Éditeurs avec autocomplétion (VS Code, PyCharm, etc.)
✅ Linters et validators (yamllint, etc.)
✅ Intégration CI/CD facile

---

## 🎯 Prochaines Étapes

### Court Terme
- [ ] Générer JSON Schema pour validation
- [ ] Créer éditeur visuel web
- [ ] Ajouter plus d'exemples d'usage

### Moyen Terme
- [ ] Visualisation graphique des feature models
- [ ] Générateur de code Python/TypeScript
- [ ] Tests de conformité automatisés

### Long Terme
- [ ] Éditeur collaboratif en ligne
- [ ] Versioning et diff de feature models
- [ ] Intégration avec l'outil de conversion web

---

## 🛠️ Tests

### Parser les 3 Feature Models

```bash
# Test de parsing (ne devrait produire aucune erreur)
python -c "import yaml; print('CrewAI:', 'OK' if yaml.safe_load(open('crewai/crew_agent_FM-Lite.yml')) else 'FAIL')"
python -c "import yaml; print('ADK:', 'OK' if yaml.safe_load(open('adk/adk_agent_FM-Lite.yml')) else 'FAIL')"
python -c "import yaml; print('Generic:', 'OK' if yaml.safe_load(open('generic_FM_agent.yml')) else 'FAIL')"
```

### Exécuter l'Analyseur

```bash
# Analyser tous les feature models
python parse_yaml_fm.py
```

**Résultat attendu :** Affichage complet de la hiérarchie, features mandatory, optional, groupes alternative/OR, et contraintes pour chaque feature model.

---

## 📚 Documentation Complète

Pour plus de détails sur la conversion et le format YAML utilisé, consultez :

**[UVL_TO_YAML_CONVERSION.md](UVL_TO_YAML_CONVERSION.md)**

Ce document contient :
- Format YAML détaillé
- Exemples de conversion UVL → YAML
- Correspondance complète des types
- Guide d'utilisation Python
- Cas d'usage avancés

---

## ✨ Conclusion

Vous disposez maintenant de **3 feature models en YAML** avec :

✅ **Préservation complète** des types (mandatory, optional, alternative, or)
✅ **Hiérarchie intacte** de toutes les features
✅ **Contraintes documentées** avec descriptions
✅ **Parser Python** fonctionnel pour analyse
✅ **Documentation complète** avec exemples

**Les fichiers YAML sont prêts à l'emploi ! 🚀**
