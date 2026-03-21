import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { InviteAcceptComponent } from './invite-accept.component';
import { AlbumService, AlbumApiError } from '../../core/services/album.service';
import { AuthService } from '../../core/auth/auth.service';

function createComponent(options: {
  albumId?: string | null;
  token?: string | null;
  uid?: string | null;
} = {}) {
  const { albumId = 'a1', token = 'tok', uid = 'uid-1' } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', ['acceptInvite']);
  albumSpy.acceptInvite.and.resolveTo({} as any);

  // user: signal(null) = auth resolved, not signed in.
  // user: signal({ uid }) = auth resolved, signed in.
  const userValue = uid ? { uid } : null;
  const authStub = {
    user: signal(userValue as any),
    uid: signal(uid),
  } as unknown as AuthService;

  const activatedRouteMock = {
    snapshot: {
      queryParamMap: {
        get: (k: string) => {
          if (k === 'albumId') return albumId;
          if (k === 'token') return token;
          return null;
        },
      },
    },
  };

  TestBed.configureTestingModule({
    imports: [InviteAcceptComponent],
    providers: [
      provideRouter([]),
      { provide: AlbumService, useValue: albumSpy },
      { provide: AuthService, useValue: authStub },
      { provide: ActivatedRoute, useValue: activatedRouteMock },
    ],
  });

  const fixture = TestBed.createComponent(InviteAcceptComponent);
  return { fixture, component: fixture.componentInstance, albumSpy };
}

describe('InviteAcceptComponent', () => {
  describe('invalid link', () => {
    it('sets error status when albumId is missing', fakeAsync(async () => {
      const { component } = createComponent({ albumId: null });
      await component.ngOnInit();
      tick();
      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Invalid invite link.');
    }));

    it('sets error status when token is missing', fakeAsync(async () => {
      const { component } = createComponent({ token: null });
      await component.ngOnInit();
      tick();
      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Invalid invite link.');
    }));
  });

  describe('unauthenticated user', () => {
    it('sets needs-login status and populates loginReturnUrl', fakeAsync(async () => {
      const { component } = createComponent({ uid: null });
      await component.ngOnInit();
      tick();
      expect(component.status()).toBe('needs-login');
      expect(component.loginReturnUrl()).toBe('/invite?albumId=a1&token=tok');
    }));

    it('does not call acceptInvite when not signed in', fakeAsync(async () => {
      const { component, albumSpy } = createComponent({ uid: null });
      await component.ngOnInit();
      tick();
      expect(albumSpy.acceptInvite).not.toHaveBeenCalled();
    }));
  });

  describe('authenticated user', () => {
    it('calls acceptInvite and sets success status', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      spyOn(TestBed.inject(Router), 'navigate').and.returnValue(Promise.resolve(true));

      const promise = component.ngOnInit();
      tick();
      await promise;
      tick(1500);

      expect(albumSpy.acceptInvite).toHaveBeenCalledWith('a1', 'tok');
      expect(component.status()).toBe('success');
    }));

    it('navigates to the album after a short delay on success', fakeAsync(async () => {
      const { component } = createComponent();
      const router = TestBed.inject(Router);
      spyOn(router, 'navigate').and.returnValue(Promise.resolve(true));

      const promise = component.ngOnInit();
      tick();
      await promise;

      tick(1500);
      expect(router.navigate).toHaveBeenCalledWith(['/albums', 'a1']);
    }));

    it('sets error status on API failure', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.acceptInvite.and.rejectWith(
        new AlbumApiError({ code: 'INVITE_TOKEN_INVALID', message: 'Token invalid.', status: 400 })
      );

      const promise = component.ngOnInit();
      tick();
      await promise;

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Token invalid.');
    }));

    it('sets generic error message for non-API errors', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.acceptInvite.and.rejectWith(new Error('network'));

      const promise = component.ngOnInit();
      tick();
      await promise;

      expect(component.status()).toBe('error');
      expect(component.errorMessage()).toBe('Failed to accept invite.');
    }));
  });
});
