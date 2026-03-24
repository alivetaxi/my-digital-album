import { Album, Media, User } from '../models';

export const MOCK_CURRENT_USER: User = {
  uid: 'user-001',
  displayName: 'Alice Chen',
  email: 'alice@example.com',
  photoURL: 'https://i.pravatar.cc/150?u=alice',
};

function picUrl(seed: string, w = 400, h = 300): string {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

export const MOCK_ALBUMS: Album[] = [
  // My Albums
  {
    id: 'album-001',
    title: 'Summer Vacation 2025',
    coverMediaId: 'media-001',
    coverThumbnailUrl: picUrl('summer2025', 400, 300),
    ownerId: 'user-001',
    visibility: 'private',
    mediaCount: 24,
    createdAt: new Date('2025-07-10'),
    updatedAt: new Date('2025-07-20'),
  },
  {
    id: 'album-002',
    title: 'Kyoto Spring 2025',
    coverMediaId: 'media-010',
    coverThumbnailUrl: picUrl('kyoto2025', 400, 300),
    ownerId: 'user-001',
    visibility: 'public',
    mediaCount: 38,
    createdAt: new Date('2025-04-01'),
    updatedAt: new Date('2025-04-15'),
  },
  {
    id: 'album-003',
    title: 'Birthday Party',
    coverMediaId: null,
    coverThumbnailUrl: null,
    ownerId: 'user-001',
    visibility: 'private',
    mediaCount: 12,
    createdAt: new Date('2025-12-25'),
    updatedAt: new Date('2025-12-26'),
  },
  // Shared with Me
  {
    id: 'album-004',
    title: 'Family Reunion 2025',
    coverMediaId: 'media-020',
    coverThumbnailUrl: picUrl('family2025', 400, 300),
    ownerId: 'user-002',
    visibility: 'private',
    mediaCount: 55,
    createdAt: new Date('2025-08-15'),
    updatedAt: new Date('2025-08-20'),
  },
  {
    id: 'album-005',
    title: 'Taiwan Road Trip',
    coverMediaId: 'media-030',
    coverThumbnailUrl: picUrl('taiwan-trip', 400, 300),
    ownerId: 'user-004',
    visibility: 'private',
    mediaCount: 18,
    createdAt: new Date('2026-01-10'),
    updatedAt: new Date('2026-01-15'),
  },
  // Public Albums
  {
    id: 'album-006',
    title: 'Tokyo Street Photography',
    coverMediaId: 'media-040',
    coverThumbnailUrl: picUrl('tokyo-street', 400, 300),
    ownerId: 'user-007',
    visibility: 'public',
    mediaCount: 89,
    createdAt: new Date('2025-11-01'),
    updatedAt: new Date('2025-11-30'),
  },
  {
    id: 'album-007',
    title: 'Sunset Collection',
    coverMediaId: 'media-050',
    coverThumbnailUrl: picUrl('sunset-coll', 400, 300),
    ownerId: 'user-008',
    visibility: 'public',
    mediaCount: 45,
    createdAt: new Date('2025-09-01'),
    updatedAt: new Date('2025-09-30'),
  },
  {
    id: 'album-008',
    title: 'Mountain Hikes',
    coverMediaId: 'media-060',
    coverThumbnailUrl: picUrl('mountain-hike', 400, 300),
    ownerId: 'user-009',
    visibility: 'public',
    mediaCount: 33,
    createdAt: new Date('2025-10-01'),
    updatedAt: new Date('2025-10-20'),
  },
];

function generateMockMedia(albumId: string, count: number): Media[] {
  const seeds = [
    'forest', 'beach', 'city', 'mountain', 'river', 'sunset', 'flower',
    'building', 'street', 'portrait', 'food', 'animal', 'abstract', 'night',
    'sky', 'ocean', 'desert', 'lake', 'bridge', 'park', 'cafe', 'market',
    'temple', 'festival', 'snow', 'rain', 'fog', 'rainbow', 'waterfall', 'field',
  ];
  const items: Media[] = [];
  for (let i = 0; i < count; i++) {
    const seed = seeds[i % seeds.length] + i;
    const isVideo = i % 7 === 3;
    items.push({
      id: `${albumId}-media-${i}`,
      type: isVideo ? 'video' : 'photo',
      storagePath: `media/user-001/${albumId}/item-${i}/original.jpg`,
      thumbnailPath: `media/user-001/${albumId}/item-${i}/thumbnail.jpg`,
      thumbnailUrl: picUrl(seed, 200, 200),
      originalUrl: picUrl(seed, 1080, 1080),
      uploaderId: 'user-001',
      description: i % 5 === 0 ? `A wonderful shot at location ${i}` : null,
      width: 1080,
      height: 1080,
      duration: isVideo ? 30 + i : null,
      takenAt: new Date(2025, 6, 1 + (i % 28)),
      takenPlace: i % 3 === 0 ? { lat: 35.6762 + i * 0.01, lng: 139.6503 + i * 0.01, placeName: `Place ${i}` } : null,
      thumbnailStatus: i === 2 ? 'pending' : i === 5 ? 'failed' : 'ready',
      createdAt: new Date(2025, 6, 1 + i),
      updatedAt: new Date(2025, 6, 1 + i),
    });
  }
  return items;
}

// Pre-generate media for album-001 (30 items for first page)
export const MOCK_MEDIA_PAGE1: Media[] = generateMockMedia('album-001', 30);
export const MOCK_MEDIA_PAGE2: Media[] = generateMockMedia('album-001-p2', 24);

export function getMockMediaForAlbum(albumId: string, page = 1): { items: Media[]; nextCursor: string | null } {
  if (page === 1) {
    return { items: MOCK_MEDIA_PAGE1, nextCursor: 'cursor-page-2' };
  }
  return { items: MOCK_MEDIA_PAGE2, nextCursor: null };
}
