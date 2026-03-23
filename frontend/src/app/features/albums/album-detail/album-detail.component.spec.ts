import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AlbumDetailComponent } from './album-detail.component';
import { AlbumService } from '../../../core/services/album.service';
import { MediaService } from '../../../core/services/media.service';
import { AuthService } from '../../../core/auth/auth.service';
import { UploadComponent } from '../../media/upload/upload.component';
import { AlbumFormComponent } from '../album-form/album-form.component';
import { Album, Media } from '../../../core/models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: 'a1',
  title: 'Vacation',
  coverMediaId: null,
  coverThumbnailUrl: null,
  ownerId: 'uid-owner',
  visibility: 'private',
  mediaCount: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeMedia = (overrides: Partial<Media> = {}): Media => ({
  id: 'm1',
  type: 'photo',
  storagePath: 'media/u/a/m/original.jpg',
  thumbnailPath: 'media/u/a/m/thumbnail.jpg',
  thumbnailUrl: '/api/thumbnail/media/u/a/m/thumbnail.jpg',
  originalUrl: null,
  uploaderId: 'uid-owner',
  description: null,
  width: 800,
  height: 600,
  duration: null,
  takenAt: null,
  takenPlace: null,
  thumbnailStatus: 'ready',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function createComponent(options: {
  albumId?: string;
  album?: Album | null;
  media?: Media[];
  uid?: string | null;
} = {}) {
  const { albumId = 'a1', album = makeAlbum(), media = [makeMedia()], uid = 'uid-owner' } = options;

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', ['getAlbum', 'updateAlbum']);
  albumSpy.getAlbum.and.resolveTo(album ?? makeAlbum());
  albumSpy.updateAlbum.and.resolveTo(makeAlbum({ coverMediaId: 'new-cover' }));

  const mediaSpy = jasmine.createSpyObj<MediaService>('MediaService', [
    'listMedia',
    'watchThumbnailStatus',
    'thumbnailUrl',
  ]);
  mediaSpy.listMedia.and.resolveTo({ items: media, nextCursor: null });
  mediaSpy.watchThumbnailStatus.and.returnValue(() => {}); // no-op unsubscribe fn
  mediaSpy.thumbnailUrl.and.returnValue(null);

  const authStub = { uid: signal(uid) } as unknown as AuthService;

  const activatedRouteMock = {
    snapshot: { paramMap: { get: (k: string) => (k === 'albumId' ? albumId : null) } },
  };

  TestBed.configureTestingModule({
    imports: [AlbumDetailComponent],
    schemas: [NO_ERRORS_SCHEMA],
    providers: [
      provideRouter([]),
      { provide: AlbumService, useValue: albumSpy },
      { provide: MediaService, useValue: mediaSpy },
      { provide: AuthService, useValue: authStub },
      { provide: ActivatedRoute, useValue: activatedRouteMock },
    ],
  });

  // UploadComponent injects MediaService with complex deps; AlbumFormComponent
  // injects GroupService. Remove them — the template is not under test here.
  TestBed.overrideComponent(AlbumDetailComponent, {
    remove: { imports: [UploadComponent, AlbumFormComponent] },
  });

  const fixture = TestBed.createComponent(AlbumDetailComponent);
  return { fixture, component: fixture.componentInstance, albumSpy, mediaSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AlbumDetailComponent', () => {
  describe('ngOnInit', () => {
    it('loads the album and populates the album signal', fakeAsync(async () => {
      const { component } = createComponent();

      await component.ngOnInit();
      tick(100); // flush setTimeout for setupObserver

      expect(component.album()?.id).toBe('a1');
    }));

    it('loads media and populates mediaItems', fakeAsync(async () => {
      const { component } = createComponent({ media: [makeMedia(), makeMedia({ id: 'm2' })] });

      await component.ngOnInit();
      tick(100);

      expect(component.mediaItems().length).toBe(2);
      expect(component.isLoading()).toBeFalse();
    }));

    it('sets loadError when listMedia fails', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      mediaSpy.listMedia.and.rejectWith(new Error('network'));

      await component.ngOnInit();
      tick(100);

      expect(component.loadError()).toBeTrue();
      expect(component.isLoading()).toBeFalse();
    }));
  });

  describe('permission-based computed signals', () => {
    it('isOwner is true when myPermission is owner', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'owner' }) });
      await component.ngOnInit(); tick(100);
      expect(component.isOwner()).toBeTrue();
    }));

    it('isOwner is false when myPermission is write', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'write' }) });
      await component.ngOnInit(); tick(100);
      expect(component.isOwner()).toBeFalse();
    }));

    it('isOwner is false when myPermission is undefined', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum() });
      await component.ngOnInit(); tick(100);
      expect(component.isOwner()).toBeFalse();
    }));

    it('canUpload is true for owner', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'owner' }) });
      await component.ngOnInit(); tick(100);
      expect(component.canUpload()).toBeTrue();
    }));

    it('canUpload is true for write member', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'write' }) });
      await component.ngOnInit(); tick(100);
      expect(component.canUpload()).toBeTrue();
    }));

    it('canUpload is false for read member', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'read' }) });
      await component.ngOnInit(); tick(100);
      expect(component.canUpload()).toBeFalse();
    }));

    it('showEditAlbumButton is true for owner', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'owner' }) });
      await component.ngOnInit(); tick(100);
      expect(component.showEditAlbumButton()).toBeTrue();
    }));

    it('showEditAlbumButton is true for write member', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'write' }) });
      await component.ngOnInit(); tick(100);
      expect(component.showEditAlbumButton()).toBeTrue();
    }));

    it('showEditAlbumButton is false for read member', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'read' }) });
      await component.ngOnInit(); tick(100);
      expect(component.showEditAlbumButton()).toBeFalse();
    }));

    it('albumFormReadonly is false for owner', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'owner' }) });
      await component.ngOnInit(); tick(100);
      expect(component.albumFormReadonly()).toBeFalse();
    }));

    it('albumFormReadonly is true for write member', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'write' }) });
      await component.ngOnInit(); tick(100);
      expect(component.albumFormReadonly()).toBeTrue();
    }));

    it('showManageAccess is true when myPermission is set and album is not public', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'read', visibility: 'private' }) });
      await component.ngOnInit(); tick(100);
      expect(component.showManageAccess()).toBeTrue();
    }));

    it('showManageAccess is false when myPermission is undefined', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum() });
      await component.ngOnInit(); tick(100);
      expect(component.showManageAccess()).toBeFalse();
    }));

    it('showManageAccess is false when album is public', fakeAsync(async () => {
      const { component } = createComponent({ album: makeAlbum({ myPermission: 'owner', visibility: 'public' }) });
      await component.ngOnInit(); tick(100);
      expect(component.showManageAccess()).toBeFalse();
    }));
  });

  describe('onUploadDone', () => {
    it('resets mediaItems and reloads', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent();
      await component.ngOnInit(); tick(100);

      expect(component.mediaItems().length).toBe(1);

      const reloadMedia = [makeMedia({ id: 'new-m' })];
      mediaSpy.listMedia.and.resolveTo({ items: reloadMedia, nextCursor: null });

      component.onUploadDone();
      tick();

      expect(component.mediaItems().length).toBe(1);
      expect(component.mediaItems()[0].id).toBe('new-m');
      expect(component.showUpload()).toBeFalse();
    }));

    it('refreshes album (mediaCount) after upload', fakeAsync(async () => {
      const { component, albumSpy } = createComponent({ album: makeAlbum({ mediaCount: 2 }) });
      await component.ngOnInit(); tick(100);

      const callsBefore = albumSpy.getAlbum.calls.count();
      albumSpy.getAlbum.and.resolveTo(makeAlbum({ mediaCount: 5 }));

      component.onUploadDone();
      tick();

      expect(albumSpy.getAlbum.calls.count()).toBeGreaterThan(callsBefore);
      expect(component.album()?.mediaCount).toBe(5);
    }));
  });

  describe('setCoverMedia', () => {
    it('calls updateAlbum and updates the album signal', fakeAsync(async () => {
      const { component, albumSpy } = createComponent();
      await component.ngOnInit(); tick(100);

      const promise = component.setCoverMedia('new-cover');
      tick();
      await promise;

      expect(albumSpy.updateAlbum).toHaveBeenCalledWith('a1', { coverMediaId: 'new-cover' });
      expect(component.album()?.coverMediaId).toBe('new-cover');
    }));
  });
});

// ---------------------------------------------------------------------------
// What is NOT tested here (intentional):
//
// - watchThumbnailStatus / watchItem: requires mocking Firebase's onSnapshot
//   and getFirestore() — integration-level concern, covered by MediaService tests.
//
// - IntersectionObserver / loadMore via scroll: browser API unavailable in
//   Karma's JSDOM environment. The sentinel viewChild returns undefined in tests,
//   causing setupObserver() to return early, so no observer is created.
// ---------------------------------------------------------------------------
