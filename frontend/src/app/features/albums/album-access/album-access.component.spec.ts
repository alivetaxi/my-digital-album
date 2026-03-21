import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AlbumAccessComponent } from './album-access.component';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';
import { AlbumMember } from '../../../core/models';

const makeMember = (overrides: Partial<AlbumMember> = {}): AlbumMember => ({
  email: 'member@example.com',
  userId: 'uid-member',
  displayName: 'Member User',
  photoURL: null,
  permission: 'read',
  inviteToken: null,
  addedAt: new Date().toISOString(),
  ...overrides,
});

function createComponent(options: { isOwner?: boolean } = {}) {
  const { isOwner = true } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', [
    'listMembers', 'addMember', 'updateMemberPermission', 'removeMember',
  ]);
  albumSpy.listMembers.and.resolveTo([]);
  albumSpy.addMember.and.resolveTo(makeMember({ userId: 'uid-new', email: 'new@example.com' }));
  albumSpy.updateMemberPermission.and.resolveTo(makeMember({ permission: 'write' }));
  albumSpy.removeMember.and.resolveTo(undefined);

  TestBed.configureTestingModule({
    imports: [AlbumAccessComponent],
    providers: [{ provide: AlbumService, useValue: albumSpy }],
  });

  const fixture = TestBed.createComponent(AlbumAccessComponent);
  fixture.componentRef.setInput('albumId', 'album-1');
  fixture.componentRef.setInput('isOwner', isOwner);
  return { fixture, component: fixture.componentInstance, albumSpy };
}

describe('AlbumAccessComponent', () => {
  describe('ngOnInit', () => {
    it('loads members on init', fakeAsync(async () => {
      const member = makeMember();
      const { component, albumSpy } = createComponent();
      albumSpy.listMembers.and.resolveTo([member]);

      const promise = component.ngOnInit(); tick(); await promise;

      expect(albumSpy.listMembers).toHaveBeenCalledWith('album-1');
      expect(component.members().length).toBe(1);
      expect(component.isLoading()).toBeFalse();
    }));

    it('sets errorMessage when listMembers fails', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.listMembers.and.rejectWith(new Error('network'));

      const promise = component.ngOnInit(); tick(); await promise;

      expect(component.errorMessage()).toBe('Failed to load members.');
    }));
  });

  describe('addMember', () => {
    it('calls addMember and appends to list', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      const promise = component.ngOnInit(); tick(); await promise;

      component.newEmail.set('new@example.com');
      component.newPermission.set('write');
      const addPromise = component.addMember(); tick(); await addPromise;

      expect(albumSpy.addMember).toHaveBeenCalledWith('album-1', 'new@example.com', 'write');
      expect(component.members().length).toBe(1);
      expect(component.newEmail()).toBe('');
    }));

    it('does nothing when email is empty', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      component.newEmail.set('  ');
      await component.addMember();
      expect(albumSpy.addMember).not.toHaveBeenCalled();
    }));

    it('sets addError on API error', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.addMember.and.rejectWith(
        new AlbumApiError({ code: 'ALREADY_MEMBER', message: 'Already a member.', status: 409 })
      );
      component.newEmail.set('dup@example.com');
      const promise = component.addMember(); tick(); await promise;
      expect(component.addError()).toBe('Already a member.');
    }));
  });

  describe('changePermission', () => {
    it('calls updateMemberPermission and updates the list', fakeAsync(async () => {
      const member = makeMember({ permission: 'read' });
      const { component, albumSpy } = createComponent();
      albumSpy.listMembers.and.resolveTo([member]);
      const initPromise = component.ngOnInit(); tick(); await initPromise;

      const changePromise = component.changePermission('member@example.com', 'write');
      tick(); await changePromise;

      expect(albumSpy.updateMemberPermission).toHaveBeenCalledWith('album-1', 'member@example.com', 'write');
      expect(component.members()[0].permission).toBe('write');
    }));
  });

  describe('removeMember', () => {
    it('calls removeMember and removes from list', fakeAsync(async () => {
      const member = makeMember();
      const { component, albumSpy } = createComponent();
      albumSpy.listMembers.and.resolveTo([member]);
      const initPromise = component.ngOnInit(); tick(); await initPromise;

      const removePromise = component.removeMember('member@example.com');
      tick(); await removePromise;

      expect(albumSpy.removeMember).toHaveBeenCalledWith('album-1', 'member@example.com');
      expect(component.members().length).toBe(0);
    }));
  });

  describe('close', () => {
    it('emits closed', () => {
      const { component } = createComponent();
      let emitted = false;
      component.closed.subscribe(() => (emitted = true));
      component.close();
      expect(emitted).toBeTrue();
    });
  });
});
