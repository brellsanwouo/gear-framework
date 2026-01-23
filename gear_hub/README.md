# Gear Hub (Gear = pivot)

Objectif : faire de **Gear** le format pivot (hub) pour la variabilité des agents et de leur orchestration.

- **Import** : Framework X → Gear (reconstruction dans le modèle Gear)
- **Export** : Gear → Framework X (projection vers le modèle cible)

Le hub s’appuie sur :
- Les schémas Gear existants :
  - `gear-framework/gear-agent.yml` (JSON Schema en YAML)
  - `gear-framework/gear-multiagent.yml`
- Des fichiers de mapping **déclaratifs** par framework.

## Structure

- `gear_hub/core/` : chargement/sauvegarde, dotpaths, moteur de mapping.
- `gear_hub/adapters/<framework>/` : mappings agent/multiagent.
- `gear_hub/cli.py` : interface CLI.

## Format d’un mapping

Chaque mapping est une liste de règles :

```yaml
- from: AgentIdentity.Name
  to: Identity.Role
  kind: equivalent
  notes: "CrewAI utilise Role comme identifiant"

- from: LLMConfiguration.Model
  to: LLMConfiguration.Model
  kind: direct
```

Règles supportées (v1):
- `direct`, `equivalent` : copie de valeur
- `constant` : fixe une valeur (champ `value`)
- `partial` : copie si présent, sinon warning
- `not_mapped` : ignore (warning optionnel)

## CLI

Export Gear → framework :

```bash
python -m gear_hub.cli export --to crewai --kind agent --in gear_agent.yml --out crew_agent.yml
python -m gear_hub.cli export --to crewai --kind multiagent --in gear_multiagent.yml --out crew_multiagent.yml
```

Import framework → Gear :

```bash
python -m gear_hub.cli import --from crewai --kind agent --in crew_agent.yml --out gear_agent.yml
```

Note : l’import v1 utilise l’inversion automatique des règles `direct/equivalent/partial`.
Pour des conversions complexes (enums, structures, listes), ajouter des règles custom dans une v2.
