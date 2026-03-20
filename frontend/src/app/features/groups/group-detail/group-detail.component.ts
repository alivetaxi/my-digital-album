import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Group } from '../../../core/models';
import { GroupMember, GroupService } from '../../../core/services/group.service';
import { AlbumApiError } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './group-detail.component.html',
  styleUrl: './group-detail.component.scss',
})
export class GroupDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly groupService = inject(GroupService);
  private readonly auth = inject(AuthService);

  readonly groupId = signal('');
  readonly group = signal<Group | null>(null);
  readonly members = signal<GroupMember[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);

  readonly isOwner = computed(() => {
    const uid = this.auth.uid();
    const g = this.group();
    return !!uid && !!g && g.ownerId === uid;
  });

  readonly isCurrentUser = (uid: string) => this.auth.uid() === uid;

  // Invite link
  readonly inviteToken = signal('');
  readonly inviteCopied = signal(false);
  readonly isRegenerating = signal(false);
  readonly regenerateError = signal<string | null>(null);

  // Leave
  readonly isLeaving = signal(false);
  readonly leaveError = signal<string | null>(null);

  async ngOnInit() {
    this.groupId.set(this.route.snapshot.paramMap.get('groupId') ?? '');
    try {
      const [group, members] = await Promise.all([
        this.groupService.getGroup(this.groupId()),
        this.groupService.listMembers(this.groupId()),
      ]);
      this.group.set(group);
      this.inviteToken.set(group.inviteToken);
      this.members.set(members);
    } catch {
      this.loadError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  get inviteUrl(): string {
    return `${window.location.origin}/join?token=${this.inviteToken()}`;
  }

  async copyInviteLink() {
    try {
      await navigator.clipboard.writeText(this.inviteUrl);
      this.inviteCopied.set(true);
      setTimeout(() => this.inviteCopied.set(false), 2000);
    } catch {
      // Clipboard not available — show the URL instead (handled in template)
    }
  }

  async regenerateInvite() {
    this.isRegenerating.set(true);
    this.regenerateError.set(null);
    try {
      const result = await this.groupService.regenerateInvite(this.groupId());
      this.inviteToken.set(result.inviteToken);
      this.inviteCopied.set(false);
    } catch (err) {
      this.regenerateError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to regenerate link.'
      );
    } finally {
      this.isRegenerating.set(false);
    }
  }

  async leaveGroup() {
    if (!confirm('Leave this group? You will need a new invite link to rejoin.')) return;
    this.isLeaving.set(true);
    this.leaveError.set(null);
    try {
      await this.groupService.leaveGroup(this.groupId());
      this.router.navigate(['/groups']);
    } catch (err) {
      this.leaveError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to leave group.'
      );
      this.isLeaving.set(false);
    }
  }

  memberInitial(member: GroupMember): string {
    if (member.displayName) return member.displayName.charAt(0).toUpperCase();
    if (member.email) return member.email.charAt(0).toUpperCase();
    return '?';
  }

  memberLabel(member: GroupMember): string {
    return member.displayName || member.email || member.uid;
  }
}
