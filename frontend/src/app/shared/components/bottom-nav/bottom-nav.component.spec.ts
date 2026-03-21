import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { BottomNavComponent } from './bottom-nav.component';
import { AuthService } from '../../../core/auth/auth.service';
import { User } from '../../../core/models';

const makeUser = (overrides: Partial<User> = {}): User => ({
  uid: 'uid-1',
  displayName: 'Alice',
  email: 'alice@example.com',
  photoURL: 'https://avatar/alice',
  groupIds: [],
  ...overrides,
});

function createComponent(options: { authenticated?: boolean; user?: User | null } = {}) {
  const { authenticated = true, user = makeUser() } = options;

  const authStub = {
    isAuthenticated: signal(authenticated),
    currentUser: signal(authenticated ? user : null),
  } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [BottomNavComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: authStub },
    ],
  });

  const fixture = TestBed.createComponent(BottomNavComponent);
  return { fixture, component: fixture.componentInstance };
}

describe('BottomNavComponent', () => {
  it('exposes isAuthenticated from AuthService', () => {
    const { component } = createComponent({ authenticated: true });
    expect(component.isAuthenticated()).toBeTrue();
  });

  it('isAuthenticated is false when not signed in', () => {
    const { component } = createComponent({ authenticated: false });
    expect(component.isAuthenticated()).toBeFalse();
  });

  it('exposes current user from AuthService', () => {
    const user = makeUser({ displayName: 'Bob' });
    const { component } = createComponent({ user });
    expect(component.user()?.displayName).toBe('Bob');
  });

  it('user is null when not signed in', () => {
    const { component } = createComponent({ authenticated: false, user: null });
    expect(component.user()).toBeNull();
  });
});
