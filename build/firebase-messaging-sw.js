// Firebase Cloud Messaging Service Worker
// This file handles background notifications

importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Initialize Firebase in the service worker
firebase.initializeApp({
  apiKey: "AIzaSyBTBCl2o15awDMqhRijkgqhBQqZH3vV9zw",
  authDomain: "quick-chat-13936.firebaseapp.com",
  projectId: "quick-chat-13936",
  storageBucket: "quick-chat-13936.firebasestorage.app",
  messagingSenderId: "62455577295",
  appId: "1:62455577295:web:f4d89e7c29117a3ffd55ba",
  measurementId: "G-DYPET9NM4F"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message:', payload);

  const notificationTitle = payload.notification?.title || 'QuickChat';
  const notificationOptions = {
    body: payload.notification?.body || 'New notification',
    icon: '/android-chrome-192x192.png',
    badge: '/favicon-32x32.png',
    data: payload.data,
    tag: payload.data?.consultationId || 'default',
    requireInteraction: payload.data?.type === 'consultation' && payload.data?.action === 'incoming_call',
    vibrate: [200, 100, 200],
    silent: false,
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  console.log('[firebase-messaging-sw.js] Notification clicked:', event.notification);
  
  event.notification.close();

  const data = event.notification.data;
  let urlToOpen = '/';

  // Navigate based on notification type
  if (data) {
    if (data.type === 'consultation' && data.consultationId) {
      urlToOpen = `/consultation/${data.consultationId}`;
    } else if (data.type === 'wallet') {
      urlToOpen = '/wallet';
    }
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if there's already a window open
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      // If not, open a new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
