import { Injectable, signal, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { doc, getFirestore, setDoc } from 'firebase/firestore';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  private readonly firebaseAuth = getAuth();

  private readonly _user = signal<User | null | undefined>(undefined);

  /** undefined = loading, null = anonymous, User = signed in */
  readonly user = this._user.asReadonly();

  readonly isLoading = computed(() => this._user() === undefined);
  readonly isAuthenticated = computed(() => this._user() != null);
  readonly currentUser = computed(() => this._user() ?? null);
  readonly uid = computed(() => this._user()?.uid ?? null);

  constructor() {
    onAuthStateChanged(this.firebaseAuth, (user) => {
      this._user.set(user);
      if (user) {
        this._syncProfile(user);
      }
    });
  }

  /** Write displayName / email / photoURL to Firestore so group member lists can show them. */
  private _syncProfile(user: User): void {
    const db = getFirestore();
    const col = `users-${environment.production ? 'prod' : 'dev'}`;
    setDoc(
      doc(db, col, user.uid),
      {
        uid: user.uid,
        displayName: user.displayName ?? '',
        email: user.email ?? '',
        photoURL: user.photoURL ?? '',
      },
      { merge: true },
    ).catch(() => {
      // Non-critical — silently ignore; member list will fall back to uid only
    });
  }

  async signInWithGoogle(): Promise<void> {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(this.firebaseAuth, provider);
    this.router.navigate(['/albums']);
  }

  async signOut(): Promise<void> {
    await signOut(this.firebaseAuth);
    this.router.navigate(['/login']);
  }

  async getIdToken(): Promise<string | null> {
    const user = this._user();
    if (!user) return null;
    return user.getIdToken();
  }
}
