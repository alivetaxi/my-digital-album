import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { GroupJoinComponent } from './group-join.component';
import { GroupService } from '../../../core/services/group.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumApiError } from '../../../core/services/album.service';
import { Group } from '../../../core/models';

const makeGroup = (): Group => ({
  id: 'g1', name: 'Friends', ownerId: 'uid-owner',
  memberIds: ['uid-owner'], inviteToken: 'tok-abc',
  inviteTokenExpiresAt: new Date('2027-01-01'),
  createdAt: new Date('2025-01-01'),
});

function createComponent(token = 'tok-abc', authenticated = true) {
  const groupSpy = jasmine.createSpyObj<GroupService>('GroupService', ['joinGroup']);
  groupSpy.joinGroup.and.resolveTo(makeGroup());

  const authSpy = {
    uid: signal(authenticated ? 'uid-1' : null),
    isAuthenticated: signal(authenticated),
  } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [GroupJoinComponent],
    providers: [
      provideRouter([]),
      { provide: GroupService, useValue: groupSpy },
      { provide: AuthService, useValue: authSpy },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: () => token } } },
      },
    ],
  });

  const fixture = TestBed.createComponent(GroupJoinComponent);
  return { fixture, component: fixture.componentInstance, groupSpy };
}

describe('GroupJoinComponent', () => {
  it('reads token from query params on init', () => {
    const { component } = createComponent('my-token');
    component.ngOnInit();
    expect(component.token()).toBe('my-token');
  });

  it('sets loginUrl with returnUrl when token is present', () => {
    const { component } = createComponent('tok-abc');
    component.ngOnInit();
    expect(component.loginUrl()).toContain('/login?returnUrl=');
    expect(component.loginUrl()).toContain('tok-abc');
  });

  it('loginUrl is /login when token is empty', () => {
    const { component } = createComponent('');
    component.ngOnInit();
    expect(component.loginUrl()).toBe('/login');
  });

  it('sets joined state on successful join', fakeAsync(async () => {
    const { component } = createComponent();
    component.ngOnInit();
    const promise = component.join();
    tick();
    await promise;
    expect(component.joined()).toBeTrue();
    expect(component.joinedGroupName()).toBe('Friends');
    expect(component.joinedGroupId()).toBe('g1');
  }));

  it('sets joinError on failure', fakeAsync(async () => {
    const { component, groupSpy } = createComponent();
    groupSpy.joinGroup.and.rejectWith(
      new AlbumApiError({ code: 'EXPIRED_TOKEN', message: 'Token expired.', status: 400 })
    );
    component.ngOnInit();
    const promise = component.join();
    tick();
    await promise;
    expect(component.joinError()).toBe('Token expired.');
    expect(component.joined()).toBeFalse();
  }));

  it('does nothing when token is empty', fakeAsync(async () => {
    const { component, groupSpy } = createComponent('');
    component.ngOnInit();
    await component.join();
    expect(groupSpy.joinGroup).not.toHaveBeenCalled();
  }));

  it('navigates to group detail on goToGroup', fakeAsync(async () => {
    const { component } = createComponent();
    component.ngOnInit();
    const router = TestBed.inject(Router);
    const navSpy = spyOn(router, 'navigate');
    const promise = component.join();
    tick();
    await promise;
    component.goToGroup();
    expect(navSpy).toHaveBeenCalledWith(['/groups', 'g1']);
  }));
});
