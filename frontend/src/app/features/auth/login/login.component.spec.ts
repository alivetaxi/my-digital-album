import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { LoginComponent } from './login.component';
import { AuthService } from '../../../core/auth/auth.service';

function createComponent(returnUrl: string | null = null) {
  const authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['signInWithGoogle']);
  (authSpy as any).isLoading = signal(false);

  const activatedRouteMock = {
    snapshot: {
      queryParamMap: convertToParamMap(returnUrl ? { returnUrl } : {}),
    },
  };

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AuthService, useValue: authSpy },
      { provide: ActivatedRoute, useValue: activatedRouteMock },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  return { component: fixture.componentInstance, authSpy };
}

describe('LoginComponent', () => {
  describe('signIn', () => {
    it('passes returnUrl from query param to signInWithGoogle', () => {
      const { component, authSpy } = createComponent('/join?token=abc');
      component.signIn();
      expect(authSpy.signInWithGoogle).toHaveBeenCalledWith('/join?token=abc');
    });

    it('defaults to /albums when returnUrl is absent', () => {
      const { component, authSpy } = createComponent(null);
      component.signIn();
      expect(authSpy.signInWithGoogle).toHaveBeenCalledWith('/albums');
    });
  });
});
