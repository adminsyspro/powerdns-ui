# Certificats internes : passer des secrets Infisical à la gestion de certificats native ?

Analyse et plan, version du 24/11/2026. Aucun code n'a été écrit. Aucune écriture n'a été faite sur l'Infisical de production ni sur PowerDNS-UI en service.

---

## 0. Orientation retenue (24/11/2026)

> **PowerDNS-UI génère les certificats.** Ils doivent pouvoir être **servis depuis Infisical**, et à terme **depuis d'autres fournisseurs**.

Conséquences sur ce plan :

- **PowerDNS-UI reste l'unique émetteur** (option A du § 2).
- Deux pistes sont écartées, parce qu'elles contournent PowerDNS-UI :
  - Infisical émetteur (B, § 4.4) ;
  - cert-manager en ACME direct sur step-ca (§ 4.3).
- La synchronisation Infisical actuelle, codée en dur, devient une **couche de distribution à fournisseurs interchangeables** (§ 3 bis). Le premier fournisseur est « Infisical — secrets ». L'isolation par consommateur passe par un projet par consommateur (§ 3).

La synthèse d'origine suit, inchangée sur le fond.

## 0 bis. Synthèse de l'analyse

**Réponse à la question décisive.** Oui, la gestion de certificats native d'Infisical permet de limiter un consommateur à son seul certificat sans rôle personnalisé.

- Le moyen : une **Application** PKI par consommateur. L'identité machine de ce consommateur y est membre avec le rôle intégré **Operator**, qui lit les clés privées des certificats de cette Application et d'elle seule.
- Ces rôles d'Application sont intégrés et non soumis à licence en v0.166.3 (§ 1.3).

Le chantier est donc **techniquement viable**. Je ne le recommande pourtant pas comme cible immédiate, pour quatre raisons :

1. **Infisical devrait émettre lui-même.** L'issuer cert-manager d'Infisical ne sait que demander une nouvelle émission à un profil. Un certificat importé par PowerDNS-UI ne lui sert à rien.
2. Infisical deviendrait alors un **second client ACME** de step-ca, en doublon de PowerDNS-UI.
3. Cela impose de **modifier la configuration de l'Infisical de production** (`ALLOW_INTERNAL_IP_CONNECTIONS`, confiance dans la racine step-ca) et d'**exposer step-ca**, aujourd'hui joignable uniquement dans le réseau Docker de PowerDNS-UI.
4. Les **PKI Syncs sont payants**. Les serveurs nginx devraient donc passer à l'agent Infisical, et ses certificats changent d'identifiant à chaque renouvellement.

**Recommandation : un projet Infisical par consommateur, avec le rôle intégré `Viewer` (option D).**

- PowerDNS-UI reste l'unique émetteur et continue de déposer `PRIVKEY`/`CERT`/`CHAIN`/`FULLCHAIN`. Il gagne une notion de « destinations » par certificat (projet, environnement, chemin).
- Le cloisonnement est garanti par la frontière du projet, avec un rôle intégré documenté comme gratuit sur toutes les éditions.
- `sync-certs.sh` reste inchangé : seul `/etc/infisical/env` change.
- **Ascender** récupère son certificat par l'**Infisical Kubernetes Operator** (`InfisicalSecret` avec un modèle vers un secret `kubernetes.io/tls` dédié, `ascender-tls-infisical`). C'est l'option K1, décidée le 24/11 avec les conditions C1 à C4 (§ 3 ter, § 5.3).

**Dépannage immédiat possible, sans code :** des *Additional Privileges* sur le projet `PDNS`. La fonction est gratuite mais marquée « legacy » et déjà retirée des nouveaux projets. C'est une rustine, pas une cible (§ 4.2).

---

## 1. Ce que notre édition permet réellement

### 1.1 Notre instance

| Élément | Constat | Comment |
|---|---|---|
| URL | `https://vault.api-and-you.net` (10.10.10.63), page titrée « Infisical » | DNS + HTTP. **À confirmer** : c'est bien le `site_url` des réglages Infisical de PowerDNS-UI (non lu, voir § 6) |
| Version | **v0.166.3**, publiée le 08/10/2026 | Nom du bundle servi : `/assets/index-v0-166-3-….js`. `GET /api/status` ne renvoie pas de version ([routes/index.ts](https://github.com/Infisical/infisical/blob/df8bb75adb1b16b943ed9b0343be3afa7bf69350/backend/src/server/routes/index.ts)). Date via l'API GitHub des releases |
| Édition | Auto-hébergée **sans licence** (valeurs par défaut on-prem) | Écran « Organization Subscription Required » sur les rôles personnalisés, cohérent avec `rbac: false` |
| `/api/status` | `inviteOnlySignup: true`, `redisConfigured: true`, `emailConfigured: true`, `auditLogStorageDisabled: false` | Lecture publique, sans authentification |
| Menus de l'instance | **Non vérifiés** : je n'ai pas de session sur l'interface | § 6 |

Toutes les vérifications de code ci-dessous portent sur le **tag v0.166.3**, et non sur `main`, sauf mention contraire.
Base des liens : `https://github.com/Infisical/infisical/blob/v0.166.3/`.

### 1.2 Fonctionnalités soumises à licence : valeurs par défaut sans licence

Source : `backend/src/ee/services/license/license-fns.ts`, fonction `getDefaultOnPremFeatures`, lignes 57 à 142.

| Fonctionnalité | Sans licence | Conséquence pour nous |
|---|---|---|
| `rbac` (rôles personnalisés) | **false** (L68) | Le blocage est **aussi côté API** : `role-service.ts` refuse la création, la modification et l'assignation d'un rôle personnalisé (vérifié sur main) |
| `secretsFolderRbac` (contrôle d'accès par dossier) | **false** (L142) | Le remplaçant officiel des *Additional Privileges* est payant |
| `workspaceLimit` (projets), `identityLimit` | **null** = illimité (L57, L61) | Un projet et une identité par consommateur : possible |
| `certManager` (produit Certificate Manager) | **null** = disponible (L138) | Le produit PKI est utilisable |
| `pkiAcme` (serveur ACME d'Infisical) | **true** (L117) | — |
| `caCrl` | **true** (L121) | CRL limitée à 7 jours sans licence (doc `ca/crl-distribution.mdx`) |
| `maxCas` | **1** (L131) | **Une seule CA par organisation, tous types confondus** (`certificate-authority-quota-fns.ts`) |
| `pkiEnterpriseCaIntegrations` | **false** (L123) | Ne concerne **pas** les CA ACME. Le test est `type !== INTERNAL && type !== ACME && !plan.pkiEnterpriseCaIntegrations` (`certificate-authority-service.ts` L348). **Une CA externe ACME est donc gratuite** |
| `pkiSyncs` | **false** (L128) | Pas de poussée automatique vers les serveurs |
| `pkiEst`, `pkiScep`, `pkiOcsp`, `pkiApprovals`, `pkiDiscovery`, `pkiEnterpriseAlerting`, `pkiExternalIntermediateCa` | **false** | Alertes par email seulement, pas d'OCSP |
| `pkiLegacyTemplates` | **false** (L129) | Les anciens *certificate templates* et *PKI subscribers* sont abandonnés. Le modèle actuel est **Policies → Profiles → Applications** (doc `pki/overview.mdx`, `pki/migration.mdx`) |

### 1.3 Certificate Management : détail

| Besoin | Disponible ? | Source et remarques |
|---|---|---|
| CA interne Infisical | Oui, mais elle consomme l'unique CA autorisée | `pki/ca/private-ca.mdx` |
| **step-ca comme CA externe ACME** | **Oui en principe.** URL de répertoire libre (`z.string().url()`), EAB facultatif. **DNS-01 uniquement**. Fournisseurs DNS : Route53, Cloudflare, DNS Made Easy, Azure DNS, **PowerDNS**, GCP, UltraDNS ; **pas de RFC2136** | `acme-certificate-authority-enums.ts` ; `acme-certificate-authority-schemas.ts` ; doc `pki/ca/acme-ca.mdx` |
| … contraintes pour step-ca interne | Une IP privée est refusée sauf `ALLOW_INTERNAL_IP_CONNECTIONS=true` (garde anti-SSRF). Aucun champ « racine de confiance » : il faut `NODE_EXTRA_CA_CERTS` sur le conteneur Infisical. La **Gateway**, qui permettrait d'atteindre un réseau privé, est **payante** | `acme-certificate-authority-fns.ts` (`blockLocalAndPrivateIpAddresses`) ; doc `self-hosting/configuration/envars.mdx`, `guides/custom-certificates.mdx` (vérifié sur main) |
| Import d'un certificat existant avec sa clé | Oui : `POST /api/v1/cert-manager/certificates/import-certificate` (PEM ou PKCS#12, `applicationId`, `profileId` facultatif). **Sans profil, le certificat importé ne sert qu'à l'inventaire et aux alertes** | `certificate-router.ts` ; doc `applications/certificates.mdx` (main) |
| Récupération par API | `GET /api/v1/cert-manager/certificates/{id}/bundle`, `/certificate`, `/private-key`, `POST …/search`. **Un renouvellement crée un nouveau certificat (nouvel id)** : un client doit donc rechercher le certificat courant | doc `api-reference/endpoints/certificates/*`, `applications/certificate-renewal.mdx` |
| Infisical comme serveur ACME | Oui (gratuit). Répertoire et EAB par couple Application + Profile. Challenges documentés en v0.166.3 : **HTTP-01 ou « Skip validation »** ; DNS-01 n'est pas documenté | doc `pki/applications/enrollment-methods/acme.mdx` (v0.166.3, L55-67) |
| Agent pour nginx | `infisical cert-manager agent` : émet, écrit sur disque, renouvelle, lance un hook (reload) | doc `pki/reference/infisical-agent.mdx` (main) |
| PKI Syncs | **Payant** | `pkiSyncs: false` |

### 1.4 Intégration cert-manager

- **[Infisical/infisical-issuer](https://github.com/Infisical/infisical-issuer)** est un émetteur externe pour cert-manager.
  - CRD `Issuer`/`ClusterIssuer` dans le groupe `infisical-issuer.infisical.com/v1alpha1`. Champs : `url`, `tls.caCertificate`, `application`, `profile`, et une authentification `universal`, `kubernetes` ou `tlsCert`.
  - Il appelle `POST /api/v1/cert-manager/certificates`, attend la fin de la demande, puis lit le bundle. cert-manager pilote le renouvellement (`renewBefore`).
  - L'identité doit être membre de l'Application avec le rôle **operator**.
  - **Il demande toujours une nouvelle émission** : il suppose qu'Infisical est l'émetteur.
  - Compilé contre cert-manager **v1.15.3** (`go.mod`). Compatibilité avec la v1.21.3 : **non documentée**.
  - Sources : `api/v1alpha1/issuer_types.go`, `internal/issuer/signer/signer.go`, doc `guides/applications/k8s-cert-manager-issuer.mdx`.
- **Variante :** l'issuer ACME natif de cert-manager, avec EAB, vers le serveur ACME d'Infisical. Même hypothèse : Infisical émet.
- **Infisical Kubernetes Operator**, sans cert-manager : la CRD `InfisicalSecret` lit des **secrets** clé/valeur et accepte `secretType` et des modèles Go. Elle peut donc produire un secret `kubernetes.io/tls` (`tls.crt` = FULLCHAIN, `tls.key` = PRIVKEY) et le resynchronise périodiquement. Je n'ai pas trouvé de CRD de l'Operator qui lise les certificats PKI.
  - Sources : doc `integrations/platforms/kubernetes/infisical-secret-crd.mdx`, `infisical-static-secret-crd.mdx`.

### 1.5 Le point décisif : cloisonner un consommateur sans rôle personnalisé

| Mécanisme | Gratuit ? | Granularité | Pérennité |
|---|---|---|---|
| Rôle personnalisé limité à un chemin (la doc actuelle, § 1) | **Non** | Le chemin | — |
| Rôle intégré Viewer sur `PDNS` | Oui | **Tout le projet**, donc toutes les clés privées TLS | — |
| **Application PKI + rôle intégré Operator** | **Oui** : rôles d'Application intégrés, pas de contrôle de licence dans `pki-application-membership-service.ts` | L'Application. **Pas de restriction à un certificat précis à l'intérieur d'une Application** : il faut une Application par consommateur | Modèle PKI actuel, mais qui a beaucoup changé en 2026 |
| **Projet par consommateur + Viewer** | **Oui** : rôles intégrés « available on all plans, including free self-hosted » (doc `access-controls/role-based-access-controls.mdx`). Aucune limite de projets ni d'identités | Le projet | **Stable** : c'est le modèle de base d'Infisical |
| *Additional Privileges* (identité en *No Access* + privilège « lecture des secrets » sur `/DATACENTER/<cert>/**`) | Oui : aucun contrôle de licence dans le service | Le chemin | **Fragile**, voir ci-dessous |
| Contrôle d'accès par dossier (*Folder-level Access Control*) | **Non** (`secretsFolderRbac: false`) | Le dossier | — |

Pourquoi les *Additional Privileges* sont fragiles :

- La migration `20260820120000_add-legacy-additional-privileges-enabled-to-project.ts` ajoute `isLegacyAdditionalPrivilegesEnabled`. Elle le met à `true` sur **les projets existants**, avec `false` par défaut pour **les nouveaux projets**.
- L'API refuse la création si le drapeau vaut `false` : « Additional privileges are not available for project… Use project roles or folder access controls instead. » (`project-additional-privilege-factory.ts` L448).
- L'interface affiche alors « Additional Privileges Moved to Folder-Level Access », c'est-à-dire la fonction payante.
- `PDNS` existait avant cette migration. Il a donc **probablement** le drapeau, mais c'est **à vérifier**.

**Conclusion.** La gestion de certificats native **ne requiert pas** de rôle personnalisé pour isoler un consommateur. La même isolation s'obtient aussi, plus simplement, avec un **projet de secrets par consommateur**. Le facteur commun est la **frontière (projet ou Application) + un rôle intégré**, pas la PKI en elle-même.

---

## 2. Qui émet dans la cible ?

| | **A. PowerDNS-UI émet** (situation actuelle), puis dépose dans Infisical | **B. Infisical émet** (step-ca déclaré comme CA ACME), PowerDNS-UI ne fait plus que le DNS |
|---|---|---|
| DNS-01 | Inchangé : PowerDNS-UI écrit les TXT, avec ses garde-fous (fusion et nettoyage par valeur, reprise après crash) | Infisical écrit les TXT via son connecteur PowerDNS (`X-API-Key`). Soit avec une clé PowerDNS **à pleins droits sur toutes les zones**, soit, mieux, via le **proxy API de PowerDNS-UI** avec un jeton limité à `_acme-challenge` (proxy compatible avec l'API PowerDNS, README § API Proxy ; compatibilité avec le client Infisical **non vérifiée**) |
| Chemin réseau | Inchangé : `step-ca:9000` dans le réseau compose | Infisical (10.10.10.63) doit joindre step-ca. Il faut **publier le port 9000**, ajouter un SAN joignable (aujourd'hui `step-ca,localhost` seulement), `ALLOW_INTERNAL_IP_CONNECTIONS=true` et `NODE_EXTRA_CA_CERTS` sur Infisical. Ce sont **des écritures sur la production** |
| Propagation DNS | Le résolveur côté PowerDNS-UI est réglable (`INTERNAL_CA_PROPAGATION_RESOLVER`) | Infisical a un `dnsResolver` facultatif. Comportement face à step-ca **non testé** |
| cert-manager (Ascender) | L'issuer Infisical est **inutilisable** : il émet, il ne lit pas un certificat importé. Il faut passer par l'Operator (secrets) ou par l'ACME direct vers step-ca | L'issuer Infisical fonctionne nativement |
| nginx | `sync-certs.sh` inchangé (secrets) | Agent Infisical, ou script réécrit (recherche du certificat courant, car l'id change à chaque renouvellement). Pas de PKI Sync gratuit |
| Inventaire et alertes | UI PowerDNS-UI | UI Infisical, alertes email gratuites |
| Quota | — | L'unique CA autorisée est prise par step-ca |
| Code PowerDNS-UI | Modéré : destinations | Faible si l'on abandonne l'émission ; mais la fonction « SSL Certificates » de PowerDNS-UI devient redondante |
| Points de défaillance | 1 émetteur | 2 émetteurs pendant la transition, et une dépendance de plus (Infisical) sur le chemin d'émission |

**Variante A′ (PowerDNS-UI émet et *importe* dans la PKI Infisical).**

- Elle donne l'inventaire et l'isolation par Application, mais **pas** cert-manager.
- Chaque renouvellement importe un nouveau certificat : les clients doivent rechercher le certificat courant.
- Faible valeur par rapport à l'option D, qui garde le format clé/valeur attendu par les consommateurs actuels.

**Position : rester en A** (PowerDNS-UI unique émetteur). Ne réévaluer B que si l'on veut un jour retirer l'émission de PowerDNS-UI.

---

## 3. Architecture cible recommandée

```
                     ┌──────────── PowerDNS-UI (émetteur unique) ────────────┐
step-ca ◄── ACME ────┤  DNS-01 → PowerDNS ; renouvellement J-30              │
                     │  pour chaque certificat : N destinations Infisical     │
                     └──────┬───────────────────┬──────────────────┬──────────┘
                            │ (transition)      │                  │
                 projet PDNS /DATACENTER/…   projet tls-ascender  projet tls-proxcenter …
                 (admins seulement à terme)  /ascender-api-infra  /proxcenter-api-infra
                                                   │ Viewer            │ Viewer
                                     Infisical Operator (k3s)   sync-certs.sh (cron)
                                     → Secret kubernetes.io/tls  → /etc/nginx/ssl/…
                                       ascender/ascender-tls-infisical
```

- **Un projet Infisical « secrets » par consommateur**, avec un nom normalisé (proposition : `tls-<consommateur>`) et un seul environnement (`production`).
- **Une identité machine par consommateur**, avec le rôle **Viewer** sur son projet uniquement.
- **L'identité de PowerDNS-UI est membre (Member) de chaque projet consommateur**, pour pouvoir écrire. Ajout manuel à la création du projet (créer les projets depuis PowerDNS-UI exigerait des droits au niveau de l'organisation : écarté en v1).

**Évolution de PowerDNS-UI :**

- Plusieurs destinations par certificat (projet, environnement, chemin), pour qu'un certificat partagé puisse aller vers plusieurs projets. Le modèle complet, générique et multi-fournisseurs, est au § 3 bis.
- La configuration globale actuelle devient la **destination par défaut** (le projet `PDNS`). Elle reste active pendant toute la transition.
- La synchronisation passe sur toutes les destinations. Les erreurs sont journalisées par destination.
- L'interface du certificat gagne une section « Destinations Infisical », et un test de connexion par destination (lecture seule).
- Hors périmètre, mais à signaler : un échec de synchronisation après renouvellement **n'est jamais retenté automatiquement**. C'est le cas aujourd'hui (§ 5.1). Une reprise périodique des certificats « émis mais non synchronisés » serait un ajout naturel. **À décider.**

**Consommateurs Kubernetes (Ascender) :**

- On installe l'Infisical Operator (Helm), puis une `InfisicalSecret` avec Universal Auth (identité `k8s-ascender`) et un modèle produisant `kubernetes.io/tls` dans `ascender/ascender-tls-infisical`.
- `tls.crt` = `FULLCHAIN`, `tls.key` = `PRIVKEY`. `resyncInterval` vaut quelques minutes.
- cert-manager n'intervient pas pour ce certificat. Il faut vérifier qu'aucun `Certificate` ne vise le même secret.

**Consommateurs nginx :** le script `sync-certs.sh` reste inchangé. Seuls `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID/SECRET` et `INFISICAL_BASE_PATH` changent.

---

## 3 bis. Conception : couche de distribution à fournisseurs

### Constat sur le code actuel

- La distribution est codée en dur. `acme-engine.ts` (étape 6b) appelle `syncCertToInfisical`, et `api/certs/[id]/route.ts` appelle `deleteCertFromInfisical` à la suppression.
- La configuration est un **singleton** (`infisical_config`) : une instance, un projet, un environnement.
- Le chemin est **calculé** à partir de la catégorie et du nom. *(Correction du 24/11 : l'API refuse déjà de changer la catégorie d'un certificat émis (409). Le risque de copie oubliée ne vient donc pas de là, mais d'un changement de la cible elle-même, par exemple le chemin de base d'une connexion. La réconciliation le couvre.)*
- Aucun état n'est conservé par destination. Seul `infisical_synced_at` existe, et un échec n'est pas retenté.
- L'écriture sur disque (`materializeCert`, export NFS) est un **autre mode de distribution**, lui aussi codé en dur.

### Modèle proposé

**Le fournisseur (`DistributionProvider`)** est une interface côté serveur :

```ts
interface DistributionProvider<TConn, TTarget> {
  type: string;                                    // 'infisical-secrets', plus tard 'vault-kv', 'k8s-secret'…
  validateConnection(conn: TConn): void;           // schéma de la connexion (URL, identité…)
  validateTarget(target: TTarget): void;           // schéma de la cible (projet, env, chemin…)
  test(conn, target): Promise<TestResult>;         // lecture seule : authentification + droit d'écrire sur la cible
  publish(conn, target, material: CertMaterial): Promise<PublishResult>;   // idempotent
  unpublish(conn, target, ref: PublishResult): Promise<void>;              // retrait de ce qui a été publié
}
// CertMaterial = { name, category, leafPem, chainPem, fullchainPem, privkeyPem, fingerprintSha256, notAfter }
```

**Deux tables** remplacent `infisical_config`, qui est migrée :

- **`distribution_connections`** : une instance de fournisseur avec ses identifiants. Exemple : « Infisical prod », avec l'URL, le client ID et le client secret chiffré par `encrypt()`. Le secret n'est jamais renvoyé par l'API : on n'expose que `hasSecret`, comme aujourd'hui.
- **`certificate_distributions`** : un certificat × une connexion × une **cible figée**, par exemple `{projectId, environment, path}`. Chaque ligne porte son état :
  - `published_fingerprint`, `published_at`, `published_target` (là où les données ont été écrites, pour pouvoir les retirer) ;
  - `last_error`, `next_attempt_at`.

**Le worker de distribution** réconcilie en boucle. Il republie chaque distribution dont `published_fingerprint` diffère de l'empreinte du certificat, ou dont la cible a changé (il retire d'abord l'ancienne cible), avec un backoff en cas d'erreur.

- Une seule boucle traite le renouvellement, la reprise après échec et le déplacement de cible.
- Le crochet de l'étape 6b se réduit à « réveiller le worker ».

**Les règles par catégorie** (facultatives) : une catégorie peut porter des distributions par défaut, appliquées à la création d'un certificat. On les modifie ensuite certificat par certificat. La configuration globale actuelle devient une règle par défaut pour toutes les catégories, ce qui préserve le comportement existant.

### Fournisseurs

| Fournisseur | Cible | Usage | Quand |
|---|---|---|---|
| **`infisical-secrets`** | projet, environnement, chemin. Clés `PRIVKEY`/`CERT`/`CHAIN`/`FULLCHAIN` | nginx (`sync-certs.sh`), Kubernetes via l'Infisical Operator | **v1** (reprise du code actuel, cible paramétrable) |
| **`filesystem`** | répertoire (`CERTS_DIR`), mode groupe (NFS : `CERTS_UID`/`CERTS_GID`) | Reprise de `materializeCert`, c'est-à-dire l'existant : écriture dans `live/<nom>/` et export NFS | **v1** (décidé le 24/11). Une connexion « Disque local » est créée d'office et **appliquée à tous les certificats**, pour que le comportement actuel reste identique |
| `infisical-pki-import` | Application et profil facultatif (`import-certificate`) | Inventaire et alertes d'expiration Infisical (gratuit). **Non consommable** par l'issuer cert-manager | Plus tard, si besoin |
| `vault-kv` (HashiCorp Vault ou OpenBao) | point de montage et chemin KV v2 | Autre coffre | Plus tard |
| ~~`k8s-secret`~~ | — | Poussée directe chez le consommateur | **Pas au programme** (décision du 24/11, § 3 ter). Réservé à un consommateur qui ne pourrait pas joindre Infisical |

### API et interface

- **Réglages → Distribution** :
  - liste des connexions (CRUD, test) ;
  - pour Infisical, le formulaire actuel, renommé et multi-instances.
- **Fiche certificat → Distributions** :
  - lignes connexion × cible, avec leur état : dernier envoi, empreinte publiée, erreur ;
  - boutons « Publier maintenant » et « Tester ».
- Le bouton « Sync to Infisical » devient « Publier partout ». Les routes `api/certs/infisical/*` sont conservées en alias le temps de la transition.
- Les événements existants `infisical_synced`/`infisical_sync_error` sont généralisés en `distribution_published`/`distribution_error`, avec la connexion et la cible.

### Migration des données (sans changement de comportement)

1. `infisical_config` devient une `distribution_connection` « Infisical » (identité et secret chiffré repris tels quels), plus une règle par défaut `{project_id, environment, secret_base_path}/<CATEGORIE>/<nom>`.
2. Chaque certificat avec `infisical_synced_at` reçoit une `certificate_distribution` vers sa cible actuelle, avec l'empreinte courante. Il n'y a donc **aucune republication massive** au démarrage.
3. Les consommateurs actuels ne voient aucune différence. Les projets par consommateur s'ajoutent ensuite, comme distributions supplémentaires.

---

## 3 ter. Consommateurs Kubernetes (Ascender) : tirer depuis Infisical ou pousser depuis PowerDNS-UI

> **Décision du 24/11/2026 : K1, avec les quatre conditions du PO Ascender (§ 5.3). K2 n'est pas au programme.**
>
> K2 est rejeté parce qu'il donne à PowerDNS-UI un accès en écriture à l'API de chaque cluster consommateur. Une PowerDNS-UI compromise pourrait remplacer un certificat servi. Le principe retenu : **chaque consommateur vient chercher son certificat**, aucun point central n'écrit chez les consommateurs.
>
> L'option « cert-manager → step-ca en ACME HTTP-01 via Traefik » est **écartée** : on perdrait l'inventaire central dans PowerDNS-UI, et step-ca devrait joindre la VM sur le port 80 et résoudre `api.infra`. Voir aussi § 4.3.

Dans les deux options, **cert-manager ne sert pas** pour ce certificat. cert-manager sait *faire émettre* un certificat, mais aucun de ses émetteurs ne sait *récupérer* un certificat émis ailleurs. Avec K1, le PO propose de **retirer cert-manager du cluster Ascender** : l'Operator entre, cert-manager sort.

### Option K1 : Infisical Operator (tirer)

```
PowerDNS-UI ──publie──► Infisical, projet tls-ascender ◄──lit toutes les N s── Operator (k3s) ──écrit──► Secret ascender-tls-infisical
```

- **Dans le cluster** : on installe le chart Helm `secrets-operator` (un contrôleur et ses CRD), puis on crée une ressource `InfisicalSecret` qui :
  - s'authentifie avec l'identité `k8s-ascender` (Universal Auth, client ID et secret dans un Secret Kubernetes du cluster) ;
  - lit `tls-ascender` / `production` / `/ascender-api-infra` ;
  - produit un secret `kubernetes.io/tls` par modèle (`tls.crt` ← FULLCHAIN, `tls.key` ← PRIVKEY) ;
  - se resynchronise toutes les `resyncInterval` secondes.
- **Réseau** : un seul flux, de k3s vers Infisical (10.99.99.98 → 10.10.10.63:443), sortant depuis le cluster.
- **Renouvellement** : PowerDNS-UI renouvelle et publie. L'Operator met le Secret à jour au resync suivant, et l'Ingress (Traefik) prend le nouveau certificat sans redémarrage.
- **Si Infisical est indisponible** : le Secret existant reste en place, donc pas de coupure avant l'expiration (30 jours de marge).
- **Côté PowerDNS-UI** : rien de plus que la v1 (fournisseur `infisical-secrets`). **Disponible dès la v1.**
- **Inconvénients** :
  - un composant de plus à maintenir dans chaque cluster ;
  - un identifiant Infisical stocké dans le cluster ;
  - un délai de resynchronisation ;
  - PowerDNS-UI ne voit pas si le cluster a bien récupéré le certificat. Il sait seulement qu'il l'a publié dans Infisical.

### Option K2 : fournisseur `k8s-secret` (pousser)

```
PowerDNS-UI ──API Kubernetes (PATCH)──► Secret ascender-tls-secret
```

- **Dans le cluster** :
  - un ServiceAccount, avec un Role limité à `get`/`update`/`patch` sur **ce seul secret** (`resourceNames`) ;
  - le secret est **créé à l'avance**, car `create` ne peut pas être restreint par nom ;
  - un jeton longue durée pour ce ServiceAccount.
- **Côté PowerDNS-UI** : une connexion par cluster (URL de l'API, CA du cluster épinglée, jeton chiffré). La cible est un namespace et un nom de secret.
- **Réseau** : de PowerDNS-UI vers l'API k3s (10.19.19.253 → 10.99.99.98:6443), **un flux entrant dans le cluster**. À ouvrir et à valider côté pare-feu.
- **Renouvellement** : immédiat. L'empreinte publiée, la date et l'erreur éventuelle sont visibles dans PowerDNS-UI.
- **Infisical** n'est pas sur le chemin pour ce consommateur.
- **Inconvénients** :
  - **développement supplémentaire** (v2) : Ascender attend donc la fin du chantier ;
  - un accès à l'API Kubernetes stocké dans PowerDNS-UI. L'impact est limité, car PowerDNS-UI détient déjà toutes les clés privées.

### Comparaison

| Critère | K1 : Operator (tirer) | K2 : `k8s-secret` (pousser) |
|---|---|---|
| Disponible | **v1** | v2 (plus de code) |
| Composant dans le cluster | Operator + CRD | Aucun (RBAC seul) |
| Flux réseau | k3s → Infisical (sortant) | PowerDNS-UI → API k3s (entrant) |
| Identifiant stocké | Dans le cluster (identité Infisical, lecture seule) | Dans PowerDNS-UI (jeton k8s, écriture sur un secret) |
| Délai après renouvellement | `resyncInterval` | Immédiat |
| Visibilité dans PowerDNS-UI | Jusqu'à Infisical seulement | Jusqu'au Secret Kubernetes |
| « Servi depuis Infisical » | Oui | Non (autre fournisseur) |
| Plusieurs clusters | Un Operator par cluster | Une connexion par cluster |

**Recommandation : K1 pour Ascender.**

- C'est disponible dès la v1, sans ouverture réseau entrante.
- Le pilote valide de bout en bout le modèle « projet par consommateur ».
- C'est cohérent avec l'objectif de servir les certificats depuis Infisical.

**K2 n'est pas planifié.** On ne le développerait que pour un consommateur qui ne peut pas joindre Infisical, et cela demanderait une décision explicite.

L'identifiant Infisical stocké dans le cluster ne donne accès qu'à la clé que le cluster détient déjà. **C'est vrai à une condition : que le projet `tls-ascender` ne contienne rien d'autre.** Le modèle « un projet par consommateur » est donc une condition de sécurité, pas un confort.

---

## 4. Alternatives évaluées

### 4.1 Projet par consommateur : **retenue** (§ 3)

- Avantages : gratuit, pérenne, compatible avec l'existant, sans changement de réseau ni de configuration de production côté Infisical.
- Inconvénients : un projet par consommateur à créer à la main, et quelques lignes de code dans PowerDNS-UI.

### 4.2 *Additional Privileges* sur `PDNS` : rustine de court terme, **non retenue** (décision du 24/11/2026)

- Identité `ascender` avec le rôle `No Access` sur `PDNS`, plus un privilège permanent « lecture des secrets » conditionné sur `secretPath` = `/DATACENTER/ascender-api-infra/**`. Aucun code.
- Conditions : `PDNS` doit avoir `isLegacyAdditionalPrivilegesEnabled = true` (la section « Additional Privileges » doit apparaître sur la fiche de l'identité). Il faut aussi tester qu'une identité ainsi configurée ne voit **que** ce chemin.
- Risque : la fonction est en voie de retrait, au profit d'une fonction payante. Une mise à jour pourrait la supprimer.
- Usage : débloquer Ascender **pendant** le développement de l'option D, pas au-delà.

### 4.3 cert-manager ACME branché directement sur step-ca : **écartée** (contourne PowerDNS-UI, voir § 0)

- Un `ClusterIssuer` ACME (`server: https://<step-ca joignable>/acme/acme/directory`, `caBundle` = racine interne).
- La clé est **générée dans le cluster et n'en sort jamais**, ce qui est meilleur que de la faire transiter par Infisical.
- Le renouvellement est géré par cert-manager, déjà installé en v1.21.3.
- Prérequis : **step-ca joignable depuis 10.99.99.98**. Il faut publier le port 9000 et ajouter un SAN, ce qui change le déploiement de step-ca.
- Pour le challenge, deux possibilités :
  - **HTTP-01** : le plus simple, sans aucun identifiant DNS. Il faut que step-ca joigne `ascender.api.infra:80` (Traefik k3s) ;
  - **DNS-01** : cert-manager n'a **pas** de solveur PowerDNS intégré. Il faut soit RFC2136 (TSIG, `dnsupdate=yes` côté PowerDNS), soit un webhook tiers PowerDNS pointé de préférence sur le **proxy API de PowerDNS-UI** avec un jeton limité à `_acme-challenge.ascender.api.infra`.
- Effet de bord : ce certificat n'est plus géré par PowerDNS-UI (ni inventaire, ni Infisical). C'est acceptable pour un consommateur Kubernetes.

### 4.4 Gestion de certificats native Infisical, émetteur : **écartée** (§ 0)

La PKI Infisical ne reste envisageable que comme **fournisseur de distribution** `infisical-pki-import` (inventaire et alertes), pas comme émetteur (§ 3 bis).

---

## 5. Migration des consommateurs existants (sans coupure)

**Principe : double écriture.** PowerDNS-UI continue d'écrire dans `PDNS` tant que le dernier consommateur n'a pas basculé. Un consommateur bascule en changeant seulement sa configuration, et le retour arrière consiste à remettre l'ancienne.

### 5.1 Phase 0 : constat sur les certificats expirés (lecture seule, sans correction)

**Constaté le 24/11/2026** (handshake TLS) :

| Hôte | Émetteur | Validité |
|---|---|---|
| `proxcenter.api.infra` (10.99.99.200) | API AND YOU Internal Intermediate CA | 09/07/2026 → **07/10/2026, expiré** |
| `astreintes.api.infra` (10.10.10.32) | idem | 09/07/2026 → **07/10/2026, expiré** |
| `ascender.api.infra` (10.99.99.98) | **auto-signé** (`O=API AND YOU, CN=ascender.api.infra`), valable du 24/11 au 24/12/2026 | Aucun certificat interne déployé |

Le renouvellement aurait dû avoir lieu vers le 07/09, à J-30. L'échec se situe donc entre l'émission et le rechargement de nginx.

**Ce que le code montre :**

- La synchronisation Infisical après émission est *best-effort*. Un échec produit seulement un événement `infisical_sync_error`, **sans nouvel essai** (`acme-engine.ts`, étape 6b). Le worker de renouvellement ne reprend que les certificats arrivés à échéance.
- `sync-certs.sh` masque les erreurs. `curl -sf … || echo '{}'` transforme un refus d'authentification ou de permission en « No certificate changes » dans `journalctl -t infisical-sync`.

**Cause établie le 24/11/2026.** Lecture seule de la base de PowerDNS-UI en service (hôte `PDNS-API-PROXY`, 10.19.19.253, conteneur `powerdns-ui`, `/app/data/cache.db` ouverte en `readonly`, sans aucune colonne de clé ni de secret).

**Configuration Infisical** : `site_url = https://vault.api-and-you.net` (confirme le § 1.1), `environment = prod`, `secret_base_path = /`, synchronisation activée.

**Historique** (`certificate_events`, `certificate_jobs`) :

| Date | proxcenter.api.infra | astreintes.api.infra |
|---|---|---|
| 09/07 | émis (exp. 07/10). 1ʳᵉ synchronisation : 404 « Folder … not found », puis `infisical_synced` OK | émis (exp. 07/10), `infisical_synced` OK |
| **07/09** (J-30, renouvellement **à l'heure**) | `renew ok` (exp. 06/12), puis **`infisical_sync_error` : `create PRIVKEY failed (400) "Secret already exists"`** | idem, même erreur 400 |
| 07/10 | **expiration** du certificat de juillet, toujours celui présent dans Infisical | idem |
| 04/11 | téléchargement manuel du bundle avec la clé (par un utilisateur) | — |
| **06/11** (J-30, à l'heure) | `renew ok` (exp. 04/02/2027), puis **même erreur 400 `Secret 'PRIVKEY' already exists`** | idem |

Pour les deux certificats, `infisical_synced_at` vaut toujours le **09/07/2026**.

**Cause racine : un défaut du code de PowerDNS-UI, présent depuis le premier commit (`549e713`, 09/07).**

- `upsertSecret` (`src/lib/certs/infisical-sync.ts` L122) ne bascule sur `PATCH` que si la création renvoie **409**.
- Or Infisical répond **400 « Secret already exists »** quand le secret existe déjà.
- **Toute synchronisation postérieure à la première échoue donc** : renouvellement automatique comme bouton « Sync to Infisical ».
- Ce cas de 400 est pourtant déjà traité pour les dossiers (`ensureFolder`, L92), mais pas pour les secrets.
- Comme l'échec est *best-effort* et jamais retenté, il n'est visible que dans l'historique du certificat.

Les hypothèses 1, 3 et 4 sont écartées : PowerDNS-UI renouvelle bien à J-30, et les serveurs servent fidèlement ce qu'Infisical contient, c'est-à-dire le certificat de juillet.

**Conséquences actuelles :**

- proxcenter et astreintes servent un certificat expiré, alors qu'un certificat valable (jusqu'au 04/02/2027) existe dans PowerDNS-UI.
- Le bouton « Sync to Infisical » **ne peut pas** réparer, à cause du même défaut.
- **Ascender sera touché à son premier renouvellement** (vers le 22/01/2027) : sa première synchronisation, le 23/11, a réussi parce que les secrets n'existaient pas encore.
- Il en va de même pour `internal-telemetry.api.infra` (synchronisé le 10/11, renouvellement vers le 09/01/2027).

**Correctif (hors du périmètre de constat, à décider) :**

- traiter `400` + « already exists » comme `409` dans `upsertSecret`, ou faire un `PATCH` d'abord puis une création si 404 ;
- ajouter un test unitaire.

C'est un hotfix de quelques lignes, indépendant de la v1. La v1 (§ 3 bis) corrige aussi le problème de fond : réconciliation avec nouvel essai et état visible par distribution. Une fois le hotfix déployé, un « Sync to Infisical » remettra proxcenter et astreintes à jour : les serveurs le récupèrent dans les 5 minutes par leur cron.

**Non vérifié** (accès limité à l'hôte PowerDNS-UI) : le journal `infisical-sync` et les fichiers sur les serveurs proxcenter et astreintes. Ce n'est plus nécessaire pour établir la cause.

### 5.2 Phase 1 : développement de PowerDNS-UI (branche locale, après validation)

Couche de distribution du § 3 bis, découpée en commits livrables :

1. Interface `DistributionProvider` et fournisseur `infisical-secrets` (code actuel extrait, cible paramétrable). Aucun changement fonctionnel.
2. Tables `distribution_connections` et `certificate_distributions`, migration de `infisical_config` et des certificats déjà synchronisés.
3. Worker de réconciliation : republication sur changement d'empreinte ou de cible, retrait de l'ancienne cible, backoff. L'étape 6b et la suppression d'un certificat passent par lui.
4. API et interface : réglages des connexions, section « Distributions » du certificat, alias des anciennes routes.
5. Tests unitaires :
   - fournisseur Infisical simulé : création, mise à jour, 409, 404 ;
   - réconciliation : pas de republication si l'empreinte est identique ; reprise après erreur ; déplacement de cible entraînant le retrait de l'ancienne ;
   - migration des données.
- Documentation : réécriture de `docs/ssl-infisical-nginx.md` § 1 (projet par consommateur + Viewer, plus de rôle personnalisé), et nouvelle section Kubernetes (Operator).

#### Implémentation (branche `feat/cert-distribution-providers`, 24/11/2026) : écarts au plan

- **Règles par catégorie : non faites.** Elles sont remplacées par l'option « Apply to every certificate » d'une connexion (`auto_attach` + cible par défaut à gabarit `{category}`/`{name}`). Cela suffit pour reproduire l'existant ; les règles par catégorie restent possibles plus tard.
- **Anciennes routes `api/certs/infisical/*` : supprimées**, pas d'alias. Seule l'UI les appelait, et elle est remplacée dans la même version. `POST /api/certs/[id]/sync` est conservée et publie désormais vers toutes les destinations du certificat.
- **La table `infisical_config` est conservée**, en lecture seule pour la migration. Elle n'est plus utilisée ensuite.
- **Un échec d'écriture sur disque ne fait plus échouer le job d'émission.** Le certificat est déjà enregistré ; l'échec est affiché sur la destination et retenté.
- **Le défaut du 400 « already exists » (§ 5.1) est corrigé** dans le fournisseur Infisical, avec un test de non-régression.
- **Effet au premier déploiement.** Les certificats dont la copie Infisical est périmée (proxcenter, astreintes) sont republiés dans `PDNS` par le premier cycle du worker, environ 5 minutes après le démarrage. C'est une écriture sur Infisical prod, qui répare la livraison.

### 5.3 Phase 2 : pilote Ascender (écritures Infisical et k3s, **chacune soumise à votre accord**)

**Calendrier (PO Ascender).**

- Le certificat auto-signé actuel expire le 24/12/2026.
- Le certificat déjà émis par PowerDNS-UI pour `ascender.api.infra` est valable jusqu'au **21/02/2027**. Le déposer à la main (tâche en attente côté Ascender, hors de ce plan) laisse jusqu'en février pour livrer la v1.
- Le pilote K1 **n'est pas urgent**.

**Les quatre conditions du PO**, complétées par les vérifications du 24/11 :

| # | Condition | Ce qui a été vérifié et ce qu'on en tire |
|---|---|---|
| C1 | **Universal Auth**, pas Kubernetes Auth. Kubernetes Auth obligerait Infisical à appeler l'API k3s : c'est le flux entrant refusé avec K2 | Acquis. La restriction du client secret par IP (*trusted IPs*) est **payante** (`ipAllowlisting: false`, `license-fns.ts`) : elle n'est donc pas disponible. Atténuations gratuites : TTL ou nombre d'usages du client secret (à confirmer dans l'UI), et surtout le cloisonnement par projet |
| C2 | **Ne pas laisser l'installeur écraser le secret.** L'installeur Ascender recrée `ascender-tls-secret` à partir de `/root/ascender/tls/`. On crée donc un nouveau secret, possédé par l'Operator (`ascender-tls-infisical`), on y pointe l'Ingress, et on met à jour le README de `ascender-config` | **Comportement de l'Operator face à un secret existant** (vérifié dans `Infisical/kubernetes-operator` @ `861ccc0`, `internal/services/infisicalsecret/reconciler.go` L760-781 et L410-476) : s'il trouve un secret du même nom, il le **reprend sans contrôle de propriétaire** et en réécrit `data`. Le `ownerReference` n'est posé qu'à la création (`creationPolicy: Owner`). Partager le nom avec l'installeur créerait donc un conflit où le dernier écrivain gagne. **Un nom dédié est bien nécessaire.** Point d'attention sur `creationPolicy` : avec `Owner`, supprimer l'`InfisicalSecret`, ou désinstaller les CRD avec le chart Helm, **supprime le secret TLS** par ramasse-miettes, donc coupure. Avec `Orphan`, le secret survit. **Recommandation : `Orphan`** |
| C3 | **Régler le DNS d'abord.** L'Operator résout l'URL d'Infisical depuis un pod (CoreDNS → 10.10.10.251/.252) | Le 24/11, depuis le poste : `vault.api-and-you.net` donne **10.10.10.63 sur .251, sur .252 et aussi en DNS public (1.1.1.1)**. Ce nom ne dépend donc pas des résolveurs internes. Pas d'incohérence observée sur `ascender.api.infra` ni sur `pdns.api.infra`. **Reste à tester depuis un pod** (`kubectl run … nslookup vault.api-and-you.net`, plusieurs fois) et à utiliser ce nom public dans l'`InfisicalSecret`, jamais un nom `api.infra` |
| C4 | **Superviser le certificat réellement servi** : sonde Centreon sur l'expiration de `ascender.api.infra:443`, alerte à J-20 | C'est la seule preuve de bout en bout. Elle comble le manque « PowerDNS-UI ne voit la livraison que jusqu'à Infisical ». **À étendre à tous les consommateurs** (proxcenter et astreintes en premier) : c'est l'absence de ce contrôle qui a laissé passer leur expiration du 07/10 |

**Déroulé du pilote** :

1. **Infisical.** Créer le projet `tls-ascender` (environnement `production`, **rien d'autre dedans**) et l'identité `k8s-ascender` (Universal Auth), rôle **Viewer**. Y ajouter l'identité PowerDNS-UI en **Member**.
2. **PowerDNS-UI.** Ajouter la distribution `infisical-secrets` → `tls-ascender` / `production` / `/ascender-api-infra` au certificat, puis publier. Vérifier dans Infisical.
3. **Test d'isolation.** Avec `k8s-ascender`, la lecture de `PDNS` doit répondre 403, et celle de `tls-ascender` doit répondre 200.
4. **DNS depuis un pod (C3).** Résolution répétée de `vault.api-and-you.net`, et `curl https://vault.api-and-you.net/api/status` depuis un pod.
5. **Inventaire cert-manager avant retrait.** Vérifier `kubectl get certificates,certificaterequests,issuers,clusterissuers -A` et les webhooks. Vérifier aussi que l'installeur Ascender n'installe ni n'utilise cert-manager. Si tout est vide, le désinstaller.
6. **Operator.** Installer le chart `secrets-operator`. Créer le secret Universal Auth, puis l'`InfisicalSecret` → `ascender/ascender-tls-infisical` (`type: kubernetes.io/tls`, `creationPolicy: Orphan`, modèle `tls.crt` ← FULLCHAIN, `tls.key` ← PRIVKEY, `resyncInterval` de quelques minutes).
7. **Bascule de l'Ingress** sur `ascender-tls-infisical` (C2), puis mise à jour du README de `ascender-config`. Vérifier avec `openssl s_client -connect ascender.api.infra:443`.
8. **Supervision (C4).** Sonde Centreon d'expiration à J-20 sur `ascender.api.infra:443`.
9. **Renouvellement de bout en bout.** Forcer un renouvellement dans PowerDNS-UI. Le secret doit être mis à jour au resync, le nouveau certificat doit être servi, et la sonde doit voir la nouvelle date.
10. **Relance de l'installeur** (non-régression C2). Il recrée `ascender-tls-secret`, mais l'Ingress reste sur `ascender-tls-infisical`.

### 5.4 Phase 3 : proxcenter, astreintes, puis les autres

- Même création que l'étape 2.1, avec ajout de la destination.
- Sur le serveur : remplacer seulement `/etc/infisical/env` (garder une copie `.bak`), lancer `sync-certs.sh`, puis vérifier `nginx -t` et le certificat servi.
- Retirer ensuite l'accès de l'ancienne identité à `PDNS` (et son rôle personnalisé).
- Retour arrière : remettre `env.bak`.

### 5.5 Phase 4 : clôture

- Une fois tous les consommateurs basculés, `PDNS` ne garde plus que des humains admins et l'identité PowerDNS-UI.
- On peut ensuite retirer la destination par défaut des certificats migrés, sur décision explicite.

---

## 6. Risques et points non vérifiés

**Points non vérifiés** (accès manquant ou test nécessaire) :

| # | Point | Comment lever le doute |
|---|---|---|
| 1 | ~~Le `site_url` de PowerDNS-UI est bien `https://vault.api-and-you.net`~~ | **Confirmé le 24/11** (table `infisical_config` : environnement `prod`, chemin de base `/`) |
| 2 | La version v0.166.3 n'est déduite que du nom du bundle frontend | Page *Admin* ou *Server Admin* de l'instance, ou logs de démarrage |
| 3 | Menus disponibles sur l'instance (Certificate Manager, Applications, Additional Privileges) | Capture ou visite de l'interface avec un compte admin |
| 4 | `PDNS` a `isLegacyAdditionalPrivilegesEnabled = true` (option 4.2) | Fiche d'une identité du projet : section « Additional Privileges » visible, ou bandeau « Moved to Folder-Level Access » |
| 5 | Effet d'un rôle personnalisé déjà assigné (`proxcenter-api-…`) sans licence `rbac` | Phase 0 : tester la lecture avec ces identités |
| 6 | Le modèle `InfisicalSecret` → `kubernetes.io/tls` fonctionne avec la version d'Operator compatible v0.166.3 | Pilote Ascender |
| 7 | infisical-issuer compatible avec cert-manager 1.21.3 ; client ACME d'Infisical compatible avec step-ca ; connecteur PowerDNS d'Infisical compatible avec le proxy de PowerDNS-UI | Seulement si l'option native (4.4) est retenue un jour |

**Risques :**

- **Le privilège de l'identité PowerDNS-UI s'étend** : elle devient Member de N projets. C'est déjà le cas aujourd'hui sur `PDNS`, qui contient tout. Le risque est équivalent.
- **Dérive des projets** (oubli d'ajouter l'identité PowerDNS-UI) : l'échec est visible par destination dans PowerDNS-UI. Le test de connexion par destination y répond.
- **Les clés privées transitent toujours par Infisical**, comme aujourd'hui. Seule l'option 4.3 l'évite pour Kubernetes.
- **Les modèles Infisical changent vite.** En 2026 : templates et subscribers passés en legacy, *Additional Privileges* retirées des nouveaux projets. L'option D repose sur la brique la plus stable (projets et rôles intégrés).
- **Pas d'alerte d'expiration côté consommateur** aujourd'hui : c'est ce qui a laissé expirer proxcenter et astreintes. Une sonde d'expiration côté serveur ou une supervision TLS est recommandée, hors de ce chantier.

**Sources principales :**

- Code Infisical au tag **v0.166.3** : `license-fns.ts`, `certificate-authority-service.ts`, `project-additional-privilege-factory.ts`, migration `20260820120000_…`, `pki-application-membership-service.ts`, `default-roles.ts` (Viewer L701, Operator L1069 avec `ReadPrivateKey`, Auditor L1128), `acme-certificate-authority-enums.ts`.
- `main` @ `df8bb75` (23/11/2026), pour la doc et les points identiques.
- [infisical-issuer](https://github.com/Infisical/infisical-issuer) @ `bb732e3`.
- Doc : `infisical.com/docs/documentation/platform/pki/*`, `…/access-controls/*`, `…/integrations/platforms/kubernetes/*`.

---

## 7. Décisions attendues

**Tranché le 24/11/2026 :**

- PowerDNS-UI émet, puis distribue vers Infisical et, à terme, vers d'autres fournisseurs.
- Couche de distribution validée, avec **un projet par consommateur + Viewer**.
- Le fournisseur **`filesystem`** (existant : disque et NFS) est intégré dès la v1, appliqué à tous les certificats.
- **Pas de rustine 4.2** : Ascender attend la cible.

**Encore ouvert :**

1. **Hotfix `upsertSecret`** (§ 5.1) : à faire tout de suite, sur une branche à part, avant la v1 ? Puis, après déploiement, faut-il lancer un « Sync to Infisical » pour remettre proxcenter et astreintes à jour (écriture sur Infisical prod) ?

Phase 0 close : cause établie le 24/11 (§ 5.1).

**Tranché ensuite (retour du PO Ascender) :** K1 avec les conditions C1 à C4 (§ 5.3), K2 hors programme, retrait de cert-manager du cluster Ascender après inventaire.
