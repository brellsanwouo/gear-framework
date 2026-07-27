# GEAR VM Maintenance

## 1. Architecture générale

L’application est répartie sur deux VMs :

```text
Internet
  |
  v
gear.lille.inria.fr
  - Nginx HTTPS
  - Application Flask GEAR sur 127.0.0.1:8000
  - Service systemd: gear-app
  |
  v
gear-backend.lille.inria.fr
  - PostgreSQL
  - MLflow Tracking Server sur port 5000
  - Service systemd: mlflow
```

VM publique :

```text
Hostname: gear.lille.inria.fr
IP: 193.49.213.39
Rôle: Nginx + application Flask
```

VM backend :

```text
Hostname: gear-backend.lille.inria.fr
IP: 193.49.213.47
Rôle: PostgreSQL + MLflow
```

---

## 2. Connexion SSH aux VMs

Depuis la machine locale :

```bash
ssh -i ~/.ssh/id_ed25519_inria_vm \
  -J nzine@ssh-lne.inria.fr \
  nzine@gear.lille.inria.fr
```

Pour la VM backend :

```bash
ssh -i ~/.ssh/id_ed25519_inria_vm \
  -J nzine@ssh-lne.inria.fr \
  nzine@gear-backend.lille.inria.fr
```

---

## 3. Dossiers importants

Sur la VM publique :

```text
/opt/gear/app          Code de l’application
/opt/gear/venv         Environnement Python de l’application
/etc/gear.env          Variables d’environnement de l’application
/etc/systemd/system/gear-app.service
                       Service systemd de l’application
/var/lib/gear          Données locales/cache de l’app, CrewAI, ADK
```

Sur la VM backend :

```text
/opt/gear-backend              Dossier backend
/opt/gear-backend/venv         Environnement Python MLflow
/etc/gear-backend.env          Variables d’environnement backend
/etc/systemd/system/mlflow.service
                               Service systemd MLflow
/var/lib/gear/mlflow-artifacts Artifacts MLflow
```

---

## 4. Services systemd

### 4.1 Vérifier si l’application tourne

Sur la VM publique :

```bash
sudo systemctl status gear-app --no-pager -l
```

### 4.2 Redémarrer l’application

```bash
sudo systemctl daemon-reload
sudo systemctl restart gear-app
sudo systemctl status gear-app --no-pager -l
```

### 4.3 Logs de l’application

Dernières lignes :

```bash
sudo journalctl -u gear-app -n 100 --no-pager
```

Logs en direct :

```bash
sudo journalctl -u gear-app -f
```

### 4.4 Vérifier la configuration systemd de l’application

```bash
sudo systemctl cat gear-app
```

Le service doit contenir :

```ini
EnvironmentFile=/etc/gear.env
```

### 4.5 Vérifier MLflow

Sur la VM backend :

```bash
sudo systemctl status mlflow --no-pager -l
```

Logs MLflow :

```bash
sudo journalctl -u mlflow -n 100 --no-pager
sudo journalctl -u mlflow -f
```

Redémarrer MLflow :

```bash
sudo systemctl daemon-reload
sudo systemctl restart mlflow
sudo systemctl status mlflow --no-pager -l
```

---

## 5. Tests rapides

### 5.1 Tester l’application sans Nginx

Sur la VM publique :

```bash
curl http://127.0.0.1:8000
```

Si cela répond, Flask tourne localement.

### 5.2 Tester Nginx / HTTPS

Depuis n’importe où :

```bash
curl -I https://gear.lille.inria.fr
```

Une réponse `HTTP/2 200`, `HTTP/1.1 200`, `301` ou `302` indique que Nginx répond.

### 5.3 Logs Nginx

Sur la VM publique :

```bash
sudo tail -f /var/log/nginx/error.log
```

Autres logs utiles :

```bash
sudo tail -f /var/log/nginx/access.log
```

### 5.4 Tester MLflow depuis la VM backend

Sur la VM backend :

```bash
curl -I http://127.0.0.1:5000
```

### 5.5 Tester MLflow depuis la VM publique

Sur la VM publique :

```bash
curl -I http://gear-backend.lille.inria.fr:5000
curl -I http://193.49.213.47:5000
```

---

## 6. Variables d’environnement

### 6.1 Application publique : `/etc/gear.env`

Le fichier `/etc/gear.env` doit contenir au minimum :

```env
TRACKING_ENABLED=true

DATABASE_URL=postgresql://gear_user:<GEAR_DB_PASSWORD>@gear-backend.lille.inria.fr:5432/gear_app
MLFLOW_TRACKING_URI=http://gear-backend.lille.inria.fr:5000

OPENAI_API_KEY=<OPENAI_API_KEY>

HOME=/var/lib/gear
XDG_DATA_HOME=/var/lib/gear/.local/share
XDG_CACHE_HOME=/var/lib/gear/.cache
XDG_CONFIG_HOME=/var/lib/gear/.config

CREWAI_STORAGE_DIR=/var/lib/gear/gear-framework
CREWAI_TRACING_ENABLED=true
```

Après modification :

```bash
sudo systemctl daemon-reload
sudo systemctl restart gear-app
sudo journalctl -u gear-app -f
```

### 6.2 Backend MLflow : `/etc/gear-backend.env`

Le fichier `/etc/gear-backend.env` contient au minimum :

```env
MLFLOW_DB_PASSWORD=<MLFLOW_DB_PASSWORD>
```

---

## 7. PostgreSQL

PostgreSQL est sur la VM backend.

Bases utilisées :

```text
gear_app  -> données de l’application GEAR
mlflow    -> métadonnées MLflow
```

Utilisateurs PostgreSQL :

```text
gear_user   -> accès à la base gear_app
mlflow_user -> accès à la base mlflow
```

### 7.1 Se connecter à PostgreSQL côté backend

Sur la VM backend :

```bash
sudo su - postgres
psql
```

Ou directement :

```bash
sudo -u postgres psql
```

Si `sudo -u postgres` est refusé, utiliser :

```bash
sudo su - postgres
psql
```

---

## 8. Accès à la base avec une interface (je prends l'exemple ici de DBeaver)

### 8.1 Créer le tunnel

Depuis la machine locale :

```bash
ssh -i ~/.ssh/id_ed25519_inria_vm \
  -J nzine@ssh-lne.inria.fr \
  -N -L 15432:127.0.0.1:5432 \
  nzine@gear-backend.lille.inria.fr
```

Ce terminal doit rester ouvert.

Vérifier si le tunnel fonctionne :

```bash
nc -vz localhost 15432
```

### 8.2 Connexion DBeaver à `gear_app`

Dans DBeaver :

```text
Database type: PostgreSQL
Host: localhost
Port: 15432
Database: gear_app
Username: gear_user
Password: <GEAR_DB_PASSWORD>
```

### 8.3 Connexion DBeaver à `mlflow`

Dans DBeaver :

```text
Database type: PostgreSQL
Host: localhost
Port: 15432
Database: mlflow
Username: mlflow_user
Password: <MLFLOW_DB_PASSWORD>
```
---

### 8.4 Connexion à MLflow
Pour créer le tunnel
```bash
ssh -N \
  -i ~/.ssh/id_ed25519_inria_vm \
  -J nzine@ssh-lne.inria.fr \
  -L 5000:127.0.0.1:5000 \
  nzine@gear-backend.lille.inria.fr
```

Ensuite en local sur: http://127.0.0.1:5000

## 11. Mise à jour de l’application

Toujours redémarrer après mis à jour de fichier avec:

```bash
sudo systemctl daemon-reload
sudo systemctl restart gear-app
sudo systemctl status gear-app --no-pager -l
```

Surveiller les logs :

```bash
sudo journalctl -u gear-app -f
```

---

## 12. Dépannage

### 12.1 L’application ne répond pas

Vérifier le service :

```bash
sudo systemctl status gear-app --no-pager -l
sudo journalctl -u gear-app -n 100 --no-pager
```

Tester Flask directement :

```bash
curl http://127.0.0.1:8000
```

Tester Nginx :

```bash
curl -I https://gear.lille.inria.fr
sudo tail -f /var/log/nginx/error.log
```

## 13. Code CrewAI minimal pour tester

```python
from crewai import Agent, Task, Crew, Process, LLM

llm = LLM(
    model="gpt-4o-mini",
    temperature=0.2,
)

assistant = Agent(
    role="blabla",
    goal="blabla",
    backstory="blabla",
    llm=llm,
    verbose=True,
)

task = Task(
    name="blabla",
    description="blabla",
    expected_output="blabla",
    agent=assistant,
)

crew = Crew(
    agents=[assistant],
    tasks=[task],
    process=Process.sequential,
    verbose=True,
)

result = crew.kickoff()
print(result)
```