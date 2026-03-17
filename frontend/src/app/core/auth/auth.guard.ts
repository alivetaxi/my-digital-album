import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  // Wait until the initial auth state is resolved (not undefined)
  return toObservable(auth.user).pipe(
    filter(user => user !== undefined),
    take(1),
    map(user => {
      if (user != null) return true;
      return router.createUrlTree(['/login']);
    }),
  );
};
