/**
 * Module de notifications navigateur (Web Notifications API)
 * Projet domotique ESP32 + Firebase
 */

/**
 * Demande la permission d'envoyer des notifications si elle n'a pas encore été accordée.
 * Ne fait rien si la permission est déjà accordée ou refusée.
 * @returns {Promise<NotificationPermission>}
 */
export const demanderPermissionNotif = async () => {
  if (!('Notification' in window)) return 'denied';

  if (Notification.permission === 'default') {
    return await Notification.requestPermission();
  }

  return Notification.permission;
};

/**
 * Envoie une notification navigateur si la permission est accordée
 * et si l'onglet n'est pas visible (document.hidden).
 * @param {string} titre - Titre de la notification
 * @param {string} corps  - Corps du message
 * @param {string} [icone=''] - URL de l'icône (optionnelle)
 * @returns {Notification|null}
 */
export const notifier = (titre, corps, icone = '') => {
  if (!('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  // N'envoyer que si l'onglet est en arrière-plan
  if (!document.hidden) return null;

  const options = { body: corps };
  if (icone) options.icon = icone;

  return new Notification(titre, options);
};

/**
 * Notification spécifique : ESP32 est passé hors ligne.
 * @returns {Notification|null}
 */
export const notifESP32HorsLigne = () =>
  notifier(
    'ESP32 hors ligne',
    "Le module ESP32 ne répond plus. Vérifiez la connexion Wi-Fi."
  );

/**
 * Notification spécifique : ESP32 est de nouveau en ligne.
 * @returns {Notification|null}
 */
export const notifESP32EnLigne = () =>
  notifier(
    'ESP32 en ligne',
    "Le module ESP32 est de nouveau connecté et opérationnel."
  );

/**
 * Notification de changement d'état d'un relais (confirmation reçue de l'ESP32).
 * @param {string} nom  - Nom du relais (ex. "Lampe du salon")
 * @param {boolean} etat - Nouvel état confirmé (true = allumé, false = éteint)
 * @returns {Notification|null}
 */
export const notifRelaisChange = (nom, etat) =>
  notifier(
    `Relais mis à jour : ${nom}`,
    `${nom} a été ${etat ? 'allumé(e)' : 'éteint(e)'} — confirmé par l'ESP32.`
  );
