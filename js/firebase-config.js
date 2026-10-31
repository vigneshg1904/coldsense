// Firebase web-app configuration (public by design — security comes from database.rules.json).
export const firebaseConfig = {
  apiKey: "AIzaSyDDYYQ_QhFs9Kt1W7AuKkGQKiFmqxbDLhk",
  authDomain: "cold-chain-59ea3.firebaseapp.com",
  databaseURL: "https://cold-chain-59ea3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cold-chain-59ea3",
  storageBucket: "cold-chain-59ea3.firebasestorage.app",
  messagingSenderId: "26207448221",
  appId: "1:26207448221:web:f09f9188f7cf82a1b9b874",
  measurementId: "G-2Y4MYTYC98"
};

// Realtime Database node the ESP32 writes into (must match DB_ROOT in the firmware).
export const ROOT = "coldchain";
