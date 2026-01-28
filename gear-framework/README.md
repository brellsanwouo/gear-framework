# Gear Framework Project

Ce dossier regroupe :
- `ui/` : l'interface (basee sur `test-ui`) pour manipuler les UVL Gear.
- `gear/` : les modeles Gear (UVL/YAML/JSON) utilises par l'UI.
- `connectors/` : la zone d'extension pour connecter d'autres frameworks.

## Lancer l'UI

Depuis la racine du depot :

```bash
python3 gear-framework/server.py
```

Puis ouvre :
- http://127.0.0.1:8010/ui/

## Connecteurs

Voir `connectors/README.md` pour ajouter un framework.
