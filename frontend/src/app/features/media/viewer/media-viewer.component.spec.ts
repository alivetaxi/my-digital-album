import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { signal } from '@angular/core';
import { MediaViewerComponent } from './media-viewer.component';
import { MediaService } from '../../../core/services/media.service';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';
import { Media, Album } from '../../../core/models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMedia = (overrides: Partial<Media> = {}): Media => ({
  id: 'm1',
  type: 'photo',
  storagePath: 'media/u1/a1/m1/original.jpg',
  thumbnailPath: 'media/u1/a1/m1/thumbnail.jpg',
  thumbnailUrl: '/api/thumbnail/media/u1/a1/m1/thumbnail.jpg',
  originalUrl: null,
  uploaderId: 'uploader-uid',
  description: null,
  width: 800,
  height: 600,
  duration: null,
  takenAt: new Date('2024-06-15T10:30:00Z'),
  takenPlace: null,
  thumbnailStatus: 'ready',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const makeAlbum = (overrides: Partial<Album> = {}): Album => ({
  id: 'a1',
  title: 'My Album',
  coverMediaId: null,
  coverThumbnailUrl: null,
  ownerId: 'owner-uid',
  visibility: 'private',
  mediaCount: 1,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function createComponent(options: {
  albumId?: string;
  mediaId?: string;
  uid?: string | null;
  mediaList?: Media[];
  album?: Album | null;
  navigationState?: { mediaList: Media[]; nextCursor: string | null } | null;
}) {
  const {
    albumId = 'a1',
    mediaId = 'm1',
    uid = 'owner-uid',
    mediaList = [makeMedia()],
    album = makeAlbum(),
    navigationState = null,
  } = options;

  const mediaSpy = jasmine.createSpyObj<MediaService>('MediaService', [
    'listMedia', 'getOriginalUrl', 'updateMedia', 'deleteMedia',
  ]);
  mediaSpy.listMedia.and.resolveTo({ items: mediaList, nextCursor: null });
  mediaSpy.getOriginalUrl.and.resolveTo('https://signed-original');
  mediaSpy.updateMedia.and.resolveTo({ ...mediaList[0], description: 'Updated' });
  mediaSpy.deleteMedia.and.resolveTo(undefined);

  const albumSpy = jasmine.createSpyObj<AlbumService>('AlbumService', ['getAlbum']);
  albumSpy.getAlbum.and.resolveTo(album as Album);

  const authSpy = {
    uid: signal(uid),
    isAuthenticated: signal(uid !== null),
  } as unknown as AuthService;

  const locationSpy = jasmine.createSpyObj<Location>('Location', ['getState']);
  locationSpy.getState.and.returnValue(navigationState);

  TestBed.configureTestingModule({
    imports: [MediaViewerComponent],
    providers: [
      provideRouter([]),
      { provide: MediaService, useValue: mediaSpy },
      { provide: AlbumService, useValue: albumSpy },
      { provide: AuthService, useValue: authSpy },
      { provide: Location, useValue: locationSpy },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { paramMap: { get: (k: string) => k === 'albumId' ? albumId : mediaId } },
        },
      },
    ],
  });

  const fixture = TestBed.createComponent(MediaViewerComponent);
  const component = fixture.componentInstance;
  return { fixture, component, mediaSpy, albumSpy, locationSpy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MediaViewerComponent', () => {
  describe('initialization', () => {
    it('loads media list and sets currentIndex to matching mediaId', fakeAsync(async () => {
      const items = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
      const { component } = createComponent({ mediaId: 'm2', mediaList: items });

      await component.ngOnInit();
      tick(200);

      expect(component.mediaList().length).toBe(2);
      expect(component.currentIndex()).toBe(1);
      expect(component.isLoading()).toBeFalse();
    }));

    it('sets loadError on API failure', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent({});
      mediaSpy.listMedia.and.rejectWith(new Error('Network error'));

      await component.ngOnInit();
      tick();

      expect(component.loadError()).toBeTrue();
      expect(component.isLoading()).toBeFalse();
    }));

    it('defaults to index 0 when mediaId not found', fakeAsync(async () => {
      const { component } = createComponent({ mediaId: 'unknown' });

      await component.ngOnInit();
      tick(200);

      expect(component.currentIndex()).toBe(0);
    }));

    it('finds mediaId on a later page and sets nextCursor from that page', fakeAsync(async () => {
      const page1 = Array.from({ length: 30 }, (_, i) => makeMedia({ id: `p1-${i}` }));
      const page2 = [makeMedia({ id: 'm31' }), makeMedia({ id: 'm32' })];
      const { component, mediaSpy } = createComponent({ mediaId: 'm31' });
      mediaSpy.listMedia.and.callFake((_albumId, _limit, after) =>
        after === 'cursor-1'
          ? Promise.resolve({ items: page2, nextCursor: 'cursor-2' })
          : Promise.resolve({ items: page1, nextCursor: 'cursor-1' })
      );

      await component.ngOnInit();
      tick(200);

      expect(component.mediaList().length).toBe(32);
      expect(component.currentIndex()).toBe(30);
      expect(component.nextCursor()).toBe('cursor-2');
    }));

    it('exhausts pagination and defaults to index 0 when mediaId not found across multiple pages', fakeAsync(async () => {
      const page1 = Array.from({ length: 30 }, (_, i) => makeMedia({ id: `p1-${i}` }));
      const page2 = [makeMedia({ id: 'p2-0' }), makeMedia({ id: 'p2-1' })];
      const { component, mediaSpy } = createComponent({ mediaId: 'unknown' });
      mediaSpy.listMedia.and.callFake((_albumId, _limit, after) =>
        after === 'cursor-1'
          ? Promise.resolve({ items: page2, nextCursor: null })
          : Promise.resolve({ items: page1, nextCursor: 'cursor-1' })
      );

      await component.ngOnInit();
      tick(200);

      expect(component.currentIndex()).toBe(0);
      expect(component.mediaList().length).toBe(32);
      expect(component.nextCursor()).toBeNull();
    }));

    it('stops paginating as soon as the item is found', fakeAsync(async () => {
      const page1 = Array.from({ length: 30 }, (_, i) => makeMedia({ id: `p1-${i}` }));
      const page2 = [makeMedia({ id: 'm31' })];
      const { component, mediaSpy } = createComponent({ mediaId: 'm31' });
      mediaSpy.listMedia.and.callFake((_albumId, _limit, after) =>
        after === 'cursor-1'
          ? Promise.resolve({ items: page2, nextCursor: 'cursor-2' })
          : Promise.resolve({ items: page1, nextCursor: 'cursor-1' })
      );

      await component.ngOnInit();
      tick(200);

      expect(mediaSpy.listMedia.calls.count()).toBe(2);
    }));

    it('stops after a bounded number of pages and falls back to index 0', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent({ mediaId: 'never-found' });
      let call = 0;
      mediaSpy.listMedia.and.callFake(() => {
        call++;
        return Promise.resolve({
          items: [makeMedia({ id: `x-${call}` })],
          nextCursor: `cursor-${call}`,
        });
      });

      await component.ngOnInit();
      tick(200);

      expect(mediaSpy.listMedia.calls.count()).toBeLessThanOrEqual(50);
      expect(component.currentIndex()).toBe(0);
      expect(component.isLoading()).toBeFalse();
    }));

    it('uses passed navigation state and skips fetching media entirely', fakeAsync(async () => {
      const passedList = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' }), makeMedia({ id: 'm3' })];
      const { component, mediaSpy } = createComponent({
        mediaId: 'm3',
        navigationState: { mediaList: passedList, nextCursor: 'passed-cursor' },
      });

      await component.ngOnInit();
      tick(200);

      expect(mediaSpy.listMedia).not.toHaveBeenCalled();
      expect(component.mediaList()).toEqual(passedList);
      expect(component.currentIndex()).toBe(2);
      expect(component.nextCursor()).toBe('passed-cursor');
    }));

    it('falls back to fetching when the passed navigation state does not contain the target id', fakeAsync(async () => {
      const passedList = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
      const fetchedList = [makeMedia({ id: 'm99' })];
      const { component, mediaSpy } = createComponent({
        mediaId: 'm99',
        mediaList: fetchedList,
        navigationState: { mediaList: passedList, nextCursor: null },
      });

      await component.ngOnInit();
      tick(200);

      expect(mediaSpy.listMedia).toHaveBeenCalled();
      expect(component.mediaList()).toEqual(fetchedList);
      expect(component.currentIndex()).toBe(0);
    }));

    it('degrades to a best-effort result when a later page fails after earlier pages succeeded', fakeAsync(async () => {
      const page1 = Array.from({ length: 30 }, (_, i) => makeMedia({ id: `p1-${i}` }));
      const { component, mediaSpy } = createComponent({ mediaId: 'unreachable' });
      mediaSpy.listMedia.and.callFake((_albumId, _limit, after) =>
        after === undefined
          ? Promise.resolve({ items: page1, nextCursor: 'cursor-1' })
          : Promise.reject(new Error('Network error'))
      );

      await component.ngOnInit();
      tick(200);

      expect(component.loadError()).toBeFalse();
      expect(component.mediaList().length).toBe(30);
      expect(component.currentIndex()).toBe(0);
      expect(component.isLoading()).toBeFalse();
    }));

    it('stops paginating when a page returns no new items despite a non-null cursor', fakeAsync(async () => {
      const stuckPage = [makeMedia({ id: 'stuck-1' }), makeMedia({ id: 'stuck-2' })];
      const { component, mediaSpy } = createComponent({ mediaId: 'never-here' });
      mediaSpy.listMedia.and.resolveTo({ items: stuckPage, nextCursor: 'same-cursor' });

      await component.ngOnInit();
      tick(200);

      expect(mediaSpy.listMedia.calls.count()).toBe(2);
      expect(component.mediaList().length).toBe(2);
      expect(component.currentIndex()).toBe(0);
    }));
  });

  describe('navigation', () => {
    it('goTo advances to next index', fakeAsync(async () => {
      const items = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
      const { component } = createComponent({ mediaList: items });
      await component.ngOnInit();
      tick(200);

      component.goTo(1);

      expect(component.currentIndex()).toBe(1);
    }));

    it('goTo bounces back at left boundary', fakeAsync(async () => {
      const { component } = createComponent({});
      await component.ngOnInit();
      tick(200);

      component.goTo(-1);
      expect(component.dragOffset()).not.toBe(0);

      tick(300);
      expect(component.dragOffset()).toBe(0);
    }));

    it('goTo bounces back at right boundary when no more pages', fakeAsync(async () => {
      const { component } = createComponent({});
      await component.ngOnInit();
      tick(200);

      component.goTo(99);
      expect(component.dragOffset()).not.toBe(0);

      tick(300);
      expect(component.dragOffset()).toBe(0);
    }));

    it('resets edit state on navigation', fakeAsync(async () => {
      const items = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
      const { component } = createComponent({ mediaList: items });
      await component.ngOnInit();
      tick(200);

      component.startEdit();
      expect(component.isEditing()).toBeTrue();

      component.goTo(1);
      expect(component.isEditing()).toBeFalse();
    }));
  });

  describe('canEdit', () => {
    it('is true when user is the album owner', fakeAsync(async () => {
      const album = makeAlbum({ ownerId: 'owner-uid' });
      const media = makeMedia({ uploaderId: 'someone-else' });
      const { component } = createComponent({ uid: 'owner-uid', album, mediaList: [media] });

      await component.ngOnInit();
      tick(200);

      expect(component.canEdit()).toBeTrue();
    }));

    it('is true when user is the uploader', fakeAsync(async () => {
      const album = makeAlbum({ ownerId: 'other-owner' });
      const media = makeMedia({ uploaderId: 'uploader-uid' });
      const { component } = createComponent({ uid: 'uploader-uid', album, mediaList: [media] });

      await component.ngOnInit();
      tick(200);

      expect(component.canEdit()).toBeTrue();
    }));

    it('is false for a third-party user', fakeAsync(async () => {
      const album = makeAlbum({ ownerId: 'owner-uid' });
      const media = makeMedia({ uploaderId: 'uploader-uid' });
      const { component } = createComponent({ uid: 'stranger', album, mediaList: [media] });

      await component.ngOnInit();
      tick(200);

      expect(component.canEdit()).toBeFalse();
    }));

    it('is false when unauthenticated', fakeAsync(async () => {
      const { component } = createComponent({ uid: null });

      await component.ngOnInit();
      tick(200);

      expect(component.canEdit()).toBeFalse();
    }));
  });

  describe('edit description', () => {
    it('startEdit populates editValue from current description', fakeAsync(async () => {
      const media = makeMedia({ description: 'A sunny day' });
      const { component } = createComponent({ mediaList: [media] });
      await component.ngOnInit();
      tick(200);

      component.startEdit();

      expect(component.isEditing()).toBeTrue();
      expect(component.editValue()).toBe('A sunny day');
    }));

    it('cancelEdit closes the form', fakeAsync(async () => {
      const { component } = createComponent({});
      await component.ngOnInit();
      tick(200);
      component.startEdit();

      component.cancelEdit();

      expect(component.isEditing()).toBeFalse();
    }));

    it('saveDescription calls updateMedia and updates list', fakeAsync(async () => {
      const media = makeMedia({ id: 'm1', description: null });
      const { component, mediaSpy } = createComponent({ mediaList: [media] });
      mediaSpy.updateMedia.and.resolveTo({ ...media, description: 'New caption' });
      await component.ngOnInit();
      tick(200);

      component.startEdit();
      component.editValue.set('New caption');
      const savePromise = component.saveDescription();
      tick();
      await savePromise;

      expect(mediaSpy.updateMedia).toHaveBeenCalledWith('a1', 'm1', { description: 'New caption' });
      expect(component.mediaList()[0].description).toBe('New caption');
      expect(component.isEditing()).toBeFalse();
    }));

    it('saveDescription sets saveError on API failure', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent({});
      mediaSpy.updateMedia.and.rejectWith(
        new AlbumApiError({ code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 })
      );
      await component.ngOnInit();
      tick(200);

      component.startEdit();
      component.editValue.set('X');
      const savePromise = component.saveDescription();
      tick();
      await savePromise;

      expect(component.saveError()).toBeTruthy();
      expect(component.isEditing()).toBeTrue(); // stays open on error
    }));
  });

  describe('delete media', () => {
    beforeEach(() => spyOn(window, 'confirm').and.returnValue(true));

    it('removes media from list and adjusts index', fakeAsync(async () => {
      const items = [makeMedia({ id: 'm1' }), makeMedia({ id: 'm2' })];
      const { component, mediaSpy } = createComponent({ mediaList: items });
      mediaSpy.deleteMedia.and.resolveTo(undefined);
      await component.ngOnInit();
      tick(200);

      const deletePromise = component.deleteMedia();
      tick();
      await deletePromise;

      expect(component.mediaList().length).toBe(1);
      expect(component.mediaList()[0].id).toBe('m2');
    }));

    it('navigates back to album when last item deleted', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent({ mediaList: [makeMedia()] });
      const router = TestBed.inject(Router);
      const navSpy = spyOn(router, 'navigate');
      mediaSpy.deleteMedia.and.resolveTo(undefined);
      await component.ngOnInit();
      tick(200);

      const deletePromise = component.deleteMedia();
      tick();
      await deletePromise;

      expect(navSpy).toHaveBeenCalledWith(['/albums', 'a1']);
    }));

    it('sets deleteError when backend rejects (e.g. MEDIA_IS_COVER)', fakeAsync(async () => {
      const { component, mediaSpy } = createComponent({});
      mediaSpy.deleteMedia.and.rejectWith(
        new AlbumApiError({ code: 'MEDIA_IS_COVER', message: 'This item is the album cover. Change the cover before deleting it.', status: 400 })
      );
      await component.ngOnInit();
      tick(200);

      const deletePromise = component.deleteMedia();
      tick();
      await deletePromise;

      expect(component.deleteError()).toContain('album cover');
      expect(component.mediaList().length).toBe(1); // unchanged
    }));

    it('does nothing when confirm is cancelled', fakeAsync(async () => {
      (window.confirm as jasmine.Spy).and.returnValue(false);
      const { component, mediaSpy } = createComponent({});
      await component.ngOnInit();
      tick(200);

      await component.deleteMedia();

      expect(mediaSpy.deleteMedia).not.toHaveBeenCalled();
    }));
  });

  describe('formatDate', () => {
    it('returns empty string for null', () => {
      const { component } = createComponent({});
      expect(component.formatDate(null)).toBe('');
    });

    it('formats date as Month Day, Year', () => {
      const { component } = createComponent({});
      const result = component.formatDate(new Date('2024-06-15T00:00:00Z'));
      expect(result).toMatch(/Jun/);
      expect(result).toMatch(/2024/);
    });
  });
});
