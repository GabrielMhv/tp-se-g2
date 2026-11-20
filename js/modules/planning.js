/**
 * Module de programmation horaire (Planning)
 * Projet domotique ESP32 + Firebase
 */

import { ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const CHEMIN_PLANNING = "domotique/planning";
const CLE_PLANNING_LOCAL = "domotique_planning_local";

/**
 * Lit le planning local de secours
 */
function lirePlanningLocal() {
  try {
    const data = localStorage.getItem(CLE_PLANNING_LOCAL);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

/**
 * Sauvegarde le planning local
 */
function sauvegarderPlanningLocal(regles) {
  try {
    localStorage.setItem(CLE_PLANNING_LOCAL, JSON.stringify(regles));
  } catch {}
}

const NOMS_JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

/**
 * Formate la liste des jours pour l'affichage
 */
function formaterJours(jours) {
  if (!jours || jours.length === 0) return "Aucun jour";
  if (jours.length === 7) return "Tous les jours";
  if (jours.length === 5 && !jours.includes(0) && !jours.includes(6)) return "Semaine (Lun-Ven)";
  if (jours.length === 2 && jours.includes(0) && jours.includes(6)) return "Week-end";
  return jours.map(j => NOMS_JOURS[j] || j).join(", ");
}

/**
 * Met à jour le DOM de la liste des règles
 */
export function planningRendreUI(regles, listeRelais, onSupprimer) {
  const ul = document.querySelector("#planning-liste");
  if (!ul) return;

  const cles = Object.keys(regles || {});
  if (cles.length === 0) {
    ul.innerHTML = '<li class="vide-planning"><span>Aucune règle programmée pour le moment.</span></li>';
    return;
  }

  ul.innerHTML = "";
  cles.forEach((id) => {
    const regle = regles[id];
    const relaisObj = (listeRelais || []).find((r) => r.id === regle.relayId);
    const nomRelais = relaisObj ? relaisObj.nom : regle.relayId;

    const li = document.createElement("li");
    li.className = "planning-regle";
    li.innerHTML = `
      <div class="regle-info">
        <strong class="regle-heure">${regle.heure || "--:--"}</strong>
        <span class="regle-action ${regle.action ? 'action-on' : 'action-off'}">
          ${regle.action ? 'Allumer' : 'Éteindre'}
        </span>
        <span class="regle-relais">${nomRelais}</span>
        <span class="regle-jours">${formaterJours(regle.jours)}</span>
      </div>
      <button class="supprimer-regle" data-id="${id}" title="Supprimer la règle">Supprimer</button>
    `;

    const btnSuppr = li.querySelector(".supprimer-regle");
    if (btnSuppr && onSupprimer) {
      btnSuppr.addEventListener("click", () => onSupprimer(id));
    }

    ul.appendChild(li);
  });
}

/**
 * Initialise le module de planning
 */
export function planningInit(db, getRelaisFn, actionnerRelaisFn) {
  const formSection = document.querySelector("#planning-form");
  const toggleBtn = document.querySelector("#toggle-planning");
  const annulerBtn = document.querySelector("#annuler-planning");
  const form = document.querySelector("#form-planning");
  const selectRelais = document.querySelector("#plan-relais");

  let reglesEnCache = lirePlanningLocal();

  // Remplir le select des relais
  function actualiserSelectRelais() {
    if (!selectRelais) return;
    const relais = getRelaisFn();
    selectRelais.innerHTML = "";
    relais.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.nom;
      selectRelais.appendChild(opt);
    });
  }
  actualiserSelectRelais();

  // Gestion de l'affichage du formulaire
  if (toggleBtn && formSection) {
    toggleBtn.addEventListener("click", () => {
      actualiserSelectRelais();
      formSection.hidden = !formSection.hidden;
    });
  }

  if (annulerBtn && formSection) {
    annulerBtn.addEventListener("click", () => {
      formSection.hidden = true;
    });
  }

  // Écoute des règles dans Firebase
  const planningRef = ref(db, CHEMIN_PLANNING);
  onValue(planningRef, (snapshot) => {
    const val = snapshot.val();
    reglesEnCache = val || {};
    sauvegarderPlanningLocal(reglesEnCache);
    planningRendreUI(reglesEnCache, getRelaisFn(), supprimerRegle);
  }, () => {
    // En cas de refus ou déconnexion, utiliser le cache local
    planningRendreUI(reglesEnCache, getRelaisFn(), supprimerRegle);
  });

  // Soumission du formulaire
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const relayId = selectRelais ? selectRelais.value : "relay1";
      const action = document.querySelector("#plan-action")?.value === "true";
      const heure = document.querySelector("#plan-heure")?.value;
      
      const checkboxes = document.querySelectorAll(".jours-cases input[type='checkbox']");
      const jours = [];
      checkboxes.forEach(cb => {
        if (cb.checked) jours.push(parseInt(cb.value, 10));
      });

      if (!heure) return;

      const id = Date.now().toString(36);
      const nouvelleRegle = { relayId, action, heure, jours };

      try {
        await set(ref(db, `${CHEMIN_PLANNING}/${id}`), nouvelleRegle);
      } catch {
        reglesEnCache[id] = nouvelleRegle;
        sauvegarderPlanningLocal(reglesEnCache);
        planningRendreUI(reglesEnCache, getRelaisFn(), supprimerRegle);
      }

      form.reset();
      // Recocher les jours par défaut
      checkboxes.forEach(cb => { cb.checked = true; });
      if (formSection) formSection.hidden = true;
    });
  }

  // Suppression
  async function supprimerRegle(id) {
    try {
      await remove(ref(db, `${CHEMIN_PLANNING}/${id}`));
    } catch {
      delete reglesEnCache[id];
      sauvegarderPlanningLocal(reglesEnCache);
      planningRendreUI(reglesEnCache, getRelaisFn(), supprimerRegle);
    }
  }

  // Vérificateur périodique pour déclencher les règles localement si le client est actif
  let dernierMinuteVerifiee = -1;
  setInterval(() => {
    const maintenant = new Date();
    const minuteActuelle = maintenant.getMinutes();
    if (minuteActuelle === dernierMinuteVerifiee) return;
    dernierMinuteVerifiee = minuteActuelle;

    const jourSemaine = maintenant.getDay();
    const hh = String(maintenant.getHours()).padStart(2, "0");
    const mm = String(minuteActuelle).padStart(2, "0");
    const heureCourante = `${hh}:${mm}`;

    Object.values(reglesEnCache).forEach(regle => {
      if (regle.heure === heureCourante && Array.isArray(regle.jours) && regle.jours.includes(jourSemaine)) {
        if (typeof actionnerRelaisFn === "function") {
          const relais = getRelaisFn().find(r => r.id === regle.relayId);
          if (relais) {
            actionnerRelaisFn(relais, regle.action);
          }
        }
      }
    });
  }, 10000);
}
