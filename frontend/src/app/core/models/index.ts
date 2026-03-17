export interface User {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  groupIds: string[];
}

export type Visibility = 'public' | 'group' | 'private';
export type ThumbnailStatus = 'pending' | 'ready' | 'failed';
export type MediaType = 'photo' | 'video';

export interface Album {
  id: string;
  title: string;
  coverMediaId: string | null;
  coverThumbnailUrl: string | null;
  ownerId: string;
  ownerType: 'user' | 'group';
  groupId: string | null;
  visibility: Visibility;
  mediaCount: number;
  createdAt: Date;
  updatedAt: Date;
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

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  memberIds: string[];
  inviteToken: string;
  inviteTokenExpiresAt: Date;
  createdAt: Date;
}
