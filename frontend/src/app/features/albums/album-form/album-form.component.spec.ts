import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AlbumFormComponent } from './album-form.component';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';
import { GroupService } from '../../../core/services/group.service';
import { Group, Album } from '../../../core/models';

const makeGroup = (overrides: Partial<Group> = {}): Group => ({
  id: 'g1', name: 'Friends', ownerId: 'uid-1',
  memberIds: ['uid-1'], inviteToken: 'tok',
  inviteTokenExpiresAt: new Date('2027-01-01'),
  createdAt: new Date('2025-01-01'), ...overrides,
});

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: 'a1', title: 'Vacation', coverMediaId: null, coverThumbnailUrl: null,
  ownerId: 'uid-1', ownerType: 'user', groupId: null,
  visibility: 'private', mediaCount: 0,
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

function createComponent(options: { album?: Album | null; groups?: Group[] } = {}) {
  const { album = null, groups = [] } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', ['createAlbum', 'updateAlbum']);
  albumSpy.createAlbum.and.resolveTo(makeAlbum({ title: 'New' }));
  albumSpy.updateAlbum.and.resolveTo(makeAlbum({ title: 'Updated' }));

  const groupSpy = jasmine.createSpyObj<GroupService>('GroupService', ['listMyGroups']);
  groupSpy.listMyGroups.and.resolveTo(groups);

  TestBed.configureTestingModule({
    imports: [AlbumFormComponent],
    providers: [
      provideRouter([]),
      { provide: AlbumService, useValue: albumSpy },
      { provide: GroupService, useValue: groupSpy },
    ],
  });

  const fixture = TestBed.createComponent(AlbumFormComponent);
  if (album) fixture.componentRef.setInput('album', album);
  return { fixture, component: fixture.componentInstance, albumSpy, groupSpy };
}

describe('AlbumFormComponent', () => {
  describe('initialization', () => {
    it('loads groups on init', fakeAsync(async () => {
      const { component } = createComponent({ groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      expect(component.groups().length).toBe(1);
    }));

    it('prefills title and visibility in edit mode', fakeAsync(async () => {
      const album = makeAlbum({ title: 'Trip', visibility: 'public' });
      const { component } = createComponent({ album });
      await component.ngOnInit(); tick();
      expect(component.title()).toBe('Trip');
      expect(component.visibility()).toBe('public');
    }));

    it('prefills selectedGroupId in edit mode', fakeAsync(async () => {
      const album = makeAlbum({ visibility: 'group', groupId: 'g1' });
      const { component } = createComponent({ album, groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      expect(component.selectedGroupId()).toBe('g1');
    }));
  });

  describe('setVisibility', () => {
    it('clears selectedGroupId when switching away from group', fakeAsync(async () => {
      const { component } = createComponent({ groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      component.setVisibility('group');
      component.selectedGroupId.set('g1');
      component.setVisibility('private');
      expect(component.selectedGroupId()).toBeNull();
    }));
  });

  describe('save — create', () => {
    it('calls createAlbum with groupId when visibility is group', fakeAsync(async () => {
      const { component, albumSpy } = createComponent({ groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      component.title.set('Family Pics');
      component.setVisibility('group');
      component.selectedGroupId.set('g1');
      const promise = component.save(); tick(); await promise;
      expect(albumSpy.createAlbum).toHaveBeenCalledWith(
        jasmine.objectContaining({ visibility: 'group', groupId: 'g1' })
      );
    }));

    it('does nothing when title is empty', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      await component.ngOnInit(); tick();
      component.title.set('  ');
      await component.save();
      expect(albumSpy.createAlbum).not.toHaveBeenCalled();
    }));

    it('does nothing when group visibility but no group selected', fakeAsync(async () => {
      const { component, albumSpy } = createComponent({ groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      component.title.set('Test');
      component.setVisibility('group');
      // selectedGroupId remains null
      await component.save();
      expect(albumSpy.createAlbum).not.toHaveBeenCalled();
    }));

    it('passes null groupId for private visibility', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      await component.ngOnInit(); tick();
      component.title.set('Private');
      const promise = component.save(); tick(); await promise;
      expect(albumSpy.createAlbum).toHaveBeenCalledWith(
        jasmine.objectContaining({ groupId: null })
      );
    }));

    it('sets errorMessage on API error', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.createAlbum.and.rejectWith(
        new AlbumApiError({ code: 'FORBIDDEN', message: 'No access.', status: 403 })
      );
      await component.ngOnInit(); tick();
      component.title.set('Test');
      const promise = component.save(); tick(); await promise;
      expect(component.errorMessage()).toBe('No access.');
    }));
  });

  describe('save — edit', () => {
    it('calls updateAlbum with groupId', fakeAsync(async () => {
      const album = makeAlbum({ title: 'Old', visibility: 'private' });
      const { component, albumSpy } = createComponent({ album, groups: [makeGroup()] });
      await component.ngOnInit(); tick();
      component.setVisibility('group');
      component.selectedGroupId.set('g1');
      const promise = component.save(); tick(); await promise;
      expect(albumSpy.updateAlbum).toHaveBeenCalledWith(
        'a1', jasmine.objectContaining({ visibility: 'group', groupId: 'g1' })
      );
    }));
  });
});
