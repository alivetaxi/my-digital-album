export const environment = {
  production: false,
  useEmulators: true,
  firebase: {
    // Fake values are fine — Firebase Auth Emulator ignores them except projectId.
    apiKey: 'demo-key',
    authDomain: 'demo-project.firebaseapp.com',
    projectId: 'demo-project',
    storageBucket: 'demo-project.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:000000000000',
  },
};
