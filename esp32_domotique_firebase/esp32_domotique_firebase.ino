

#include <Arduino.h>
#include <WiFi.h>
#include <time.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"


#define WIFI_SSID      "NOM_DU_WIFI"
#define WIFI_PASSWORD  "MOT_DE_PASSE_WIFI"

#define API_KEY        "AIzaSyC92Kw3UoQbYhdBmvyw-wbegpLvjjC5pQE"
#define DATABASE_URL   "https://tp2-se-default-rtdb.europe-west1.firebasedatabase.app/"

// Compte Firebase Authentication : email/mot de passe
#define USER_EMAIL     "esp32@exemple.com"
#define USER_PASSWORD  "MOT_DE_PASSE_ESP32"

const uint8_t NB_RELAIS = 4;
const uint8_t PIN_RELAIS[4] = {26, 27, 32, 33};
const char* CLE_RELAIS[4] = {"relay1", "relay2", "relay3", "relay4"};
const bool RELAIS_ACTIF_BAS = true; // IN à LOW pour la plupart des modules relais 3,3 V.


const unsigned long DELAI_SECURITE_MS    = 30000;  // hors ligne > 30 s => tout éteindre
const unsigned long PERIODE_HEARTBEAT_MS = 10000;
const unsigned long PERIODE_RECO_WIFI_MS = 10000;
// true : restaure les commandes Firebase après une coupure ; false : remet tout à OFF.
const bool RESTAURER_APRES_RECONNEXION = true;


FirebaseData   fbdoFlux;
FirebaseData   fbdoEcriture;
FirebaseAuth   auth;
FirebaseConfig config;

// Écrites par le callback du stream, lues dans loop()
volatile bool commandeDemandee[4]  = {false, false, false, false};
volatile bool commandeEnAttente[4] = {false, false, false, false};

bool etatRelais[4]   = {false, false, false, false};
bool etatAPublier[4] = {false, false, false, false};

bool fluxDemarre      = false;
bool modeSecurite     = false;
bool resyncNecessaire = false;
bool etaitConnecte    = false;
bool firebaseEtaitPret = false;
bool firebaseInitialisee = false;
bool aEuCoupure       = false;
bool premierHeartbeat = true;
unsigned long dernierContactOK   = 0;
unsigned long dernierHeartbeat   = 0;
unsigned long dernierEssaiWiFi   = 0;
unsigned long nbReconnexions     = 0;


bool reseauOK() {
  return WiFi.status() == WL_CONNECTED && Firebase.ready();
}

time_t heureEpoch() {
  time_t t = time(nullptr);
  return (t > 1700000000) ? t : 0;   // 0 tant que l'heure NTP n'est pas synchronisée
}

const char* wifiStatutTexte(wl_status_t statut) {
  switch (statut) {
    case WL_NO_SSID_AVAIL: return "SSID introuvable";
    case WL_CONNECT_FAILED: return "mot de passe refuse ou connexion refusee";
    case WL_CONNECTION_LOST: return "connexion perdue";
    case WL_DISCONNECTED: return "deconnecte";
    case WL_CONNECTED: return "connecte";
    default: return "etat inconnu";
  }
}

void ecrireRelais(uint8_t i, bool actif) {
  digitalWrite(PIN_RELAIS[i], (actif == RELAIS_ACTIF_BAS) ? LOW : HIGH);
}

void appliquerRelais(uint8_t i, bool actif) {
  ecrireRelais(i, actif);
  etatRelais[i]   = actif;
  etatAPublier[i] = true;
  Serial.printf("[RELAIS] %s -> %s\n", CLE_RELAIS[i], actif ? "ON" : "OFF");
}

bool publierEtat(uint8_t i) {
  FirebaseJson json;
  json.set("etat", etatRelais[i]);
  json.set("maj", (int)heureEpoch());
  String chemin = String("/domotique/etats/") + CLE_RELAIS[i];
  bool ok = Firebase.RTDB.setJSON(&fbdoEcriture, chemin.c_str(), &json);
  if (!ok) Serial.printf("[FIREBASE] Echec publication %s : %s\n", CLE_RELAIS[i], fbdoEcriture.errorReason().c_str());
  return ok;
}

void publierHeartbeat() {
  FirebaseJson json;
  json.set("derniere_vue", (int)heureEpoch());
  json.set("rssi", WiFi.RSSI());
  json.set("ip", WiFi.localIP().toString());
  json.set("reconnexions", (int)nbReconnexions);
  json.set("mode_securite", modeSecurite);
  json.set("uptime_s", (int)(millis() / 1000));
  if (!Firebase.RTDB.updateNode(&fbdoEcriture, "/domotique/systeme", &json)) {
    Serial.printf("[FIREBASE] Echec heartbeat : %s\n", fbdoEcriture.errorReason().c_str());
  }
}

// Le callback mémorise les ordres ; loop() pilote les GPIO.
void fluxCallback(FirebaseStream data) {
  String chemin = data.dataPath();   // "/" au premier envoi, puis "/relay1", ...
  String type   = data.dataType();   // "json" ou "boolean"

  if (type == "json") {
    FirebaseJson *json = data.to<FirebaseJson *>();
    FirebaseJsonData r;
    for (uint8_t i = 0; i < NB_RELAIS; i++) {
      if (json->get(r, CLE_RELAIS[i]) && r.type == "boolean") {
        commandeDemandee[i]  = r.to<bool>();
        commandeEnAttente[i] = true;
      }
    }
  } else if (type == "boolean") {
    for (uint8_t i = 0; i < NB_RELAIS; i++) {
      if (chemin == String("/") + CLE_RELAIS[i]) {
        commandeDemandee[i]  = data.to<bool>();
        commandeEnAttente[i] = true;
      }
    }
  }
}

void fluxTimeoutCallback(bool timeout) {
  if (timeout) Serial.println("[FLUX] Délai dépassé, reprise automatique...");
}

void demarrerFlux() {
  if (Firebase.RTDB.beginStream(&fbdoFlux, "/domotique/commandes")) {
    Firebase.RTDB.setStreamCallback(&fbdoFlux, fluxCallback, fluxTimeoutCallback);
    fluxDemarre = true;
    Serial.println("[FLUX] Ecoute de /domotique/commandes active");
  } else {
    fluxDemarre = false;
    Serial.printf("[FLUX] Echec démarrage : %s\n", fbdoFlux.errorReason().c_str());
  }
}


void passerEnModeSecurite() {
  modeSecurite = true;
  Serial.println("[SECURITE] Connexion perdue trop longtemps : tous les relais passent à OFF");
  for (uint8_t i = 0; i < NB_RELAIS; i++) appliquerRelais(i, false);
}

void resynchroniser() {
  Serial.println("[SYNC] Reconnexion : resynchronisation avec Firebase");
  bool forcerArret = modeSecurite && !RESTAURER_APRES_RECONNEXION;

  if (forcerArret) {
    FirebaseJson json;
    for (uint8_t i = 0; i < NB_RELAIS; i++) json.set(CLE_RELAIS[i], false);
    if (!Firebase.RTDB.updateNode(&fbdoEcriture, "/domotique/commandes", &json)) return;
    for (uint8_t i = 0; i < NB_RELAIS; i++) {
      commandeDemandee[i]  = false;
      commandeEnAttente[i] = true;
    }
  } else {
    if (!Firebase.RTDB.getJSON(&fbdoEcriture, "/domotique/commandes")) return;
    FirebaseJson *json = fbdoEcriture.to<FirebaseJson *>();
    FirebaseJsonData r;
    for (uint8_t i = 0; i < NB_RELAIS; i++) {
      if (json->get(r, CLE_RELAIS[i]) && r.type == "boolean") {
        commandeDemandee[i]  = r.to<bool>();
        commandeEnAttente[i] = true;
      }
    }
  }
  demarrerFlux();
  modeSecurite     = false;
  resyncNecessaire = false;
}


void setup() {
  Serial.begin(115200);
  delay(200);

  // Coupe tous les relais au démarrage.
  for (uint8_t i = 0; i < NB_RELAIS; i++) {
    pinMode(PIN_RELAIS[i], OUTPUT);
    ecrireRelais(i, false);
    etatAPublier[i] = true;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connexion");
  unsigned long debut = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - debut < 20000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WIFI] Connecté, IP = %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.printf("[WIFI] Echec initial : %s (code %d)\n", wifiStatutTexte(WiFi.status()), WiFi.status());
    Serial.println("[WIFI] Nouvelles tentatives dans loop()");
  }

  configTime(0, 0, "pool.ntp.org", "time.google.com");   // heure UTC (epoch)

  config.api_key      = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email     = USER_EMAIL;
  auth.user.password  = USER_PASSWORD;
  config.token_status_callback = tokenStatusCallback;

  Firebase.reconnectWiFi(true);

  dernierContactOK = millis();
}


void loop() {
  unsigned long maintenant = millis();


  if (WiFi.status() != WL_CONNECTED && maintenant - dernierEssaiWiFi > PERIODE_RECO_WIFI_MS) {
    dernierEssaiWiFi = maintenant;
    Serial.println("[WIFI] Connexion perdue, nouvelle tentative...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("[WIFI] Etat apres tentative : %s (code %d)\n", wifiStatutTexte(WiFi.status()), WiFi.status());
  }

  if (WiFi.status() == WL_CONNECTED && !firebaseInitialisee) {
    Firebase.begin(&config, &auth);
    firebaseInitialisee = true;
    Serial.println("[FIREBASE] Initialisation avec le Wi-Fi actif");
  }


  bool connecte = reseauOK();
  if (connecte && !firebaseEtaitPret) {
    firebaseEtaitPret = true;
    Serial.println("[FIREBASE] Authentification réussie, base de données disponible");
  } else if (!connecte && firebaseEtaitPret) {
    firebaseEtaitPret = false;
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("[FIREBASE] Service indisponible ou authentification perdue");
    }
  }
  if (connecte) {
    dernierContactOK = maintenant;
    if (!etaitConnecte) {
      etaitConnecte = true;
      if (aEuCoupure) {
        nbReconnexions++;
        resyncNecessaire = true;
        Serial.println("[RESEAU] Connexion rétablie");
      }
    }
  } else {
    if (etaitConnecte) {
      etaitConnecte = false;
      aEuCoupure = true;
      Serial.println("[RESEAU] Connexion perdue");
    }
    if (!modeSecurite && maintenant - dernierContactOK > DELAI_SECURITE_MS) {
      passerEnModeSecurite();
    }
  }


  if (connecte && !fluxDemarre) demarrerFlux();
  if (connecte && resyncNecessaire) resynchroniser();


  for (uint8_t i = 0; i < NB_RELAIS; i++) {
    if (commandeEnAttente[i]) {
      commandeEnAttente[i] = false;
      appliquerRelais(i, commandeDemandee[i]);
    }
  }


  if (connecte) {
    for (uint8_t i = 0; i < NB_RELAIS; i++) {
      if (etatAPublier[i] && publierEtat(i)) etatAPublier[i] = false;
    }
  }


  if (connecte && (premierHeartbeat || maintenant - dernierHeartbeat >= PERIODE_HEARTBEAT_MS)) {
    premierHeartbeat = false;
    dernierHeartbeat = maintenant;
    publierHeartbeat();
  }

  delay(20);
}
