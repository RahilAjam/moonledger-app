// Firebase Web app settings are public client configuration; never put a service account key here.
// Confirm these values in Firebase Console > Project settings > Your apps before deployment.
export const firebaseConfig = {
  apiKey: "AIzaSyChOANwWo-JL89rPl0MxQQ4vOtdmWANiYE",
  // Use the Hosting domain for OAuth redirects so standalone mobile browsers
  // keep auth state across the Google sign-in round trip.
  authDomain: "moonledger-2b6fb.web.app",
  projectId: "moonledger-2b6fb",
  storageBucket: "moonledger-2b6fb.firebasestorage.app",
  messagingSenderId: "456255922118",
  appId: "1:456255922118:web:9c35a8186868f34c851cc7",
  measurementId: "G-BYT523SHN1",
  // Paste the public Web Push certificate key from Firebase Console > Project settings > Cloud Messaging.
  vapidKey: ""
};
