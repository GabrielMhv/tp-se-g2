/**
 * Tests unitaires — Fonctions logiques et modules du système domotique
 * Exécution : npm test (via node:test natif)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Fonctions pures à tester ──

function esp32EnLigneHelper(derniere_vue, delaiS = 25) {
  if (typeof derniere_vue !== 'number' || derniere_vue <= 0) return false;
  return (Date.now() / 1000 - derniere_vue) < delaiS;
}

function heureHelper(ts) {
  return new Date(ts).toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function formaterDureeHelper(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h > 0) return `${h}h ${min}min`;
  return `${min} min`;
}

function formaterJoursHelper(jours) {
  const NOMS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
  if (!jours || jours.length === 0) return "Aucun jour";
  if (jours.length === 7) return "Tous les jours";
  if (jours.length === 5 && !jours.includes(0) && !jours.includes(6)) return "Semaine (Lun-Ven)";
  if (jours.length === 2 && jours.includes(0) && jours.includes(6)) return "Week-end";
  return jours.map(j => NOMS[j] || j).join(", ");
}

// ── Suites de tests ──

describe('esp32EnLigneHelper', () => {
  it('doit renvoyer false si derniere_vue est null ou 0', () => {
    assert.equal(esp32EnLigneHelper(null), false);
    assert.equal(esp32EnLigneHelper(0), false);
    assert.equal(esp32EnLigneHelper(-5), false);
  });

  it('doit renvoyer true si le heartbeat est reçu il y a moins de 25s', () => {
    const maintenant = Date.now() / 1000;
    assert.equal(esp32EnLigneHelper(maintenant - 5), true);
    assert.equal(esp32EnLigneHelper(maintenant - 20), true);
  });

  it('doit renvoyer false si le heartbeat dépasse 25s', () => {
    const maintenant = Date.now() / 1000;
    assert.equal(esp32EnLigneHelper(maintenant - 30), false);
  });
});

describe('formaterDureeHelper', () => {
  it('doit afficher les minutes quand durée < 1h', () => {
    assert.equal(formaterDureeHelper(0), '0 min');
    assert.equal(formaterDureeHelper(5 * 60 * 1000), '5 min');
    assert.equal(formaterDureeHelper(45 * 60 * 1000), '45 min');
  });

  it('doit afficher les heures et minutes quand durée >= 1h', () => {
    assert.equal(formaterDureeHelper(60 * 60 * 1000), '1h 0min');
    assert.equal(formaterDureeHelper(95 * 60 * 1000), '1h 35min');
    assert.equal(formaterDureeHelper(150 * 60 * 1000), '2h 30min');
  });
});

describe('formaterJoursHelper', () => {
  it('doit identifier les formats de jours typiques', () => {
    assert.equal(formaterJoursHelper([]), 'Aucun jour');
    assert.equal(formaterJoursHelper([0, 1, 2, 3, 4, 5, 6]), 'Tous les jours');
    assert.equal(formaterJoursHelper([1, 2, 3, 4, 5]), 'Semaine (Lun-Ven)');
    assert.equal(formaterJoursHelper([0, 6]), 'Week-end');
    assert.equal(formaterJoursHelper([1, 3]), 'Lun, Mer');
  });
});

describe('heureHelper', () => {
  it('doit retourner un format HH:MM:SS', () => {
    const resultat = heureHelper(Date.now());
    assert.match(resultat, /^\d{2}:\d{2}:\d{2}$/);
  });
});
