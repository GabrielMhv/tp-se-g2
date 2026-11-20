
const EVENEMENTS_ACTIVITE = ['mousemove', 'keydown', 'click', 'touchstart'];


const DELAI_AVERTISSEMENT_MS = 2 * 60 * 1000;


let _signOutFn = null;
let _dureeMs = 30 * 60 * 1000;
let _minuteurPrincipal = null;
let _minuteurAvertissement = null;
let _actif = false;

/**
 * Affiche la bannière d'avertissement d'inactivité.
 */
function afficherBanniere() {
  const banniere = document.querySelector('#banniere-inactivite');
  if (banniere) banniere.hidden = false;
}

/**
 * Masque la bannière d'avertissement d'inactivité.
 */
function masquerBanniere() {
  const banniere = document.querySelector('#banniere-inactivite');
  if (banniere) banniere.hidden = true;
}

/**
 * Annule les minuteurs en cours.
 */
function annulerMinuteurs() {
  if (_minuteurPrincipal !== null) {
    clearTimeout(_minuteurPrincipal);
    _minuteurPrincipal = null;
  }
  if (_minuteurAvertissement !== null) {
    clearTimeout(_minuteurAvertissement);
    _minuteurAvertissement = null;
  }
}

/**
 * (Re)démarre les minuteurs d'inactivité.
 * - Après (duréeMs - 2 min) : affiche la bannière d'avertissement
 * - Après duréeMs : déconnecte l'utilisateur
 */
function reinitialiserMinuteurs() {
  if (!_actif) return;

  annulerMinuteurs();
  masquerBanniere();

  // Délai avant avertissement (uniquement si la durée totale > 2 min)
  const delaiAvantAvertissement = _dureeMs - DELAI_AVERTISSEMENT_MS;
  if (delaiAvantAvertissement > 0) {
    _minuteurAvertissement = setTimeout(afficherBanniere, delaiAvantAvertissement);
  }

  // Minuteur principal de déconnexion
  _minuteurPrincipal = setTimeout(() => {
    masquerBanniere();
    if (typeof _signOutFn === 'function') {
      _signOutFn();
    }
  }, _dureeMs);
}

/**
 * Gestionnaire d'événement d'activité utilisateur.
 */
function surActivite() {
  reinitialiserMinuteurs();
}

/**
 * Démarre la surveillance d'inactivité.
 * Écoute les événements d'activité et déclenche la déconnexion après `dureeMs` ms sans activité.
 * 2 minutes avant la déconnexion, affiche la bannière `#banniere-inactivite`.
 *
 * @param {Function} signOutFn - Fonction de déconnexion à appeler à l'expiration
 * @param {number} [dureeMs=1800000] - Durée d'inactivité avant déconnexion (défaut : 30 min)
 */
export const demarrerSurveillanceInactivite = (signOutFn, dureeMs = 30 * 60 * 1000) => {
  // Éviter les doublons
  if (_actif) arreterSurveillanceInactivite();

  _signOutFn = signOutFn;
  _dureeMs = dureeMs;
  _actif = true;

  // Enregistrement des écouteurs d'activité
  EVENEMENTS_ACTIVITE.forEach((evt) => {
    window.addEventListener(evt, surActivite, { passive: true });
  });

  // Bouton "Rester connecté" dans la bannière
  const boutonRester = document.querySelector('#banniere-inactivite [data-action="rester"]');
  if (boutonRester) {
    boutonRester.addEventListener('click', reinitialiserMinuteurs);
  }

  // Lancement des minuteurs initiaux
  reinitialiserMinuteurs();
};

/**
 * Arrête la surveillance d'inactivité, annule tous les minuteurs
 * et retire les écouteurs d'événements.
 */
export const arreterSurveillanceInactivite = () => {
  _actif = false;

  annulerMinuteurs();
  masquerBanniere();

  // Suppression des écouteurs d'activité
  EVENEMENTS_ACTIVITE.forEach((evt) => {
    window.removeEventListener(evt, surActivite);
  });

  // Suppression du bouton "Rester connecté"
  const boutonRester = document.querySelector('#banniere-inactivite [data-action="rester"]');
  if (boutonRester) {
    boutonRester.removeEventListener('click', reinitialiserMinuteurs);
  }

  _signOutFn = null;
};
