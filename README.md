# 🐐🍯 Le Guide Chèvre-Miel

Le seul guide gastronomique qui ne note que les pizzas chèvre-miel.

- **Carte** : Leaflet + fond de carte vectoriel OpenFreeMap via MapLibre (données OpenStreetMap), gratuit et sans clé
- **Recherche d'établissements** : Photon (komoot), gratuit, sans clé
- **Données et photos** : Supabase (Postgres gratuit)
- **Hébergement** : GitHub Pages (site statique, HTTPS)

Il n'y a aucun serveur à toi : GitHub sert les fichiers, Supabase garde les données.

```
index.html, style.css, app.js   l'application
config.js                       ← le seul fichier à modifier
supabase/schema.sql             à coller dans Supabase (tables + sécurité)
.github/workflows/keepalive.yml empêche Supabase de se mettre en veille
icons/, manifest.webmanifest    icône et installation sur l'écran d'accueil
```

---

## Essayer tout de suite (mode démo, 1 min)

Tant que `config.js` n'est pas rempli, l'app tourne en **mode démo** : tout reste dans le navigateur.

```bash
cd guide-chevre-miel
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```

(Ouvrir `index.html` en double-cliquant ne marche pas : les modules JavaScript exigent un serveur.)

---

## Mise en ligne (environ 30 min)

### 1. Créer la base Supabase

1. Va sur [supabase.com](https://supabase.com) et connecte-toi (avec GitHub, c'est le plus simple).
2. **New project**. Nom : `guide-chevre-miel`. Région : **Paris (eu-west-3)**. Mot de passe de la base : génère-le, tu n'en auras pas besoin ensuite.
3. Attends que le projet soit prêt (1 à 2 min).

### 2. Créer les tables et la sécurité

1. Dans Supabase : **SQL Editor** → **New query** → colle `supabase/schema.sql` **tel quel** → **Run**.
   Résultat attendu : `Success. No rows returned`.
2. **New query** à nouveau, et définis le code secret :
   ```sql
   update private.secret set pin = 'ta vraie phrase secrète' where id;
   ```
   Prends une phrase plutôt que 4 chiffres. C'est ce que ton amie tapera une fois sur son téléphone.
   ⚠️ **N'écris jamais le vrai code dans `schema.sql`** : le dépôt est public. Ne sauvegarde pas non plus cette requête dans Supabase.

Tu peux relancer `schema.sql` plus tard sans risque : il ne touche pas au code déjà défini.

Ce que ça met en place :
- **lecture ouverte** à quiconque a le lien ;
- **écriture** (ajout, modification, suppression) seulement si la requête porte le bon code.
  Le code est stocké dans un schéma `private` que l'API ne montre pas.

> Pour changer le code plus tard, dans SQL Editor :
> `update private.secret set pin = 'nouvelle phrase' where id;`
> L'app redemandera le code tout seul.

### 3. Remplir `config.js`

Dans Supabase, bouton **Connect** en haut (ou **Project Settings → API Keys**), récupère :
- l'**URL du projet** (`https://abcdefgh.supabase.co`) ;
- la clé **publishable** (`sb_publishable_…`) ou, sur un ancien projet, la clé **anon**.

```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_KEY: 'sb_publishable_xxxxxxxxxxxx',
PRENOM: 'Julie',            // facultatif : « Le Guide de Julie »
CARTE_DEPART: { lat: 43.70, lon: 7.26, zoom: 12 },  // facultatif : sa ville
```

Cette clé est **faite pour être publique**, elle peut aller sur GitHub sans risque.
⚠️ Ne mets **jamais** la clé `secret` / `service_role` dans ce fichier.

### 4. Publier sur GitHub Pages

Crée un dépôt **public** vide nommé `guide-chevre-miel` sur GitHub (GitHub Pages gratuit exige un dépôt public), puis :

```bash
cd guide-chevre-miel
git init -b main
git add .
git commit -m "Le Guide Chèvre-Miel"
git remote add origin git@github.com:TON-PSEUDO/guide-chevre-miel.git
git push -u origin main
```

(L'envoi par glisser-déposer dans l'interface web de GitHub oublie souvent le dossier caché `.github`. Passe plutôt par `git`.)

Ensuite, dans le dépôt : **Settings → Pages → Build and deployment → Source : Deploy from a branch → `main` / `(root)` → Save**.
Une minute plus tard, l'app est en ligne sur `https://TON-PSEUDO.github.io/guide-chevre-miel/`.

### 5. Vérifier avant de lui envoyer

1. Ouvre le lien : le bandeau « Mode démo » ne doit **pas** apparaître.
2. Cherche une pizzeria → **Noter une pizza ici** → enregistre. L'app demande le code secret : tape-le.
3. Recharge la page : la pizza est toujours là. Ouvre le lien sur un autre téléphone : elle y est aussi.
4. Supprime cette pizza de test (fiche de la pizza → 🗑️), puis le resto (fiche du resto → ••• → Supprimer).
5. Onglet **Actions** du dépôt : active les workflows si GitHub le demande, puis lance une fois **Garder Supabase éveillé → Run workflow**. Il doit finir en vert et afficher `"miam"`.

Pour repartir d'une page blanche sur ton téléphone : menu ☰ → **Code secret** (en bas) efface le code enregistré.

### 6. Lui envoyer

Envoie-lui **le lien et le code secret**, si possible par deux messages séparés.

Pour l'installer comme une appli :
- **iPhone** : ouvrir le lien dans **Safari** → bouton Partager → **Sur l'écran d'accueil**, **puis** ouvrir l'icône et taper le code dedans.
  L'app installée a son propre stockage, séparé de Safari : un code tapé dans Safari n'y serait pas connu.
  Et Safari efface les données d'un site après 7 jours sans visite, contrairement à l'app installée. Avec l'icône, elle ne retapera jamais le code.
- **Android** : ouvrir dans **Chrome** → menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).

---

## Mode d'emploi (pour elle)

- **Chercher** un resto dans la barre du haut. Les restos déjà notés apparaissent en premier.
- **Resto introuvable ?** Appui long sur la carte à l'endroit exact → « Noter une pizza ici » → on donne le nom.
- **Noter** : note sur 10 (obligatoire), détail chèvre / miel / pâte (facultatif), date, prix, commentaire, photo.
- **☰** en haut à gauche : toutes les pizzas, triées par date, par note ou par resto.
- Sur la carte, chaque épingle affiche la **moyenne du resto**.
- **◎** en bas à droite : se localiser (pratique quand on est déjà attablée).
- **Itinéraire** (fiche du resto) : ouvre Plans sur iPhone, Google Maps ailleurs.

---

## Dépannage

| Symptôme | Cause probable | Que faire |
|---|---|---|
| Le bandeau « Mode démo » reste affiché | `config.js` pas rempli, ou ancienne version en cache | Vérifier `config.js` sur GitHub, puis recharger en forçant (Ctrl+Maj+R) |
| « Impossible de charger le guide (projet en pause ?) » | Supabase a mis le projet en veille | Dashboard Supabase → le projet → **Resume project**. Les données sont conservées |
| « Mauvais code » alors que c'est le bon | Faute de frappe, ou code changé côté base | SQL Editor : `select pin from private.secret;` |
| « Impossible de vérifier le code (réseau ou configuration) » | Réseau coupé, mauvaise URL ou clé, **ou** le navigateur bloque l'en-tête `x-pin` | Vérifier `config.js`. Si l'erreur persiste avec une bonne config, voir la note ci-dessous |
| Le resto n'apparaît pas dans la recherche | Il n'existe pas dans OpenStreetMap | Appui long sur la carte |
| Le workflow « Garder Supabase éveillé » est désactivé | GitHub coupe les tâches planifiées après 60 jours sans activité | Onglet Actions → le réactiver d'un clic |

**Note sur l'en-tête `x-pin`** : la sécurité repose sur un en-tête HTTP ajouté à chaque écriture, lu par Postgres via `current_setting('request.headers')`. C'est une méthode documentée par Supabase, mais je n'ai pas pu la tester depuis un navigateur contre un vrai projet. Si le navigateur la bloque (erreur CORS dans la console), la solution de repli est de faire passer le code en paramètre de fonctions SQL. Ça représente environ 30 lignes à changer.

---

## Limites à connaître

- **Pas de sauvegarde automatique** dans l'offre gratuite de Supabase. Pour garder une copie : Table Editor → `pizzas` → **Export to CSV** de temps en temps.
- **Mise en veille** : Supabase gratuit met en pause un projet inactif 7 jours. Le workflow GitHub le réveille tous les 3 jours. S'il échoue, tu reçois un mail de Supabase et un clic sur « Resume » suffit.
- **Photos** : compressées dans le navigateur (≈150 Ko + une miniature de 15 Ko). Les 500 Mo gratuits laissent de la marge pour des milliers de pizzas.
- **Lecture publique** : toute personne qui a le lien voit les notes, mais ne peut pas écrire sans le code.
- **Fond de carte** : OpenFreeMap est gratuit, sans clé ni limite, mais c'est un service bénévole fourni tel quel. S'il disparaissait, il suffirait de changer l'adresse du style dans `app.js` (par exemple pour une clé CARTO gratuite). Si le téléphone ne gère pas WebGL, l'app bascule toute seule sur les tuiles OpenStreetMap standard.
