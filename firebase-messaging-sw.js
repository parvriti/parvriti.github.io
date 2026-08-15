/* =====================================================================
   firebase-messaging-sw.js — the background push handler.

   The Firebase SDK auto-registers this file (at its own scope, so it does
   NOT clash with sw.js which handles offline caching). It just needs to
   initialise messaging; the SDK then shows the notification and opens the
   app when it's tapped.
   ===================================================================== */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBW_EMfKIkIJDNSMPUp6UeHOGtIdv26Wpk',
  authDomain: 'parvriti.firebaseapp.com',
  projectId: 'parvriti',
  storageBucket: 'parvriti.firebasestorage.app',
  messagingSenderId: '598106428796',
  appId: '1:598106428796:web:bcb49b129377d9a5d6c0f9'
});

firebase.messaging();
