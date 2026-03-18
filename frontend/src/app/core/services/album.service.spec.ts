import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AlbumService, AlbumApiError } from './album.service';
import { AuthService } from '../auth/auth.service';

const MOCK_ALBUM = {
  id: 'a1',
  title: 'Trip',
  coverMediaId: null,
  coverThumbnailUrl: null,
  ownerId: 'u1',
  ownerType: 'user' as const,
  groupId: null,
  visibility: 'private' as const,
  mediaCount: 0,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('AlbumService', () => {
  let service: AlbumService;
  let http: HttpTestingController;

  beforeEach(() => {
    const authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['getIdToken']);
    authSpy.getIdToken.and.resolveTo('test-token');

    TestBed.configureTestingModule({
      providers: [
        AlbumService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authSpy },
      ],
    });

    service = TestBed.inject(AlbumService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('listAlbums', () => {
    it('returns mine/shared/public lists', async () => {
      const response = { mine: [MOCK_ALBUM], shared: [], public: [] };
      const promise = service.listAlbums();

      await Promise.resolve(); // let authHeaders resolve
      http.expectOne('/api/albums').flush(response);

      const result = await promise;
      expect(result.mine.length).toBe(1);
      expect(result.mine[0].id).toBe('a1');
    });

    it('throws AlbumApiError on 403', async () => {
      const promise = service.listAlbums();
      await Promise.resolve();
      http.expectOne('/api/albums').flush(
        { error: { code: 'FORBIDDEN', message: 'Forbidden', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Forbidden' })
      );
    });
  });

  describe('createAlbum', () => {
    it('POSTs and returns the created album', async () => {
      const promise = service.createAlbum({ title: 'New', visibility: 'private' });
      await Promise.resolve();
      http.expectOne('/api/albums').flush(MOCK_ALBUM);

      const result = await promise;
      expect(result.id).toBe('a1');
    });

    it('throws AlbumApiError on 400', async () => {
      const promise = service.createAlbum({ title: '', visibility: 'private' });
      await Promise.resolve();
      http.expectOne('/api/albums').flush(
        { error: { code: 'VALIDATION_ERROR', message: 'Title is required.', status: 400 } },
        { status: 400, statusText: 'Bad Request' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Title is required.' })
      );
    });
  });

  describe('updateAlbum', () => {
    it('PATCHes the album and returns updated data', async () => {
      const updated = { ...MOCK_ALBUM, title: 'Updated' };
      const promise = service.updateAlbum('a1', { title: 'Updated' });
      await Promise.resolve();
      http.expectOne('/api/albums/a1').flush(updated);

      const result = await promise;
      expect(result.title).toBe('Updated');
    });

    it('throws AlbumApiError on 403', async () => {
      const promise = service.updateAlbum('a1', { title: 'X' });
      await Promise.resolve();
      http.expectOne('/api/albums/a1').flush(
        { error: { code: 'PERMISSION_DENIED', message: 'Permission denied.', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Permission denied.' })
      );
    });
  });

  describe('deleteAlbum', () => {
    it('sends DELETE request', async () => {
      const promise = service.deleteAlbum('a1');
      await Promise.resolve();
      http.expectOne('/api/albums/a1').flush(null);

      await expectAsync(promise).toBeResolved();
    });

    it('throws AlbumApiError on 409', async () => {
      const promise = service.deleteAlbum('a1');
      await Promise.resolve();
      http.expectOne('/api/albums/a1').flush(
        { error: { code: 'ALBUM_NOT_EMPTY', message: 'Album has 3 media item(s).', status: 409 } },
        { status: 409, statusText: 'Conflict' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Album has 3 media item(s).' })
      );
    });
  });

  describe('getAlbum', () => {
    it('fetches album by id', async () => {
      const promise = service.getAlbum('a1');
      await Promise.resolve();
      http.expectOne('/api/albums/a1').flush(MOCK_ALBUM);

      const result = await promise;
      expect(result.id).toBe('a1');
    });

    it('throws AlbumApiError on 404', async () => {
      const promise = service.getAlbum('missing');
      await Promise.resolve();
      http.expectOne('/api/albums/missing').flush(
        { error: { code: 'ALBUM_NOT_FOUND', message: 'Album not found.', status: 404 } },
        { status: 404, statusText: 'Not Found' }
      );

      await expectAsync(promise).toBeRejectedWith(
        jasmine.objectContaining({ message: 'Album not found.' })
      );
    });
  });
});
