export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
}

export type Visibility = 'public' | 'private';
export type ThumbnailStatus = 'pending' | 'ready' | 'failed';
export type MediaType = 'photo' | 'video';
export type Permission = 'read' | 'write';

export interface Album {
  id: string;
  title: string;
  coverMediaId: string | null;
  coverThumbnailUrl: string | null;
  ownerId: string;
  visibility: Visibility;
  mediaCount: number;
  /** Present when the calling user is authenticated and has access. */
  myPermission?: 'owner' | Permission;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlbumMember {
  email: string;
  userId: string | null;
  displayName: string | null;
  photoURL: string | null;
  permission: Permission;
  /** Only present for pending (not-yet-registered) members. */
  inviteToken: string | null;
  addedAt: string;
}

export interface Media {
  id: string;
  type: MediaType;
  storagePath: string;
  thumbnailPath: string | null;
  thumbnailUrl: string | null;
  originalUrl: string | null;
  uploaderId: string;
  description: string | null;
  width: number;
  height: number;
  duration: number | null;
  takenAt: Date | null;
  takenPlace: {
    lat: number;
    lng: number;
    placeName: string | null;
  } | null;
  thumbnailStatus: ThumbnailStatus;
  createdAt: Date;
  updatedAt: Date;
}
