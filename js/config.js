// Firebase web config. These values identify the project; they are not secrets.
// Access is controlled by Firebase Auth plus the Firestore rules.
export const firebaseConfig = {
  apiKey: 'AIzaSyAy9OnG7lQOMXTjP8GeMI9eYLzhomCZi_4',
  authDomain: 'familyhub-10926.firebaseapp.com',
  projectId: 'familyhub-10926',
  storageBucket: 'familyhub-10926.firebasestorage.app',
  messagingSenderId: '185119337790',
  appId: '1:185119337790:web:268b97910114671b6fd06f',
  measurementId: 'G-4GZ194KMMV'
};

// Firebase email/password auth needs an email, so a plain username is turned
// into "<username>@" + this domain behind the scenes. A full email also works.
export const USERNAME_DOMAIN = 'familyhub.local';

export const FIREBASE_VERSION = '12.19.0';
