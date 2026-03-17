import { Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { BottomNavComponent } from './shared/components/bottom-nav/bottom-nav.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, BottomNavComponent],
  template: `
    <router-outlet />
    @if (showNav()) {
      <app-bottom-nav />
    }
  `,
  styles: [`:host { display: block; min-height: 100dvh; }`],
})
export class AppComponent {
  private readonly router = inject(Router);

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(e => (e as NavigationEnd).urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  // Hide the bottom nav in the full-screen media viewer and login page
  readonly showNav = computed(() => {
    const url = this.currentUrl();
    return !url.includes('/media/') && !url.startsWith('/login');
  });
}
