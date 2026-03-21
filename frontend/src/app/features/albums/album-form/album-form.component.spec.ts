import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AlbumFormComponent } from './album-form.component';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';
import { Album } from '../../../core/models';

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: 'a1', title: 'Vacation', coverMediaId: null, coverThumbnailUrl: null,
  ownerId: 'uid-1', visibility: 'private', mediaCount: 0,
  createdAt: new Date(), updatedAt: new Date(), ...overrides,
});

function createComponent(options: { album?: Album | null; readonly?: boolean } = {}) {
  const { album = null, readonly = false } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', ['createAlbum', 'updateAlbum']);
  albumSpy.createAlbum.and.resolveTo(makeAlbum({ title: 'New' }));
  albumSpy.updateAlbum.and.resolveTo(makeAlbum({ title: 'Updated' }));

  TestBed.configureTestingModule({
    imports: [AlbumFormComponent],
    providers: [
      { provide: AlbumService, useValue: albumSpy },
    ],
  });

  const fixture = TestBed.createComponent(AlbumFormComponent);
  if (album) fixture.componentRef.setInput('album', album);
  fixture.componentRef.setInput('readonly', readonly);
  return { fixture, component: fixture.componentInstance, albumSpy };
}

describe('AlbumFormComponent', () => {
  describe('initialization', () => {
    it('prefills title and visibility in edit mode', () => {
      const album = makeAlbum({ title: 'Trip', visibility: 'public' });
      const { component } = createComponent({ album });
      component.ngOnInit();
      expect(component.title()).toBe('Trip');
      expect(component.visibility()).toBe('public');
    });

    it('starts with empty title and private visibility in create mode', () => {
      const { component } = createComponent();
      component.ngOnInit();
      expect(component.title()).toBe('');
      expect(component.visibility()).toBe('private');
    });
  });

  describe('setVisibility', () => {
    it('updates visibility signal', () => {
      const { component } = createComponent();
      component.setVisibility('public');
      expect(component.visibility()).toBe('public');
    });
  });

  describe('save — create', () => {
    it('calls createAlbum with title and visibility', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      component.ngOnInit();
      component.title.set('Family Pics');
      component.setVisibility('public');
      const promise = component.save(); tick(); await promise;
      expect(albumSpy.createAlbum).toHaveBeenCalledWith(
        jasmine.objectContaining({ title: 'Family Pics', visibility: 'public' })
      );
    }));

    it('does nothing when title is empty', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      component.ngOnInit();
      component.title.set('  ');
      await component.save();
      expect(albumSpy.createAlbum).not.toHaveBeenCalled();
    }));

    it('does nothing when readonly is true', fakeAsync(async () => {
      const album = makeAlbum();
      const { component, albumSpy } = createComponent({ album, readonly: true });
      component.ngOnInit();
      component.title.set('Test');
      await component.save();
      expect(albumSpy.updateAlbum).not.toHaveBeenCalled();
    }));

    it('sets errorMessage on API error', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      albumSpy.createAlbum.and.rejectWith(
        new AlbumApiError({ code: 'FORBIDDEN', message: 'No access.', status: 403 })
      );
      component.ngOnInit();
      component.title.set('Test');
      const promise = component.save(); tick(); await promise;
      expect(component.errorMessage()).toBe('No access.');
    }));
  });

  describe('save — edit', () => {
    it('calls updateAlbum with updated title', fakeAsync(async () => {
      const album = makeAlbum({ title: 'Old', visibility: 'private' });
      const { component, albumSpy } = createComponent({ album });
      component.ngOnInit();
      component.title.set('New Title');
      const promise = component.save(); tick(); await promise;
      expect(albumSpy.updateAlbum).toHaveBeenCalledWith(
        'a1', jasmine.objectContaining({ title: 'New Title' })
      );
    }));
  });

  describe('cancel', () => {
    it('emits cancelled', () => {
      const { component } = createComponent();
      let emitted = false;
      component.cancelled.subscribe(() => (emitted = true));
      component.cancel();
      expect(emitted).toBeTrue();
    });
  });
});
