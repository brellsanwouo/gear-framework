# Connecteurs

Ce dossier decrit comment brancher d'autres frameworks au modele Gear.

## Structure

- `registry.yml` : registre des frameworks disponibles.
- `frameworks/<id>/` : un dossier par framework.
  - `agent.mapping.yml`
  - `multiagent.mapping.yml`

## Ajouter un nouveau framework

1) Creer `frameworks/<id>/`.
2) Copier `frameworks/_template/` et adapter les fichiers.
3) Ajouter une entree dans `registry.yml`.

Les fichiers `*.mapping.yml` decrivent des mappings simples `from` -> `to`.
