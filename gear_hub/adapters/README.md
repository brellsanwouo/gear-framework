# Adapters

Pour ajouter un nouveau framework, créer un dossier :

- `gear_hub/adapters/<framework>/agent.mapping.yml`
- `gear_hub/adapters/<framework>/multiagent.mapping.yml`

Puis utiliser :

- Export : `python -m gear_hub.cli export --to <framework> --kind agent --in <gear> --out <target>`
- Import : `python -m gear_hub.cli import --from <framework> --kind agent --in <source> --out <gear>`

Bon pattern : commencer par du `direct/equivalent` (champs scalaires), puis itérer avec des règles custom si besoin.
