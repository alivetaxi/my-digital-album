import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Album, AlbumMember, Permission, Visibility } from '../models';
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

  // ---------------------------------------------------------------------------
  // Album CRUD
  // ---------------------------------------------------------------------------

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

  async createAlbum(data: { title: string; visibility: Visibility }): Promise<Album> {
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
    data: Partial<{ title: string; coverMediaId: string | null; visibility: Visibility }>
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

  // ---------------------------------------------------------------------------
  // Member management
  // ---------------------------------------------------------------------------

  async listMembers(albumId: string): Promise<AlbumMember[]> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.get<AlbumMember[]>(`/api/albums/${albumId}/members`, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async addMember(
    albumId: string,
    email: string,
    permission: Permission
  ): Promise<AlbumMember> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.post<AlbumMember>(
          `/api/albums/${albumId}/members`,
          { email, permission },
          { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async updateMemberPermission(
    albumId: string,
    email: string,
    permission: Permission
  ): Promise<AlbumMember> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.patch<AlbumMember>(
          `/api/albums/${albumId}/members/${encodeURIComponent(email)}`,
          { permission },
          { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async removeMember(albumId: string, email: string): Promise<void> {
    const headers = await this.authHeaders();
    try {
      await firstValueFrom(
        this.http.delete(
          `/api/albums/${albumId}/members/${encodeURIComponent(email)}`,
          { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async acceptInvite(albumId: string, token: string): Promise<Album> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.post<Album>(
          `/api/albums/${albumId}/accept-invite`,
          { token },
          { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }
  }
}
