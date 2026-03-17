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
