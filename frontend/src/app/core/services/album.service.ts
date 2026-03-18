import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Album, Visibility } from '../models';
import { AuthService } from '../auth/auth.service';

export interface AlbumListResponse {
  mine: Album[];
  shared: Album[];
  public: Album[];
}

export interface ApiError {
  code: string;
  message: string;
  status: number;
}

export class AlbumApiError extends Error {
  constructor(public readonly api: ApiError) {
    super(api.message);
  }
}

@Injectable({ providedIn: 'root' })
export class AlbumService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private async authHeaders(): Promise<HttpHeaders> {
    const token = await this.auth.getIdToken();
    return token
      ? new HttpHeaders({ Authorization: `Bearer ${token}` })
      : new HttpHeaders();
  }

  private handleError(err: unknown): never {
    if (err instanceof HttpErrorResponse && err.error?.error) {
      throw new AlbumApiError(err.error.error as ApiError);
    }
    throw err;
  }

  async listAlbums(): Promise<AlbumListResponse> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.get<AlbumListResponse>('/api/albums', { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getAlbum(albumId: string): Promise<Album> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.get<Album>(`/api/albums/${albumId}`, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async createAlbum(data: {
    title: string;
    visibility: Visibility;
    ownerType?: 'user' | 'group';
    groupId?: string | null;
  }): Promise<Album> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.post<Album>('/api/albums', data, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async updateAlbum(
    albumId: string,
    data: Partial<{
      title: string;
      coverMediaId: string | null;
      visibility: Visibility;
      groupId: string | null;
    }>
  ): Promise<Album> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.patch<Album>(`/api/albums/${albumId}`, data, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async deleteAlbum(albumId: string): Promise<void> {
    const headers = await this.authHeaders();
    try {
      await firstValueFrom(
        this.http.delete(`/api/albums/${albumId}`, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }
}
