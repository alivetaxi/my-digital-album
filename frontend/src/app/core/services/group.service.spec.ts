import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { signal } from '@angular/core';
import { GroupService } from './group.service';
import { AuthService } from '../auth/auth.service';
import { AlbumApiError } from './album.service';

/** Flush the 2-tick async chain inside authHeaders(): getIdToken() → authHeaders() resolve. */
const flushAuth = () => Promise.resolve().then(() => Promise.resolve());

const makeRawGroup = (overrides = {}) => ({
  id: 'g1',
  name: 'Test Group',
  ownerId: 'uid-1',
  memberIds: ['uid-1'],
  inviteToken: 'tok-abc',
  inviteTokenExpiresAt: '2026-01-01T12:00:00.000Z',
  createdAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

function setup() {
  const authSpy = jasmine.createSpyObj<AuthService>('AuthService', ['getIdToken']);
  authSpy.getIdToken.and.resolveTo('test-token');

  TestBed.configureTestingModule({
    providers: [
      GroupService,
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: authSpy },
    ],
  });
  return {
    service: TestBed.inject(GroupService),
    http: TestBed.inject(HttpTestingController),
  };
}

describe('GroupService', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('listMyGroups', () => {
    it('returns deserialized groups', async () => {
      const { service, http } = setup();
      const promise = service.listMyGroups();
      await flushAuth();
      http.expectOne('/api/users/me/groups').flush([makeRawGroup()]);
      const groups = await promise;
      expect(groups.length).toBe(1);
      expect(groups[0].id).toBe('g1');
      expect(groups[0].inviteTokenExpiresAt).toBeInstanceOf(Date);
    });
  });

  describe('createGroup', () => {
    it('posts name and returns group', async () => {
      const { service, http } = setup();
      const promise = service.createGroup('Family');
      await flushAuth();
      const req = http.expectOne('/api/groups');
      expect(req.request.body).toEqual({ name: 'Family' });
      req.flush(makeRawGroup({ name: 'Family' }));
      const group = await promise;
      expect(group.name).toBe('Family');
    });

    it('throws AlbumApiError on 403', async () => {
      const { service, http } = setup();
      const promise = service.createGroup('X');
      await flushAuth();
      http.expectOne('/api/groups').flush(
        { error: { code: 'PERMISSION_DENIED', message: 'Denied.', status: 403 } },
        { status: 403, statusText: 'Forbidden' }
      );
      await expectAsync(promise).toBeRejectedWithError(AlbumApiError as any);
    });
  });

  describe('joinGroup', () => {
    it('posts inviteToken and returns group', async () => {
      const { service, http } = setup();
      const promise = service.joinGroup('my-token');
      await flushAuth();
      const req = http.expectOne('/api/groups/join');
      expect(req.request.body).toEqual({ inviteToken: 'my-token' });
      req.flush(makeRawGroup());
      const group = await promise;
      expect(group.id).toBe('g1');
    });

    it('throws AlbumApiError on expired token', async () => {
      const { service, http } = setup();
      const promise = service.joinGroup('old-token');
      await flushAuth();
      http.expectOne('/api/groups/join').flush(
        { error: { code: 'INVITE_TOKEN_EXPIRED', message: 'Expired.', status: 400 } },
        { status: 400, statusText: 'Bad Request' }
      );
      await expectAsync(promise).toBeRejectedWithError(AlbumApiError as any);
    });
  });

  describe('leaveGroup', () => {
    it('posts to leave endpoint', async () => {
      const { service, http } = setup();
      const promise = service.leaveGroup('g1');
      await flushAuth();
      http.expectOne('/api/groups/g1/leave').flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });
  });

  describe('regenerateInvite', () => {
    it('returns new token and expiry', async () => {
      const { service, http } = setup();
      const promise = service.regenerateInvite('g1');
      await flushAuth();
      http.expectOne('/api/groups/g1/regenerate-invite').flush({
        inviteToken: 'new-tok',
        inviteTokenExpiresAt: '2026-06-01T00:00:00.000Z',
      });
      const result = await promise;
      expect(result.inviteToken).toBe('new-tok');
    });
  });
});
