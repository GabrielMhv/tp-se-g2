/**
 * Module de journal d'activité avec persistance localStorage
 * Projet domotique ESP32 + Firebase
 */

// Clé de stockage dans le localStorage
const CLE_STOCKAGE = 'domotique_journal';

// Nombre maximum d'entrées conservées
const MAX_ENTREES = 50;

// Sélecteur DOM du journal
const SELECTEUR_JOURNAL = '#journal';

/**
 * Formate un timestamp en heure lisible en français
 * @param {number} ts - Timestamp en millisecondes
 * @returns {string} Heure formatée (HH:MM:SS)
 */
function formaterHeure(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * Lit les entrées sauvegardées dans le localStorage
 * @returns {Array<{ts: number, message: string}>}
 */
function lireStockage() {
  try {
    const brut = localStorage.getItem(CLE_STOCKAGE);
    return brut ? JSON.parse(brut) : [];
  } catch {
    return [];
  }
}

/**
 * Sauvegarde un tableau d'entrées dans le localStorage
 * @param {Array<{ts: number, message: string}>} entrees
 */
function sauvegarderStockage(entrees) {
  localStorage.setItem(CLE_STOCKAGE, JSON.stringify(entrees));
}

/**
 * Crée et insère un élément <li> dans le journal DOM
 * @param {HTMLElement} ul - Élément <ul> du journal
 * @param {number} ts - Timestamp de l'entrée
 * @param {string} message - Texte de l'entrée
 * @param {boolean} [prepend=true] - Insérer en tête (true) ou en queue (false)
 */
function creerElementJournal(ul, ts, message, prepend = true) {
  const li = document.createElement('li');

  // Élément temporel avec heure FR
  const temps = document.createElement('time');
  temps.dateTime = new Date(ts).toISOString();
  temps.textContent = formaterHeure(ts);

  // Élément de texte
  const texte = document.createElement('span');
  texte.className = 'journal-texte';
  texte.textContent = message;

  li.append(temps, texte);

  // Animation fade-slide (classe CSS déjà définie dans style.css)
  li.classList.add('entree-nouvelle');

  if (prepend) {
    ul.prepend(li);
  } else {
    ul.append(li);
  }
}

/**
 * Ajoute une entrée dans le journal DOM et la sauvegarde dans le localStorage.
 * Supprime automatiquement les entrées les plus anciennes au-delà de MAX_ENTREES.
 * @param {string} message - Message à journaliser
 */
export const journalAjouter = (message) => {
  const ul = document.querySelector(SELECTEUR_JOURNAL);
  if (!ul) return;

  // Supprimer l'élément "vide" s'il est présent
  const vide = ul.querySelector('.vide');
  if (vide) ul.innerHTML = '';

  const ts = Date.now();

  // Insertion dans le DOM (en tête, plus récent en premier)
  creerElementJournal(ul, ts, message, true);

  // Limiter les entrées DOM
  while (ul.children.length > MAX_ENTREES) {
    ul.lastChild.remove();
  }

  // Mise à jour du localStorage
  const entrees = lireStockage();
  entrees.unshift({ ts, message });
  if (entrees.length > MAX_ENTREES) {
    entrees.length = MAX_ENTREES;
  }
  sauvegarderStockage(entrees);
};

/**
 * Restaure les entrées du localStorage dans le journal DOM au démarrage.
 * Affiche au maximum MAX_ENTREES entrées, de la plus récente à la plus ancienne.
 */
export const journalCharger = () => {
  const ul = document.querySelector(SELECTEUR_JOURNAL);
  if (!ul) return;

  const entrees = lireStockage();
  if (entrees.length === 0) return;

  // Vider le contenu existant (y compris le <li class="vide">)
  ul.innerHTML = '';

  // Insérer les entrées dans l'ordre (plus récente en premier — tableau déjà trié)
  entrees.slice(0, MAX_ENTREES).forEach(({ ts, message }) => {
    creerElementJournal(ul, ts, message, false);
  });
};

/**
 * Vide le journal DOM et efface le localStorage correspondant.
 */
export const journalVider = () => {
  const ul = document.querySelector(SELECTEUR_JOURNAL);
  if (ul) {
    ul.innerHTML = '<li class="vide"><span>Aucun événement pour l\'instant.</span></li>';
  }
  localStorage.removeItem(CLE_STOCKAGE);
};
