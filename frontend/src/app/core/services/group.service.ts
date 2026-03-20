import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Group } from '../models';
import { AuthService } from '../auth/auth.service';
import { AlbumApiError } from './album.service';

export interface GroupMember {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface RegenerateInviteResponse {
  inviteToken: string;
  inviteTokenExpiresAt: string;
}

@Injectable({ providedIn: 'root' })
export class GroupService {
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
      throw new AlbumApiError(err.error.error);
    }
    throw err;
  }

  async listMyGroups(): Promise<Group[]> {
    const headers = await this.authHeaders();
    try {
      const raw = await firstValueFrom(
        this.http.get<any[]>('/api/users/me/groups', { headers })
      );
      return raw.map(this._deserializeGroup);
    } catch (err) {
      return this.handleError(err);
    }
  }

  async createGroup(name: string): Promise<Group> {
    const headers = await this.authHeaders();
    try {
      const raw = await firstValueFrom(
        this.http.post<any>('/api/groups', { name }, { headers })
      );
      return this._deserializeGroup(raw);
    } catch (err) {
      return this.handleError(err);
    }
  }

  async getGroup(groupId: string): Promise<Group> {
    const headers = await this.authHeaders();
    try {
      const raw = await firstValueFrom(
        this.http.get<any>(`/api/groups/${groupId}`, { headers })
      );
      return this._deserializeGroup(raw);
    } catch (err) {
      return this.handleError(err);
    }
  }

  async listMembers(groupId: string): Promise<GroupMember[]> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.get<GroupMember[]>(`/api/groups/${groupId}/members`, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async joinGroup(inviteToken: string): Promise<Group> {
    const headers = await this.authHeaders();
    try {
      const raw = await firstValueFrom(
        this.http.post<any>('/api/groups/join', { inviteToken }, { headers })
      );
      return this._deserializeGroup(raw);
    } catch (err) {
      return this.handleError(err);
    }
  }

  async leaveGroup(groupId: string): Promise<void> {
    const headers = await this.authHeaders();
    try {
      await firstValueFrom(
        this.http.post<void>(`/api/groups/${groupId}/leave`, {}, { headers })
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  async regenerateInvite(groupId: string): Promise<RegenerateInviteResponse> {
    const headers = await this.authHeaders();
    try {
      return await firstValueFrom(
        this.http.post<RegenerateInviteResponse>(
          `/api/groups/${groupId}/regenerate-invite`, {}, { headers }
        )
      );
    } catch (err) {
      return this.handleError(err);
    }
  }

  private _deserializeGroup(raw: any): Group {
    return {
      id: raw.id,
      name: raw.name,
      ownerId: raw.ownerId,
      memberIds: raw.memberIds ?? [],
      inviteToken: raw.inviteToken,
      inviteTokenExpiresAt: new Date(raw.inviteTokenExpiresAt),
      createdAt: new Date(raw.createdAt),
    };
  }
}
