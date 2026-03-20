import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Group } from '../../../core/models';
import { GroupService } from '../../../core/services/group.service';
import { AlbumApiError } from '../../../core/services/album.service';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-group-list',
  standalone: true,
  imports: [RouterLink, FormsModule],
  templateUrl: './group-list.component.html',
  styleUrl: './group-list.component.scss',
})
export class GroupListComponent implements OnInit {
  private readonly groupService = inject(GroupService);
  readonly auth = inject(AuthService);

  readonly groups = signal<Group[]>([]);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);

  // Create group form
  readonly showCreateForm = signal(false);
  readonly newGroupName = signal('');
  readonly isCreating = signal(false);
  readonly createError = signal<string | null>(null);

  async ngOnInit() {
    if (!this.auth.isAuthenticated()) {
      this.isLoading.set(false);
      return;
    }
    try {
      this.groups.set(await this.groupService.listMyGroups());
    } catch {
      this.loadError.set(true);
    } finally {
      this.isLoading.set(false);
    }
  }

  openCreateForm() {
    this.newGroupName.set('');
    this.createError.set(null);
    this.showCreateForm.set(true);
  }

  cancelCreate() {
    this.showCreateForm.set(false);
  }

  async createGroup() {
    const name = this.newGroupName().trim();
    if (!name) return;
    this.isCreating.set(true);
    this.createError.set(null);
    try {
      const group = await this.groupService.createGroup(name);
      this.groups.update(gs => [group, ...gs]);
      this.showCreateForm.set(false);
    } catch (err) {
      this.createError.set(
        err instanceof AlbumApiError ? err.api.message : 'Failed to create group.'
      );
    } finally {
      this.isCreating.set(false);
    }
  }
}
