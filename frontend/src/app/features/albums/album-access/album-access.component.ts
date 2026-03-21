import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlbumMember, Permission } from '../../../core/models';
import { AlbumService, AlbumApiError } from '../../../core/services/album.service';

@Component({
  selector: 'app-album-access',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './album-access.component.html',
  styleUrl: './album-access.component.scss',
})
export class AlbumAccessComponent implements OnInit {
  readonly albumId = input.required<string>();
  readonly isOwner = input(false);

  readonly closed = output<void>();

  private readonly albumService = inject(AlbumService);

  readonly members = signal<AlbumMember[]>([]);
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Add member form
  readonly newEmail = signal('');
  readonly newPermission = signal<Permission>('read');
  readonly isAdding = signal(false);
  readonly addError = signal<string | null>(null);

  // Per-member action state
  readonly savingEmail = signal<string | null>(null);
  readonly removingEmail = signal<string | null>(null);

  async ngOnInit() {
    await this.loadMembers();
  }

  private async loadMembers() {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    try {
      const members = await this.albumService.listMembers(this.albumId());
      this.members.set(members);
    } catch {
      this.errorMessage.set('Failed to load members.');
    } finally {
      this.isLoading.set(false);
    }
  }

  async addMember() {
    const email = this.newEmail().trim();
    if (!email) return;
    this.isAdding.set(true);
    this.addError.set(null);
    try {
      const member = await this.albumService.addMember(this.albumId(), email, this.newPermission());
      this.members.update(list => [...list, member]);
      this.newEmail.set('');
      this.newPermission.set('read');
    } catch (err) {
      this.addError.set(err instanceof AlbumApiError ? err.message : 'Failed to add member.');
    } finally {
      this.isAdding.set(false);
    }
  }

  async changePermission(email: string, permission: Permission) {
    this.savingEmail.set(email);
    try {
      const updated = await this.albumService.updateMemberPermission(this.albumId(), email, permission);
      this.members.update(list => list.map(m => m.email === email ? updated : m));
    } catch {
      // revert handled by signal not changing
    } finally {
      this.savingEmail.set(null);
    }
  }

  async removeMember(email: string) {
    this.removingEmail.set(email);
    try {
      await this.albumService.removeMember(this.albumId(), email);
      this.members.update(list => list.filter(m => m.email !== email));
    } catch {
      // ignore
    } finally {
      this.removingEmail.set(null);
    }
  }

  copyInviteLink(member: AlbumMember) {
    if (!member.inviteToken) return;
    const url = `${location.origin}/invite?albumId=${this.albumId()}&token=${member.inviteToken}`;
    navigator.clipboard.writeText(url);
  }

  close() {
    this.closed.emit();
  }
}
