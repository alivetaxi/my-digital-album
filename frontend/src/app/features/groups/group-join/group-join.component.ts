import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { GroupService } from '../../../core/services/group.service';
import { AuthService } from '../../../core/auth/auth.service';
import { AlbumApiError } from '../../../core/services/album.service';

@Component({
  selector: 'app-group-join',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './group-join.component.html',
  styleUrl: './group-join.component.scss',
})
export class GroupJoinComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly groupService = inject(GroupService);
  private readonly auth = inject(AuthService);

  readonly token = signal('');
  readonly isJoining = signal(false);
  readonly joinError = signal<string | null>(null);
  readonly joined = signal(false);
  readonly joinedGroupId = signal('');
  readonly joinedGroupName = signal('');

  readonly isAuthenticated = this.auth.isAuthenticated;

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    this.token.set(token);
  }

  async join() {
    if (!this.token()) return;
    this.isJoining.set(true);
    this.joinError.set(null);
    try {
      const group = await this.groupService.joinGroup(this.token());
      this.joinedGroupId.set(group.id);
      this.joinedGroupName.set(group.name);
      this.joined.set(true);
    } catch (err) {
      this.joinError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to join group.'
      );
    } finally {
      this.isJoining.set(false);
    }
  }

  goToGroup() {
    this.router.navigate(['/groups', this.joinedGroupId()]);
  }
}
