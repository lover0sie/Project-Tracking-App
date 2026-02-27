import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  collection,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* Firebase configuration and database initialization */
const firebaseConfig = {
  apiKey: "AIzaSyBePrEYgwU4tD9h82n9PbjfxtTyQMXm6Kk",
  authDomain: "qrcodetesting-4f86e.firebaseapp.com",
  projectId: "qrcodetesting-4f86e",
  storageBucket: "qrcodetesting-4f86e.firebasestorage.app",
  messagingSenderId: "746921254909",
  appId: "1:746921254909:web:7acce026b9d96c97880394"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Firebase helpers
export {
  collection,
  updateDoc,
  doc,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  limit
};