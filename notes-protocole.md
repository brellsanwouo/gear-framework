
## 1) Recruitment & Selection

### 1.1 Décider qui recruter

- La décision repose sur des critères d’inclusion:
    - le profil des utilisateurs ciblés par l’outil (compétences, motivations, pratiques),
    - et les contextes de travail où l’outil est supposé être utile.
        
- Il ne faut pas inclure les créateurs de l’outil.
    
- Âge / genre : souvent pas utile à collecter (sauf si scientifiquement justifié).
    
- Les étudiants peuvent être des participants acceptables si leurs compétences et expériences correspondent réellement à la population cible. Pour limiter les biais avec ces personnes :
    - insister sur le fait que ce n’est pas “notre” outil et éviter une relation d’autorité,
    - standardiser l’encadrement et le script.
### 1.2 Mesurer correctement l’expérience (pas juste échelle de 1 à 10)

- éviter les auto-notes 1–10.
    
- utiliser des catégories ordinales simples : aucune, un peu, significative.
        
- Expérience industrie : parfois moins informative que mesurer les compétences pertinentes pour l’outil.
    
- Langue maternelle: si l’outil dépend fortement d’une langue, recruter des personnes à l’aise dans cette langue (sinon tu mesures surtout la barrière linguistique).
    
### 1.3 Combien recruter ?

- Observations issues de revue : médiane ~10 (études générales), mais en controlled experiments médiane ~36 (ou 30), soit ~18 par condition.
    
- Approche plus propre : faire une power analysis prospective.
    
- Pour commencer : 20 participants bon point de départ, mais il faut plus

### 1.4 Comment recruter

Pistes réalistes pour des professionnels du logiciel :

- stagiaires/alternants,
- contact personnel dans une entreprise,
- équipes internes à l’université,
- groupes Meetup orientés dev,
- réseaux d’alumni,
- marketplaces (MTurk, ODesk, Freelancer, etc.).
    
### 1.5 Recruter à distance

Il y'a des avantages comme:
- Permet de recruter plus puisque ça élargit les possibilités
- L'utilisateur est sur son propre setup, plus confortable, moins de biais possible
Mais il y'a également des inconvénients:
- Moins de contrôle et de surveillance sur ce qu'il fait
    
## 2) Consent

- Avant toute tâche : expliquer clairement
    - but de l’étude,
    - ce qu’on demande aux participants,
    - risques et bénéfices.
        
- Généralement via un document de quelques pages (templates souvent disponibles).
-  Il faut faire une procédure INRIA pour valider l'expérimentation par l'Ethical Board, et avoir une compensation pour chaque participant (voir Tristan)

## 4) Mesures démographiques

### Formats possibles

- Interview : met à l’aise, permet de clarifier.
    
- Survey papier/online : réponses plus standardisées.
### Notes

- On peut demander aux participants de remplir le formulaire à haute voix comme ça si une question est mal comprise, on rectifiera.
    
- Mieux vaut que la fatigue arrive pendant le questionnaire que pendant les tâches .
    
- Attention : poser des questions d’expérience juste avant la tâche peut "démoraliser" les moins expérimentés (baisse de confiance).
    
## 5) Group assignment 

On peut potentiellement partir sur du within-subjects experiment. Mais on peut avoir le  problème du learning order effects
- Solution classique : 
	- counterbalancing (randomiser l’ordre des tâches et sur quelles tâches l’outil est utilisé).
    - Limites : fatigue / ennui (surtout si beaucoup de tâches).
	- On peut aussi faire du interrupted time-series design.

## 6) Training

- Former les participants à l’environnement si nécessaire.
- Si on mesure peuvent-ils apprendre l’outil seuls ? -> former sur tout sauf l’outil expérimental.
- si le vocabulaire du task est incompris, on mesure de la confusion de langage, pas l’outil.
- si réussir nécessite une familiarité “long terme” avec une codebase (et que l’outil n’est pas censé fournir ça), on peut donner cette connaissance avant les tâches.
En gros, tout ce qu'on donne en training devient une hypothèse sur les conditions réelles d’usage de l’outil.

## 7) Tasks

### 7.1 Feature coverage

- Décider quelles fonctionnalités seront sollicitées.Mais rester réaliste car dans la vraie vie l’utilisateur choisit ses features donc idéalement il ne faut  pas brider artificiellement l’accès aux features pertinente.
    
### 7.2 Cadre expérimental

- Plus c’est proche du réel, mieux c'est, idéalement le développeur sur son environnement habituel
    
### 7.3 Origine des tâches

- Found tasks (issues réelles) adaptées donne une meilleure validité écologique.
- From scratch :
    - risque de ne pas refléter la pratique,
    - risque de donner un avantage artificiel à l’outil vs baseline.
- Laisser les participants choisir leurs tâches très réaliste, mais variation énorme.
    
### 7.4 Durée des tâches

Deux options :

- temps illimité : tâches plus réalistes et plus larges, mais recrutement plus difficile et contrôle moindre.
- Atout du remote : ils peuvent travailler quand ils veulent.
- time limit : plus contrôlé, mais risques :
    - trop facile → tout le monde réussit → pas de différence détectable,
    - trop dur → personne ne réussit → pareil.
        
En gros il y a un compromis entre nombre de tâches, durée totale, difficulté, et facilité de recrutement.

### 7.5 Difficulté des tâches

- Difficile à prédire donc il faut tester plusieurs tâches, observer lesquelles donnent une difficulté juste.

## 8) Outcome measurements

temps, précision, correctitude, qualité de solution, compréhension, confiance, utilisabilité, erreurs, etc.

### Mesurer la réussite sur tâche

- Définir les goal states.
- Définir comment ont sait qu’ils sont atteints.
- Dire clairement aux participants ce que signifie réussir pour éviter qu’ils optimisent un objectif différent du notre.

### Mesurer le temps sur tâche

-  à standardiser (quand le chrono démarre, stoppe, interruptions, etc.).

### Mesurer l’utilité

- Ne pas juste poser la question, Vous trouvez l’outil utile ? C'est  trop vague.
- Il faut un instrument validé comme le Technology Acceptance Model (TAM) via questionnaire .

## 9) Debrief & compensation

Question d’éthique + qualité relationnelle 

- expliquer ce que l’étude investiguait et pourquoi c’était important,
- expliquer comment les données seront utilisées,
- donner les solutions correctes des tâches (éviter que les gens repartent avec un sentiment d’échec),
- fournir un contact pour questions ultérieures,
- rappeler quoi ne pas partager (du genre éviter diffusion des réponses entre étudiants futurs participants)

Les compensations :
![[Pasted image 20260130095830.png]]
[(https://ieeexplore.ieee.org/stamp/stamp.jsp?tp=&arnumber=1514443)](https://dl.acm.org/doi/abs/10.1109/TSE.2005.97)

## 10) Piloting (étape critique)

Le but est d'identifier et fr réduire les potentiels  bruitd avant l’étude réelle.
Par exemple:
- Sandbox pilots :  les chercheurs jouent les participants.
- Analytical evaluations
- Cognitive Walkthrough 


## Sources

Sur les bonnes pratiques en général

https://www2.sigsoft.org/EmpiricalStandards/
https://www.cl.cam.ac.uk/teaching/1516/P201/ko-methods-paper.pdf 
https://www.wohlin.eu/emse17_paper.pdf
https://dl.acm.org/doi/abs/10.1109/TSE.2005.97
https://publica-rest.fraunhofer.de/server/api/core/bitstreams/3b6b8b38-7bcb-4682-9bef-1aa38c8032d4/content

Qui a fait ça de notre équipe:
- SALOON: a platform for selecting and configuring cloud
environments
	- https://inria.hal.science/hal-01103560v1/document
	- 10 participants
- Green My LLM: Studying the key factors affecting
the energy consumption of code assistants
	- https://arxiv.org/pdf/2411.11892
	- 20 participants


Et pour les papiers ASE/ICSE voici une sélection

- Interpretable Vulnerability Detection Reports (ASE 2025)
	- 25 développeurs
	- https://conf.researchr.org/details/ase-2025/ase-2025-papers/79/Interpretable-Vulnerability-Detection-Reports?utm_source=chatgpt.com

- Learning Project-wise Subsequent Code Edits via Interleaving Neural-based Induction and Tool-based Deduction (ASE 2025) 
	- 24 participants 
	- [[conf.researchr.org](https://conf.researchr.org/details/ase-2025/ase-2025-papers/171/Learning-Project-wise-Subsequent-Code-Edits-via-Interleaving-Neural-based-Induction-a "Learning Project-wise Subsequent Code Edits via Interleaving Neural-based Induction and Tool-based Deduction (ASE 2025 - Research Papers) - ASE 2025")](https://conf.researchr.org/details/ase-2025/ase-2025-papers/171/Learning-Project-wise-Subsequent-Code-Edits-via-Interleaving-Neural-based-Induction-a)
    
- API-Misuse Detection Driven by Fine-Grained API-Constraint Knowledge Graph (ASE 2020) 
	- 12 développeurs
	- https://conf.researchr.org/details/ase-2020/ase-2020-papers/18/API-Misuse-Detection-Driven-by-Fine-Grained-API-Constraint-Knowledge-Graph
    
- Do Software Engineers benefit from Source Code Navigation with Traceability? – An Experiment in Software Change Management (ASE 2011) 
	- https://ieeexplore.ieee.org/abstract/document/6100095
    
- Tool Support for Essential Use Cases to Better Capture Software Requirements (ASE 2010) 
	- https://dl.acm.org/doi/abs/10.1145/1858996.1859047

- Inline Tests (ASE 2022)
	- https://dl.acm.org/doi/abs/10.1145/3551349.3556952

## ICSE

- Interactive Production Performance Feedback in the IDE / outil PerformanceHat (ICSE 2019) 
	-  https://ieeexplore.ieee.org/abstract/document/8811928
	- 20 participants

- Supporting Web-based API Searches in the IDE Using Crowd Knowledge / outil SCOUT (ICSE 2024)
	- https://dl.acm.org/doi/abs/10.1145/3597503.3639089
	- 40 participants
    
- Scaling Code Pattern Inference with Interactive What-If Analysis/ outil SURF (ICSE 2024) 
	- 14 participants
	- https://dl.acm.org/doi/abs/10.1145/3597503.3639193
    
- Interactive Code Review for Systematic Changes / outil CRITICS (ICSE 2015) 
	- 6 participants
	- https://ieeexplore.ieee.org/abstract/document/7194566
    
- Deuce: A Lightweight User Interface for Structured Editing (ICSE 2018) 
	- 21 participants 
	- https://dl.acm.org/doi/abs/10.1145/3180155.3180165
    
- Software Systems as Cities: A Controlled Experiment (ICSE 2011) 
	- 41 participants
	- https://dl.acm.org/doi/abs/10.1145/1985793.1985868
    
- Test-driven code review: An empirical study (ICSE 2019)
	- https://ieeexplore.ieee.org/abstract/document/8811911
	- 93 participants
    
- Leveraging Large Language Models for Enhancing the Understandability of Generated Unit Tests / outil UTGen (ICSE 2025)
	- 32 participants
	- https://arxiv.org/abs/2408.11710