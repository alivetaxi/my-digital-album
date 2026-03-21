import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { AlbumListComponent } from './album-list.component';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumFormComponent } from '../album-form/album-form.component';
import { Album } from '../../../core/models';

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: 'a1',
  title: 'Vacation',
  coverMediaId: null,
  coverThumbnailUrl: null,
  ownerId: 'uid-1',
  ownerType: 'user',
  groupId: null,
  visibility: 'private',
  mediaCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function createComponent(options: { albums?: Album[] } = {}) {
  const { albums = [] } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', [
    'listAlbums',
    'deleteAlbum',
  ]);
  albumSpy.listAlbums.and.resolveTo({ mine: albums, shared: [], public: [] });
  albumSpy.deleteAlbum.and.resolveTo();

  const authStub = { isAuthenticated: signal(true) } as unknown as AuthService;

  TestBed.configureTestingModule({
    imports: [AlbumListComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [
      provideRouter([]),
      { provide: AlbumService, useValue: albumSpy },
      { provide: AuthService, useValue: authStub },
    ],
  });

  // AlbumFormComponent injects GroupService; remove it so we only test list logic.
  TestBed.overrideComponent(AlbumListComponent, {
    remove: { imports: [AlbumFormComponent] },
  });

  const fixture = TestBed.createComponent(AlbumListComponent);
  return { fixture, component: fixture.componentInstance, albumSpy };
}

describe('AlbumListComponent', () => {
  describe('initialization', () => {
    it('loads albums and populates signals', fakeAsync(async () => {
      const album = makeAlbum();
      const { component } = createComponent({ albums: [album] });

      await component.ngOnInit();
      tick();

      expect(component.myAlbums().length).toBe(1);
      expect(component.myAlbums()[0].id).toBe('a1');
      expect(component.isLoading()).toBeFalse();
      expect(component.loadError()).toBeFalse();
    }));

    it('sets loadError on API failure', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.listAlbums.and.rejectWith(new Error('network'));

      await component.ngOnInit();
      tick();

      expect(component.loadError()).toBeTrue();
      expect(component.isLoading()).toBeFalse();
    }));
  });

  describe('form state', () => {
    it('openCreateForm shows the form and clears editingAlbum', fakeAsync(async () => {
      const { component } = createComponent();
      await component.ngOnInit(); tick();

      component.openCreateForm();

      expect(component.showForm()).toBeTrue();
      expect(component.editingAlbum()).toBeNull();
    }));

    it('openEditForm shows the form with the selected album', fakeAsync(async () => {
      const album = makeAlbum({ title: 'Trip' });
      const { component } = createComponent({ albums: [album] });
      await component.ngOnInit(); tick();

      component.openEditForm(album);

      expect(component.showForm()).toBeTrue();
      expect(component.editingAlbum()?.id).toBe('a1');
    }));

    it('onFormCancelled hides the form and clears editingAlbum', fakeAsync(async () => {
      const album = makeAlbum();
      const { component } = createComponent({ albums: [album] });
      await component.ngOnInit(); tick();
      component.openEditForm(album);

      component.onFormCancelled();

      expect(component.showForm()).toBeFalse();
      expect(component.editingAlbum()).toBeNull();
    }));
  });

  describe('onSaved', () => {
    it('prepends a new album in create mode', fakeAsync(async () => {
      const { component } = createComponent({ albums: [] });
      await component.ngOnInit(); tick();
      component.openCreateForm(); // editingAlbum = null

      const newAlbum = makeAlbum({ id: 'a2', title: 'New' });
      component.onSaved(newAlbum);

      expect(component.myAlbums().length).toBe(1);
      expect(component.myAlbums()[0].id).toBe('a2');
      expect(component.showForm()).toBeFalse();
    }));

    it('replaces the album in edit mode', fakeAsync(async () => {
      const original = makeAlbum({ title: 'Old' });
      const { component } = createComponent({ albums: [original] });
      await component.ngOnInit(); tick();
      component.openEditForm(original);

      const updated = makeAlbum({ title: 'Updated' });
      component.onSaved(updated);

      expect(component.myAlbums()[0].title).toBe('Updated');
      expect(component.showForm()).toBeFalse();
    }));
  });

  describe('deleteAlbum', () => {
    it('removes the album from the list on success', fakeAsync(async () => {
      const album = makeAlbum();
      const { component } = createComponent({ albums: [album] });
      await component.ngOnInit(); tick();
      spyOn(window, 'confirm').and.returnValue(true);

      const promise = component.deleteAlbum(album);
      tick();
      await promise;

      expect(component.myAlbums().length).toBe(0);
    }));

    it('does nothing when the user cancels the confirmation dialog', fakeAsync(async () => {
      const album = makeAlbum();
      const { component, albumSpy } = createComponent({ albums: [album] });
      await component.ngOnInit(); tick();
      spyOn(window, 'confirm').and.returnValue(false);

      await component.deleteAlbum(album);

      expect(albumSpy.deleteAlbum).not.toHaveBeenCalled();
      expect(component.myAlbums().length).toBe(1);
    }));

    it('sets deleteError on API failure', fakeAsync(async () => {
      const album = makeAlbum();
      const { component, albumSpy } = createComponent({ albums: [album] });
      await component.ngOnInit(); tick();
      albumSpy.deleteAlbum.and.rejectWith(
        new AlbumApiError({ code: 'PERMISSION_DENIED', message: 'Denied.', status: 403 })
      );
      spyOn(window, 'confirm').and.returnValue(true);

      const promise = component.deleteAlbum(album);
      tick();
      await promise;

      expect(component.deleteError()).toBe('Denied.');
      expect(component.myAlbums().length).toBe(1);
    }));
  });
});
