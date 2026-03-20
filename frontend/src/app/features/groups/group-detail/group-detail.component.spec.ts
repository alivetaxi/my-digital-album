import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter, ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { GroupDetailComponent } from './group-detail.component';
import { GroupService, GroupMember } from '../../../core/services/group.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumApiError } from '../../../core/services/album.service';
import { Group } from '../../../core/models';

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Friends', ownerId: 'uid-owner',
  memberIds: ['uid-owner', 'uid-member'],
  inviteToken: 'tok-abc', inviteTokenExpiresAt: new Date('2027-01-01'),
  createdAt: new Date('2025-01-01'), ...overrides,
});

const makeMembers = (): GroupMember[] => [
  { uid: 'uid-owner', displayName: 'Alice', email: 'alice@example.com', photoURL: null },
  { uid: 'uid-member', displayName: 'Bob', email: 'bob@example.com', photoURL: null },
];

function createComponent(uid = 'uid-owner', group = makeGroup()) {
  const groupSpy = jasmine.createSpyObj<GroupService>('GroupService', [
    'getGroup', 'listMembers', 'regenerateInvite', 'leaveGroup',
  ]);
  groupSpy.getGroup.and.resolveTo(group);
  groupSpy.listMembers.and.resolveTo(makeMembers());
  groupSpy.regenerateInvite.and.resolveTo({ inviteToken: 'new-tok', inviteTokenExpiresAt: '2027-06-01T00:00:00Z' });
  groupSpy.leaveGroup.and.resolveTo(undefined);

  const authSpy = {
    uid: signal(uid),
    isAuthenticated: signal(true),
  } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [GroupDetailComponent],
    providers: [
      provideRouter([]),
      { provide: GroupService, useValue: groupSpy },
      { provide: AuthService, useValue: authSpy },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => 'g1' } } } },
    ],
  });

  const fixture = TestBed.createComponent(GroupDetailComponent);
  return { fixture, component: fixture.componentInstance, groupSpy };
}

describe('GroupDetailComponent', () => {
  describe('initialization', () => {
    it('loads group and members', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit();
      tick();
      expect(component.group()?.name).toBe('Friends');
      expect(component.members().length).toBe(2);
      expect(component.isLoading()).toBeFalse();
    }));

    it('sets loadError on failure', fakeAsync(async () => {
      const { component, groupSpy } = createComponent();
      groupSpy.getGroup.and.rejectWith(new Error('network'));
      await component.ngOnInit();
      tick();
      expect(component.loadError()).toBeTrue();
    }));
  });

  describe('isOwner', () => {
    it('is true when current user is owner', fakeAsync(async () => {
      const { component } = createComponent('uid-owner');
      await component.ngOnInit(); tick();
      expect(component.isOwner()).toBeTrue();
    }));

    it('is false for a regular member', fakeAsync(async () => {
      const { component } = createComponent('uid-member');
      await component.ngOnInit(); tick();
      expect(component.isOwner()).toBeFalse();
    }));
  });

  describe('regenerateInvite', () => {
    it('updates inviteToken on success', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit(); tick();
      const promise = component.regenerateInvite();
      tick();
      await promise;
      expect(component.inviteToken()).toBe('new-tok');
    }));

    it('sets regenerateError on failure', fakeAsync(async () => {
      const { component, groupSpy } = createComponent();
      groupSpy.regenerateInvite.and.rejectWith(
        new AlbumApiError({ code: 'PERMISSION_DENIED', message: 'Denied.', status: 403 })
      );
      await component.ngOnInit(); tick();
      const promise = component.regenerateInvite();
      tick();
      await promise;
      expect(component.regenerateError()).toBeTruthy();
    }));
  });

  describe('leaveGroup', () => {
    beforeEach(() => spyOn(window, 'confirm').and.returnValue(true));

    it('navigates to /groups after leaving', fakeAsync(async () => {
      const { component } = createComponent('uid-member');
      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate');
      await component.ngOnInit(); tick();
      const promise = component.leaveGroup();
      tick();
      await promise;
      expect(navSpy).toHaveBeenCalledWith(['/groups']);
    }));

    it('does nothing when confirm is cancelled', fakeAsync(async () => {
      (window.confirm as jasmine.Spy).and.returnValue(false);
      const { component, groupSpy } = createComponent('uid-member');
      await component.ngOnInit(); tick();
      await component.leaveGroup();
      expect(groupSpy.leaveGroup).not.toHaveBeenCalled();
    }));
  });

  describe('memberInitial / memberLabel', () => {
    it('uses first char of displayName', () => {
      const { component } = createComponent();
      expect(component.memberInitial({ uid: 'x', displayName: 'Alice', email: null, photoURL: null })).toBe('A');
    });

    it('falls back to email initial when no displayName', () => {
      const { component } = createComponent();
      expect(component.memberInitial({ uid: 'x', displayName: null, email: 'bob@x.com', photoURL: null })).toBe('B');
    });
  });
});
