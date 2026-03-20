import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { GroupListComponent } from './group-list.component';
import { GroupService } from '../../../core/services/group.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumApiError } from '../../../core/services/album.service';
import { Group } from '../../../core/models';

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1',
  name: 'Test Group',
  ownerId: 'uid-1',
  memberIds: ['uid-1'],
  inviteToken: 'tok',
  inviteTokenExpiresAt: new Date('2027-01-01'),
  createdAt: new Date('2025-01-01'),
  ...overrides,
});

function createComponent(options: { groups?: Group[]; authenticated?: boolean } = {}) {
  const { groups = [makeGroup()], authenticated = true } = options;

  const groupSpy = jasmine.createSpyObj<GroupService>('GroupService', ['listMyGroups', 'createGroup']);
  groupSpy.listMyGroups.and.resolveTo(groups);
  groupSpy.createGroup.and.resolveTo(makeGroup({ id: 'g2', name: 'New Group' }));

  const authSpy = {
    uid: signal(authenticated ? 'uid-1' : null),
    isAuthenticated: signal(authenticated),
  } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [GroupListComponent],
    providers: [
      provideRouter([]),
      { provide: GroupService, useValue: groupSpy },
      { provide: AuthService, useValue: authSpy },
    ],
  });

  const fixture = TestBed.createComponent(GroupListComponent);
  return { fixture, component: fixture.componentInstance, groupSpy };
}

describe('GroupListComponent', () => {
  describe('initialization', () => {
    it('loads groups on init', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit();
      tick();
      expect(component.groups().length).toBe(1);
      expect(component.isLoading()).toBeFalse();
    }));

    it('sets loadError on failure', fakeAsync(async () => {
      const { component, groupSpy } = createComponent();
      groupSpy.listMyGroups.and.rejectWith(new Error('network'));
      await component.ngOnInit();
      tick();
      expect(component.loadError()).toBeTrue();
      expect(component.isLoading()).toBeFalse();
    }));
  });

  describe('createGroup', () => {
    it('adds new group to list', fakeAsync(async () => {
      const { component } = createComponent({ groups: [] });
      await component.ngOnInit();
      tick();

      component.newGroupName.set('New Group');
      const promise = component.createGroup();
      tick();
      await promise;

      expect(component.groups().length).toBe(1);
      expect(component.groups()[0].name).toBe('New Group');
      expect(component.showCreateForm()).toBeFalse();
    }));

    it('sets createError on API failure', fakeAsync(async () => {
      const { component, groupSpy } = createComponent({ groups: [] });
      groupSpy.createGroup.and.rejectWith(
        new AlbumApiError({ code: 'PERMISSION_DENIED', message: 'Denied.', status: 403 })
      );
      await component.ngOnInit();
      tick();

      component.newGroupName.set('X');
      const promise = component.createGroup();
      tick();
      await promise;

      expect(component.createError()).toBeTruthy();
    }));

    it('does nothing when name is empty', fakeAsync(async () => {
      const { component, groupSpy } = createComponent();
      await component.ngOnInit();
      tick();

      component.newGroupName.set('  ');
      await component.createGroup();

      expect(groupSpy.createGroup).not.toHaveBeenCalled();
    }));
  });

  describe('modal state', () => {
    it('openCreateForm shows modal', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit();
      tick();
      component.openCreateForm();
      expect(component.showCreateForm()).toBeTrue();
    }));

    it('cancelCreate hides modal', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit();
      tick();
      component.openCreateForm();
      component.cancelCreate();
      expect(component.showCreateForm()).toBeFalse();
    }));
  });
});
