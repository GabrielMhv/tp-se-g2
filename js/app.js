/**
 * Logique applicative du tableau de bord domotique ESP32 + Firebase
 * Architecture séparée - Logique préservée à 100%
 * Version améliorée : 4 relais dynamiques, renommage, durée d'utilisation,
 * modules journal/notifications/inactivité, confirmation "Tout éteindre"
 */

import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

/* ====== Imports des modules ====== */
import { journalAjouter, journalCharger } from "./modules/journal.js";
import {
  demanderPermissionNotif,
  notifESP32HorsLigne,
  notifESP32EnLigne,
  notifRelaisChange
} from "./modules/notifications.js";
import {
  demarrerSurveillanceInactivite,
  arreterSurveillanceInactivite
} from "./modules/inactivite.js";
import { planningInit } from "./modules/planning.js";

/* ====== 1. Paramètres des équipements ====== */

/** Définition par défaut des 4 relais */
const RELAIS_DEFAUT = [
  { id: "relay1", nom: "Lampe du salon" },
  { id: "relay2", nom: "Lampe de la chambre" },
  { id: "relay3", nom: "Lampe du bureau" },
  { id: "relay4", nom: "Éclairage extérieur" }
];

/** Liste active des relais (sera filtrée selon nb_relais Firebase) */
let RELAIS = [...RELAIS_DEFAUT];

const DELAI_HORS_LIGNE_S = 25;      // Pas de heartbeat depuis 25 s => ESP32 hors ligne
const DELAI_CONFIRMATION_MS = 6000; // Pas de confirmation après 6 s => alerte

const $ = (selector) => document.querySelector(selector);

/* ====== 2. État interne ====== */
let commandes = {};
let etats = {};
let systeme = {};
let envoyeA = {};
let abonnements = [];
let premierEtat = true;
let minuteur = null;

/** Mémorise si l'ESP32 était en ligne au dernier tick (pour détection changement d'état) */
let espEtaitEnLigne = null;

/** Timestamps d'allumage par relayId (ms) — null si éteint */
const tempsAllumage = {};

/* ====== 3. Renommage des équipements ====== */

/**
 * Charge les noms personnalisés depuis localStorage et les applique à RELAIS.
 */
function chargerNoms() {
  try {
    const stocke = localStorage.getItem("relais_noms");
    if (!stocke) return;
    const noms = JSON.parse(stocke);
    RELAIS.forEach((r) => {
      if (noms[r.id]) r.nom = noms[r.id];
    });
  } catch (_) {
    // JSON invalide — on ignore
  }
}

/**
 * Sauvegarde un nom personnalisé dans localStorage.
 * @param {string} id   - Identifiant du relais (ex: "relay1")
 * @param {string} nom  - Nouveau nom
 */
function sauvegarderNom(id, nom) {
  try {
    const stocke = localStorage.getItem("relais_noms");
    const noms = stocke ? JSON.parse(stocke) : {};
    noms[id] = nom;
    localStorage.setItem("relais_noms", JSON.stringify(noms));
    // Mettre à jour l'objet RELAIS en mémoire
    const r = RELAIS.find((x) => x.id === id);
    if (r) r.nom = nom;
  } catch (_) {
    // Erreur silencieuse
  }
}

/**
 * Attache le comportement double-clic pour renommer une carte relais.
 * @param {HTMLElement} li - L'élément li de la carte
 * @param {object} r       - Objet relais {id, nom}
 */
function attacherRenommage(li, r) {
  const nomEl = li.querySelector(".nom");
  if (!nomEl) return;

  nomEl.addEventListener("dblclick", () => {
    // Éviter double déclenchement si déjà en édition
    if (li.querySelector(".nom-input")) return;

    const valeurActuelle = nomEl.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.value = valeurActuelle;
    input.className = "nom-input";

    nomEl.textContent = "";
    nomEl.appendChild(input);
    input.focus();
    input.select();

    const valider = () => {
      const nouveau = input.value.trim() || valeurActuelle;
      sauvegarderNom(r.id, nouveau);
      nomEl.textContent = nouveau;
      // Mettre à jour le aria-label du bouton bascule
      const bascule = li.querySelector(".bascule");
      if (bascule) bascule.setAttribute("aria-label", nouveau);
    };

    input.addEventListener("blur", valider, { once: true });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = valeurActuelle;
        input.blur();
      }
    });
  });
}

/* ====== 4. Initialisation de la liste des relais ====== */
const liste = $("#liste");

function initialiserListe() {
  if (!liste) return;
  liste.innerHTML = "";

  RELAIS.forEach((r) => {
    const li = document.createElement("li");
    li.className = "ligne";
    li.dataset.id = r.id;

    // Icône SVG d'ampoule
    const iconeSVG = `
      <span class="temoin" aria-hidden="true">
        <svg class="icone-ampoule" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
          <path d="M9 18h6"/><path d="M10 22h4"/>
        </svg>
      </span>`;

    li.innerHTML = `
      <div class="temoin-conteneur">${iconeSVG}</div>
      <div class="relais-infos">
        <div class="nom">${r.nom}</div>
        <div class="statut" role="status">Initialisation…</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:10px;flex-shrink:0">
        <span class="etat-badge etat-inconnu" role="status">
          <span class="etat-point"></span>
          <span class="etat-texte">Recherche</span>
        </span>
        <button class="bascule" role="switch" aria-checked="false" aria-label="${r.nom}">
          <span class="curseur"></span>
        </button>
      </div>
    `;

    const bascule = li.querySelector(".bascule");
    bascule.addEventListener("click", () => envoyer(r, !(commandes[r.id] === true)));

    // Attacher le comportement de renommage par double-clic
    attacherRenommage(li, r);

    liste.appendChild(li);
  });
}

/* ====== 5. Chargement du nombre de relais depuis Firebase ====== */

/**
 * Lit /domotique/config/nb_relais depuis Firebase et filtre RELAIS en conséquence.
 * Puis initialise la liste et charge les noms personnalisés.
 */
function chargerConfigRelais() {
  const refConfig = ref(db, "domotique/config/nb_relais");
  // Lecture unique via onValue avec unsubscribe immédiat
  const unsubscribe = onValue(refConfig, (snapshot) => {
    unsubscribe(); // lecture unique
    let nb = snapshot.val();
    if (typeof nb !== "number" || nb < 1 || nb > RELAIS_DEFAUT.length) {
      nb = 4; // valeur par défaut
    }
    // Filtrer aux N premiers relais
    RELAIS = RELAIS_DEFAUT.slice(0, nb);
    // Charger les noms personnalisés par-dessus
    chargerNoms();
    // Construire la liste avec les relais filtrés
    initialiserListe();
  }, () => {
    // En cas d'erreur de lecture (pas authentifié encore) : utiliser défaut
    RELAIS = RELAIS_DEFAUT.slice(0, 4);
    chargerNoms();
    initialiserListe();
  });
}

/* ====== 6. Envoi des commandes ====== */
async function envoyer(r, valeur) {
  envoyeA[r.id] = Date.now();
  try {
    await set(ref(db, "domotique/commandes/" + r.id), valeur);
    journalAjouter(r.nom + " : ordre « " + (valeur ? "allumer" : "éteindre") + " » envoyé");
  } catch (e) {
    journalAjouter("Échec d'envoi pour " + r.nom + " (" + (e.code || e.message) + ")");
  }
  majUI();
}

/* ====== 7. Bouton "Tout éteindre" avec confirmation ====== */
$("#tout-eteindre")?.addEventListener("click", () => {
  // Vérifier si au moins un relais est ON
  const unAllume = RELAIS.some((r) => etats[r.id] && etats[r.id].etat === true);
  if (unAllume) {
    if (!window.confirm("Voulez-vous vraiment éteindre tous les équipements ?")) return;
  }
  RELAIS.forEach((r) => envoyer(r, false));
});

/* ====== 8. Utilitaires d'affichage ====== */
function heure(ts) {
  return new Date(ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function esp32EnLigne() {
  return (
    typeof systeme.derniere_vue === "number" &&
    systeme.derniere_vue > 0 &&
    (Date.now() / 1000 - systeme.derniere_vue) < DELAI_HORS_LIGNE_S
  );
}

/**
 * Formate une durée en millisecondes en chaîne lisible.
 * @param {number} ms - Durée en millisecondes
 * @returns {string}
 */
function formaterDuree(ms) {
  const totalMin = Math.floor(ms / 60000);
  const heures = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  if (heures > 0) {
    return `${heures}h ${minutes}min`;
  }
  return `${minutes} min`;
}

/* ====== 9. Mise à jour de l'interface utilisateur ====== */
function majUI() {
  const enLigne = esp32EnLigne();

  // Détection changement d'état ESP32 pour notifications
  if (espEtaitEnLigne !== null && espEtaitEnLigne !== enLigne) {
    if (!enLigne) {
      notifESP32HorsLigne();
    } else {
      notifESP32EnLigne();
    }
  }
  espEtaitEnLigne = enLigne;

  const actifs = RELAIS.filter((r) => etats[r.id] && etats[r.id].etat === true).length;

  const nbAllumesEl = $("#nb-allumes");
  if (nbAllumesEl) nbAllumesEl.textContent = `${actifs} / ${RELAIS.length}`;

  const nbRelaisEl = $("#nb-relais");
  if (nbRelaisEl) nbRelaisEl.textContent = String(RELAIS.length);

  const rssiEl = $("#rssi");
  if (rssiEl) {
    rssiEl.textContent = typeof systeme.rssi === "number" ? `${systeme.rssi} dBm` : "-- dBm";
  }

  const dernierSignalEl = $("#dernier-signal");
  if (dernierSignalEl) {
    if (enLigne && systeme.derniere_vue) {
      dernierSignalEl.textContent = "À l'instant";
    } else if (systeme.derniere_vue) {
      const ecoule = Math.max(0, Math.round(Date.now() / 1000 - systeme.derniere_vue));
      dernierSignalEl.textContent = `${ecoule} s`;
    } else {
      dernierSignalEl.textContent = "En attente";
    }
  }

  const espEl = $("#esp");
  if (espEl) {
    espEl.classList.toggle("en-ligne", enLigne);
  }

  const espTitreEl = $("#esp-titre");
  if (espTitreEl) {
    espTitreEl.textContent = enLigne ? "ESP32 en ligne" : "ESP32 hors ligne";
  }

  const espDetailEl = $("#esp-detail");
  if (espDetailEl) {
    if (enLigne) {
      espDetailEl.textContent = `Signal Wi-Fi ${systeme.rssi ?? "--"} dBm • IP ${systeme.ip || "inconnue"}`;
    } else if (systeme.derniere_vue) {
      const s = Math.round(Date.now() / 1000 - systeme.derniere_vue);
      espDetailEl.textContent = `Dernier contact il y a ${s} s`;
    } else {
      espDetailEl.textContent = "Aucun contact reçu pour l'instant";
    }
  }

  const espSecuriteEl = $("#esp-securite");
  if (espSecuriteEl) {
    espSecuriteEl.hidden = !(enLigne && systeme.mode_securite === true);
  }

  // Mise à jour de chaque carte relais
  RELAIS.forEach((r) => {
    const li = liste?.querySelector(`[data-id="${r.id}"]`);
    if (!li) return;

    const cmd = commandes[r.id] === true;
    const etat = etats[r.id] ? etats[r.id].etat === true : null;
    const synchro = etat !== null && etat === cmd;
    const statut = li.querySelector(".statut");
    const bascule = li.querySelector(".bascule");

    li.classList.toggle("allume", etat === true);
    if (bascule) {
      bascule.setAttribute("aria-checked", String(cmd));
    }

    const etatBadge  = li.querySelector(".etat-badge");
    const etatTexte = li.querySelector(".etat-texte");

    if (statut) {
      statut.classList.remove("attention");

      if (synchro) {
        const maj = etats[r.id].maj ? ` • confirmé à ${heure(etats[r.id].maj * 1000)}` : "";

        // Ajout de la durée d'utilisation si allumé
        let suffixeDuree = "";
        if (etat && tempsAllumage[r.id]) {
          const dureeMs = Date.now() - tempsAllumage[r.id];
          suffixeDuree = ` • Allumé depuis ${formaterDuree(dureeMs)}`;
        }

        statut.textContent = (etat ? "Éclairage actif" : "Éclairage éteint") + maj + suffixeDuree;
        if (etatBadge) etatBadge.className = "etat-badge " + (etat ? "etat-actif" : "etat-inactif");
        if (etatTexte) etatTexte.textContent = etat ? "ALLUMÉE" : "ÉTEINTE";
      } else if (!enLigne) {
        statut.textContent = "Commande mémorisée • ESP32 hors ligne";
        statut.classList.add("attention");
        if (etatBadge) etatBadge.className = "etat-badge etat-inconnu";
        if (etatTexte) etatTexte.textContent = "HORS LIGNE";
      } else if (envoyeA[r.id] && Date.now() - envoyeA[r.id] < DELAI_CONFIRMATION_MS) {
        statut.textContent = "Commande envoyée • confirmation en cours";
        if (etatBadge) etatBadge.className = "etat-badge etat-attente";
        if (etatTexte) etatTexte.textContent = "EN COURS";
      } else {
        statut.textContent = "Commande non confirmée par l'ESP32";
        statut.classList.add("attention");
        if (etatBadge) etatBadge.className = "etat-badge etat-inconnu";
        if (etatTexte) etatTexte.textContent = "NON CONFIRMÉ";
      }
    }
  });
}

/* ====== 10. Abonnements Firebase ====== */
const refus = (e) => journalAjouter("Lecture refusée (" + (e.code || e.message) + ")");

function ecouter() {
  premierEtat = true;

  // Restaurer le journal depuis localStorage
  journalCharger();

  // Démarrer la surveillance d'inactivité (déconnexion auto)
  demarrerSurveillanceInactivite(() => signOut(auth));

  abonnements.push(
    onValue(ref(db, "domotique/commandes"), (s) => {
      commandes = s.val() || {};
      majUI();
    }, refus)
  );

  abonnements.push(
    onValue(ref(db, "domotique/etats"), (s) => {
      const nouveau = s.val() || {};
      if (!premierEtat) {
        RELAIS.forEach((r) => {
          const avant = etats[r.id] ? etats[r.id].etat : undefined;
          const apres = nouveau[r.id] ? nouveau[r.id].etat : undefined;
          if (apres !== undefined && avant !== apres) {
            journalAjouter(r.nom + " : " + (apres ? "allumée" : "éteinte") + ", confirmé par l'ESP32");

            // Compteur de durée d'utilisation
            if (apres === true) {
              tempsAllumage[r.id] = Date.now();
            } else {
              tempsAllumage[r.id] = null;
            }

            // Notification de changement d'état
            notifRelaisChange(r.nom, apres);
          }
        });
      }
      premierEtat = false;
      etats = nouveau;
      majUI();
    }, refus)
  );

  abonnements.push(
    onValue(ref(db, "domotique/systeme"), (s) => {
      systeme = s.val() || {};
      majUI();
    }, refus)
  );

  minuteur = setInterval(majUI, 1000);
}

function arreter() {
  abonnements.forEach((off) => off());
  abonnements = [];
  if (minuteur) clearInterval(minuteur);
  minuteur = null;
  commandes = {};
  etats = {};
  systeme = {};
  envoyeA = {};

  // Arrêter la surveillance d'inactivité
  arreterSurveillanceInactivite();
}

/* ====== 11. Authentification ====== */
const MESSAGES_AUTH = {
  "auth/invalid-credential": "Adresse e-mail ou mot de passe incorrect.",
  "auth/invalid-email": "Adresse e-mail invalide.",
  "auth/too-many-requests": "Trop de tentatives. Réessaie dans quelques minutes.",
  "auth/network-request-failed": "Pas de connexion Internet."
};

const formConnexion = $("#form-connexion");
if (formConnexion) {
  formConnexion.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const erreurEl = $("#erreur");
    const boutonSubmit = formConnexion.querySelector('button[type="submit"]');

    if (erreurEl) erreurEl.textContent = "";
    if (boutonSubmit) {
      boutonSubmit.disabled = true;
      boutonSubmit.classList.add("chargement");
    }

    try {
      await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#mdp").value);
    } catch (e) {
      if (erreurEl) {
        erreurEl.textContent = MESSAGES_AUTH[e.code] || "Connexion impossible (" + e.code + ").";
      }
    } finally {
      if (boutonSubmit) {
        boutonSubmit.disabled = false;
        boutonSubmit.classList.remove("chargement");
      }
    }
  });
}

$("#deconnexion")?.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (utilisateur) => {
  const ecranConnexion = $("#ecran-connexion");
  const ecranApp = $("#ecran-app");
  const userEmailEl = $("#utilisateur-connecte");

  if (ecranConnexion) ecranConnexion.hidden = !!utilisateur;
  if (ecranApp) ecranApp.hidden = !utilisateur;

  if (userEmailEl && utilisateur) {
    userEmailEl.textContent = utilisateur.email || "Utilisateur";
  }

  if (utilisateur) {
    // Demander la permission de notifications navigateur
    demanderPermissionNotif();
    // Charger la configuration des relais (nombre + noms) puis écouter Firebase
    chargerConfigRelais();
    ecouter();
    majUI();
    // Initialiser le module de planning horaire
    planningInit(db, () => RELAIS, envoyer);
  } else {
    arreter();
  }
});

/* ====== 12. Surveillance réseau (Online / Offline) ====== */
const banniereOffline = $("#banniere-offline");
window.addEventListener("offline", () => {
  if (banniereOffline) banniereOffline.hidden = false;
});
window.addEventListener("online", () => {
  if (banniereOffline) banniereOffline.hidden = true;
});
