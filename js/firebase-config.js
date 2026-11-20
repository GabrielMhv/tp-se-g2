/**
 * Configuration et initialisation Firebase (SDK v10 Modular)
 * Projet : tp2-se (ESP32 + Firebase Realtime Database)
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC92Kw3UoQbYhdBmvyw-wbegpLvjjC5pQE",
  authDomain: "tp2-se.firebaseapp.com",
  databaseURL: "https://tp2-se-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "tp2-se",
  storageBucket: "tp2-se.firebasestorage.app",
  messagingSenderId: "359901448617",
  appId: "1:359901448617:web:fc27929385f2adae785cb8",
  measurementId: "G-SN7D3E8NC3"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

