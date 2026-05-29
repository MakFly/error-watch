# Docker Release Workflow

## Push new version

**Pour déployer une nouvelle version des images Docker (api + web) :**

### Règles agent / workflow

- Un `git commit` + `git push` ne crée pas de release Docker.
- Ne jamais créer ni pousser de tag `vX.Y.Z` implicitement après un commit/push.
- Créer un tag release seulement si l'utilisateur le demande explicitement.
- Avant de proposer ou créer un tag, vérifier les tags distants :
  ```bash
  git ls-remote --tags --refs origin 'v*' | awk '{print $2}' | sed 's#refs/tags/##' | sort -V | tail -5
  ```
- Si le dernier tag est `vX.Y.Z` :
  - patch release = `vX.Y.(Z+1)`
  - minor release = `vX.(Y+1).0`
- Le workflow GitHub Actions Docker ne se déclenche que quand un tag `v*` est poussé.

1. **Créer un tag de release** :
   ```bash
   # Bump patch version & git tag (manuel)
   git tag v0.9.2
   git push --follow-tags
   ```

2. **Le workflow GitHub Actions** se déclenche automatiquement sur le tag `v*` :
   - Build + push images vers GHCR
   - Tags: `vX.Y.Z`, `X.Y`, `latest`

3. **En production (self-host)** :
   ```bash
   # Premier déploiement (infrastructure + app)
   ./run-selfhost.sh init-deploy

   # Mise à jour (app uniquement, infra déjà running)
   ./run-selfhost.sh deploy
   ```

## Commandes

| Action | Commande |
|--------|----------|
| Nouvelle release | `git tag v0.9.2 && git push --follow-tags` |
| First deploy | `./run-selfhost.sh init-deploy` |
| Update | `./run-selfhost.sh deploy` |
| Check status | `./run-selfhost.sh status` |

## Notes

- `deploy` = api + web uniquement (假设 infra déjà up)
- `init-deploy` = full stack (postgres + redis + caddy + api + web)
- Images GHCR: `ghcr.io/makfly/errorwatch-api` & `ghcr.io/makfly/errorwatch-web`
