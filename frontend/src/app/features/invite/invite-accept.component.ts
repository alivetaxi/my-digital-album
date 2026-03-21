import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AlbumService, AlbumApiError } from '../../core/services/album.service';
import { AuthService } from '../../core/auth/auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="invite-page">
      @if (status() === 'loading') {
        <p>Accepting invite…</p>
      } @else if (status() === 'needs-login') {
        <p>You need to be signed in to accept this invitation.</p>
        <a class="btn-login" [routerLink]="['/login']" [queryParams]="{ returnUrl: loginReturnUrl() }">
          Sign in to accept
        </a>
      } @else if (status() === 'success') {
        <p>You now have access. Redirecting…</p>
      } @else if (status() === 'error') {
        <p class="error">{{ errorMessage() }}</p>
        <a [routerLink]="['/albums']">Go to albums</a>
      }
    </div>
  `,
  styles: [`
    .invite-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      gap: 16px;
      font-size: 1rem;
      color: var(--text-primary, #333);
    }
    .error { color: var(--error, #d93025); }
    a { color: var(--primary, #1a73e8); }
    .btn-login {
      padding: 10px 24px;
      background: var(--primary, #1a73e8);
      color: #fff;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
    }
    .btn-login:hover { opacity: 0.9; }
  `],
})
export class InviteAcceptComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly albumService = inject(AlbumService);
  private readonly auth = inject(AuthService);

  // Must be a class field so toObservable() runs in an injection context.
  private readonly authUser$ = toObservable(this.auth.user);

  readonly status = signal<'loading' | 'needs-login' | 'success' | 'error'>('loading');
  readonly errorMessage = signal('');
  readonly loginReturnUrl = signal('');

  async ngOnInit() {
    const albumId = this.route.snapshot.queryParamMap.get('albumId');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!albumId || !token) {
      this.status.set('error');
      this.errorMessage.set('Invalid invite link.');
      return;
    }

    // Wait for auth to resolve if still loading (undefined = not yet resolved).
    if (this.auth.user() === undefined) {
      await firstValueFrom(this.authUser$.pipe(filter(u => u !== undefined)));
    }

    if (!this.auth.uid()) {
      this.loginReturnUrl.set(`/invite?albumId=${albumId}&token=${token}`);
      this.status.set('needs-login');
      return;
    }

    try {
      await this.albumService.acceptInvite(albumId, token);
      this.status.set('success');
      setTimeout(() => this.router.navigate(['/albums', albumId]), 1500);
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set(err instanceof AlbumApiError ? err.message : 'Failed to accept invite.');
    }
  }
}
