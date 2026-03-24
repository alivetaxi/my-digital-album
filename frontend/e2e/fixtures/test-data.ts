// ─── Auth ─────────────────────────────────────────────────────────────────────
export const TEST_USER = {
  uid: 'test-user-001',
  email: 'e2e@test.example',
  password: 'TestPass1234!',
  displayName: 'E2E Tester',
};

// ─── Albums ───────────────────────────────────────────────────────────────────
const now = new Date().toISOString();

export const ALBUMS = {
  myPrivate: {
    id: 'album-001',
    title: 'My Private Album',
    visibility: 'private',
    myPermission: 'owner',
    mediaCount: 3,
    ownerId: TEST_USER.uid,
    coverMediaId: null,
    coverThumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  myPublic: {
    id: 'album-002',
    title: 'My Public Album',
    visibility: 'public',
    myPermission: 'owner',
    mediaCount: 0,
    ownerId: TEST_USER.uid,
    coverMediaId: null,
    coverThumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
  },
  shared: {
    id: 'album-003',
    title: 'Shared Album',
    visibility: 'private',
    myPermission: 'read',
    mediaCount: 5,
    ownerId: 'other-user-uid',
    coverMediaId: null,
    coverThumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
  },
};

// ─── Media ────────────────────────────────────────────────────────────────────
export const MEDIA_ITEMS = [
  {
    id: 'media-001',
    type: 'photo',
    storagePath: 'media/photo1.jpg',
    thumbnailPath: 'thumbnails/photo1.jpg',
    thumbnailUrl: null,
    originalUrl: null,
    uploaderId: TEST_USER.uid,
    description: 'A sunny day',
    width: 800,
    height: 600,
    duration: null,
    takenAt: now,
    takenPlace: null,
    thumbnailStatus: 'ready',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'media-002',
    type: 'photo',
    storagePath: 'media/photo2.jpg',
    thumbnailPath: 'thumbnails/photo2.jpg',
    thumbnailUrl: null,
    originalUrl: null,
    uploaderId: TEST_USER.uid,
    description: null,
    width: 1200,
    height: 900,
    duration: null,
    takenAt: now,
    takenPlace: null,
    thumbnailStatus: 'ready',
    createdAt: now,
    updatedAt: now,
  },
  {
    id: 'media-003',
    type: 'photo',
    storagePath: 'media/photo3.jpg',
    thumbnailPath: null,
    thumbnailUrl: null,
    originalUrl: null,
    uploaderId: TEST_USER.uid,
    description: null,
    width: 0,
    height: 0,
    duration: null,
    takenAt: null,
    takenPlace: null,
    thumbnailStatus: 'pending',
    createdAt: now,
    updatedAt: now,
  },
];

// ─── Members ──────────────────────────────────────────────────────────────────
export const MEMBERS = [
  {
    email: 'alice@example.com',
    userId: 'alice-uid',
    displayName: 'Alice Smith',
    photoURL: null,
    permission: 'read',
    inviteToken: null,
    addedAt: now,
  },
  {
    email: 'pending@example.com',
    userId: null,
    displayName: null,
    photoURL: null,
    permission: 'read',
    inviteToken: 'invite-token-abc',
    addedAt: now,
  },
];
