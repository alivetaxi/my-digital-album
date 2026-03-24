import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { environment } from '../environments/environment';

// Initialize Firebase app eagerly at config time
initializeApp(environment.firebase);

// In e2e builds, connect to the Firebase Auth emulator and expose a window
// helper so Playwright fixtures can sign in without a real Google OAuth popup.
if ((environment as { useEmulators?: boolean }).useEmulators) {
  connectAuthEmulator(getAuth(), 'http://127.0.0.1:9099', { disableWarnings: true });
  (window as Window & { __e2eAuth?: unknown }).__e2eAuth = {
    signIn: (email: string, password: string) =>
      signInWithEmailAndPassword(getAuth(), email, password),
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(),
  ],
};
