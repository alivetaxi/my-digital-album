import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);

  readonly isLoading = this.auth.isLoading;

  signIn() {
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/albums';
    this.auth.signInWithGoogle(returnUrl);
  }
}
