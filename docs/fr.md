# ELK M1

Intégration des centrales d'alarme **ELK M1 Gold** et **M1 EZ8** dans
Gladys, en local, par le module Ethernet **M1XEP** de la centrale : sans
cloud, sans compte.

> **Jamais testé avec une vraie centrale.** Cette intégration suit le
> protocole ASCII publié par ELK, tel que l'implémente la bibliothèque libre
> [elkm1-lib](https://github.com/gwww/elkm1) de l'intégration Home Assistant.
> Non officiel, sans lien avec ELK Products. Vos retours sur une vraie
> installation sont les bienvenus.

## Ce que vous obtenez

- **La centrale** : liaison, défaut, coupure secteur, batterie de la centrale
  faible, liste des défauts.
- **Chaque secteur** indiqué (1 à 8) : son état (désarmé, armement en cours,
  délai d'entrée, armé total, partiel, nuit ou vacances), armé, prêt à armer,
  alarme en cours, alarme incendie ; des boutons **Armement total**,
  **Armement partiel**, **Armement nuit** et **Désarmer**.
- **Chaque zone** indiquée (1 à 208) : ouverte (ouverture, fumée, fuite) ou
  mouvement, défaut, exclue, alarme ; ou la température (zones 1 à 16 de type
  température).
- **Chaque sortie** indiquée (1 à 208) : son état, des boutons **Activer** et
  **Désactiver**.
- **Chaque thermostat** indiqué (1 à 16), en lecture seule : température,
  humidité, consignes de chauffage et de refroidissement, mode, maintien.
- **Déclencheurs de scène** : alarme déclenchée (secteur, zone, type :
  burglar intrusion, fire incendie, medical, police, aux, carbon_monoxide,
  emergency, freeze, gas, heat, water, fire_supervisory), secteur armé (avec
  son mode), secteur désarmé ; chacun indique si Gladys l'a demandé.
- **Actions de scène** : armer un secteur (total, partiel ou nuit), désarmer
  un secteur.

Les noms des secteurs, zones, sorties et thermostats viennent de la centrale
(les descriptions réglées dans ElkRP), lus une fois par adresse.

## Avant de commencer

1. Le M1XEP doit avoir une adresse fixe sur votre réseau (une réservation
   dans votre box).
2. Choisissez la connexion :
   - **Sécurisée, TLS 1.2** (port 2601) : micrologiciel du M1XEP 2.0.46 et
     suivants ;
   - **Sécurisée, TLS 1.0** (port 2601) : anciens micrologiciels seulement.
     TLS 1.0 avec d'anciens algorithmes est **plus faible** : ne le choisissez
     que si TLS 1.2 échoue ;
   - **Non sécurisée** (port 2101) : seulement si elle est activée sur votre
     M1XEP. Tout, y compris le code utilisateur, circule alors en clair sur
     votre réseau.
3. Sur le port sécurisé, le M1XEP demande un **nom d'utilisateur et un mot
   de passe** : ceux réglés pour le M1XEP dans ElkRP.
4. Pour l'armement et le désarmement, un **code utilisateur** de la centrale
   (4 à 6 chiffres). Créez dans ElkRP un utilisateur dédié, limité aux
   secteurs que Gladys peut armer.
5. Pour suivre les changements en direct, la centrale doit les signaler sur
   son port Ethernet (options de transmission du port série 0 / M1XEP dans
   ElkRP, comme pour Home Assistant). Tout est aussi relu toutes les
   5 minutes.

## Configuration

| Champ                                  | À saisir                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| Adresse du M1XEP                       | Son adresse IP, par ex. `192.168.1.80`                              |
| Connexion                              | Sécurisée TLS 1.2 (par défaut), sécurisée TLS 1.0, ou non sécurisée |
| Port                                   | Vide pour celui par défaut (2601 sécurisée, 2101 non sécurisée)     |
| Nom d'utilisateur / Mot de passe       | Port sécurisé seulement : ceux du M1XEP                             |
| Empreinte du certificat                | Facultatif : l'empreinte SHA-256 du certificat du M1XEP             |
| Code utilisateur                       | Facultatif : nécessaire seulement à l'armement et au désarmement    |
| Secteurs                               | par ex. `1` ou `1-2` (par défaut `1`)                               |
| Zones                                  | par ex. `1-6, 7:motion, 9:smoke, 10:leak, 12:temperature`           |
| Sorties                                | par ex. `3, 5-6`                                                    |
| Thermostats                            | par ex. `1`                                                         |
| Unité de température                   | Celle de la centrale : Fahrenheit (par défaut) ou Celsius           |
| Autoriser le désarmement depuis Gladys | Désactivé par défaut                                                |
| Autoriser les boutons des sorties      | Désactivé par défaut                                                |

Le mot de passe et le code utilisateur sont des champs secrets : gardés par
Gladys dans sa base, jamais réaffichés, envoyés seulement au M1XEP, jamais
écrits dans les journaux.

## Le certificat du M1XEP

Le M1XEP a un certificat auto-signé : aucune autorité ne s'en porte garante.
L'intégration l'épingle : à la première connexion, le certificat rencontré
est retenu (sauf si vous avez saisi son empreinte dans la configuration).
Ensuite, un autre certificat (nouveau module, réinitialisation, ou autre
machine à cette adresse) **arrête tout avant l'envoi du mot de passe** : le
statut affiche son empreinte SHA-256. Comparez-la avec celle de votre M1XEP ;
si c'est la même, appuyez deux fois sur **Faire confiance au nouveau
certificat** (le second appui, dans les 60 s, épingle exactement celui
affiché), ou saisissez-la dans le champ de l'empreinte. Enregistrer la
configuration seule ne valide jamais un nouveau certificat.

## Une connexion refusée

Si le M1XEP refuse le nom d'utilisateur ou le mot de passe, l'intégration
s'arrête et **ne réessaie jamais d'elle-même**. Changez-les dans la
configuration, ou appuyez sur **Tester la connexion** pour un nouvel essai
(l'arrêt n'est levé que s'il réussit).

## Sécurité

- Toute personne pouvant piloter les appareils dans Gladys (tableau de bord,
  scènes, application Gladys) peut agir sur l'alarme par cette intégration,
  avec le code utilisateur de la configuration.
- **L'armement est toujours permis** (il protège). Armer alors que quelqu'un
  est à l'intérieur (une scène, une erreur) peut déclencher une fausse
  alarme, les sirènes et un appel de votre télésurveillance. Un armement ne
  baisse jamais la protection (un armement partiel sur un secteur armé total
  n'envoie rien) ; un secteur armé dans un autre mode doit d'abord être
  désarmé (la centrale n'arme qu'un secteur désarmé). L'armement est
  toutefois refusé, rien n'étant envoyé, dans ces cas : pas de code
  utilisateur, ou un code déjà refusé par la centrale ; un secteur pas prêt
  à armer (une zone ouverte) ; ElkRP connecté à la centrale ; l'intégration
  arrêtée sur un autre certificat ou une connexion refusée ; la centrale
  injoignable même après une tentative de connexion immédiate ; un armement
  partiel ou nuit dont l'état ne peut pas être relu alors que le dernier état
  connu est déjà aussi fort (un armement total part alors quand même) ; un
  désarmement envoyé juste avant et toujours pas appliqué à l'échéance de
  l'armement (le secteur reste armé, plus fort). Plusieurs armements (une
  scène qui arme tous les secteurs, un double appui) sont écrits l'un après
  l'autre, sans attendre la confirmation du précédent ; un armement demandé
  juste après un désarmement attend que celui-ci s'applique, puis part.
- **Le désarmement et les sorties sont désactivés par défaut**, chacun
  derrière son option, relue juste avant l'écriture de la commande. Une
  sortie peut commander une sirène, une gâche ou un portail : vérifiez
  d'abord ce que fait chacune.
- Un désarmement ou une commande de sortie relit l'état sur la centrale juste
  avant, et rien n'est envoyé s'il ne peut pas être lu à temps. Une commande
  n'est réussie que lorsque la centrale la signale ; sinon Gladys indique
  « envoyée, sans confirmation » et l'état est relu.
- Un armement demandé pendant qu'un désarmement du même secteur attend son
  tour retire ce désarmement.
- Si la centrale signale **le code utilisateur comme invalide** juste après
  une commande, les commandes s'arrêtent, même après un redémarrage, jusqu'à
  un changement du code ou un appui sur **Autoriser un nouvel essai du code**
  (des codes faux répétés peuvent bloquer les claviers ou être signalés à
  votre télésurveillance). Le code lui-même n'est jamais écrit nulle part par
  l'intégration.
- Pendant qu'**ElkRP** est connecté à la centrale, aucune commande n'est
  envoyée.
- Chaque commande, envoyée ou refusée, est écrite dans les journaux de
  l'intégration ; jamais le code ni le mot de passe.

## Limites

- Jamais testé avec une vraie centrale ni un vrai M1XEP (seulement avec une
  centrale simulée).
- Le port série de la centrale n'est pas pris en charge (le conteneur n'en a
  pas).
- Les thermostats sont en lecture seule dans cette version ; pas
  d'éclairages (X10, Insteon), de tâches, compteurs, réglages, exclusion de
  zones, claviers.
- « Tester la connexion » indique ce que l'intégration sait ; il ne relit
  jamais la centrale plus vite que les attentes normales.
- Les tentatives de connexion sont espacées (10 s à 5 min), y compris d'un
  redémarrage à l'autre.

## Dépannage

- **« accepte la connexion mais la centrale ne répond pas »** : vérifiez le
  type de connexion (TLS 1.2 ou 1.0) et le port.
- **« n'est pas celui que Gladys connaît »** : voir « Le certificat du
  M1XEP ».
- **« a refusé le code utilisateur »** : le code est faux ou sans droit sur ce
  secteur ; changez-le, ou appuyez sur « Autoriser un nouvel essai du code ».
- **« envoyée, sans confirmation »** : une zone était ouverte, le code n'a pas
  de droit sur ce secteur, ou la centrale n'a pas signalé le changement ;
  l'état est relu 2 s plus tard.
