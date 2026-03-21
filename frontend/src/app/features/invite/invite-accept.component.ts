import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlbumService, AlbumApiError } from '../../core/services/album.service';
import { AuthService } from '../../core/auth/auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-invite-accept',
  standalone: true,
  imports: [],
  template: `
    <div class="invite-page">
      @if (status() === 'loading') {
        <p>Accepting invite…</p>
      } @else if (status() === 'success') {
        <p>You now have access. Redirecting…</p>
      } @else if (status() === 'error') {
        <p class="error">{{ errorMessage() }}</p>
        <a href="/albums">Go to albums</a>
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
  `],
})
export class InviteAcceptComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly albumService = inject(AlbumService);
  private readonly auth = inject(AuthService);

  readonly status = signal<'loading' | 'success' | 'error'>('loading');
  readonly errorMessage = signal('');

  async ngOnInit() {
    const albumId = this.route.snapshot.queryParamMap.get('albumId');
    const token = this.route.snapshot.queryParamMap.get('token');

    if (!albumId || !token) {
      this.status.set('error');
      this.errorMessage.set('Invalid invite link.');
      return;
    }

    // Wait for auth to resolve
    await firstValueFrom(
      toObservable(this.auth.user).pipe(filter(u => u !== undefined))
    );

    if (!this.auth.uid()) {
      const returnUrl = `/invite?albumId=${albumId}&token=${token}`;
      this.router.navigate(['/login'], { queryParams: { returnUrl } });
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
