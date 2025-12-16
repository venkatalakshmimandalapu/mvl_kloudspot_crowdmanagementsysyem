import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  loginForm: FormGroup;
  showPassword = signal(false);
  errorMessage = signal<string | null>(null);
  isLoading = signal(false);

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required]], // Accepts both email and login ID
      password: ['', [Validators.required]]
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(value => !value);
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    const credentials = {
      email: this.loginForm.value.email,
      password: this.loginForm.value.password
    };

    this.authService.login(credentials).subscribe({
      next: (response) => {
        console.log('Login successful, token received:', response.token);
        // Wait for site ID to be fetched before navigating
        this.authService.getSiteId().subscribe({
          next: (siteId) => {
            console.log('Site ID received:', siteId);
            if (siteId) {
              this.isLoading.set(false);
              this.router.navigate(['/dashboard']);
            } else {
              console.error('Failed to get site ID - empty response');
              this.errorMessage.set('Failed to load site information. Please try again.');
              this.isLoading.set(false);
            }
          },
          error: (error) => {
            console.error('Error fetching site ID:', error);
            console.error('Error details:', error.error);
            console.error('Status:', error.status);
            this.errorMessage.set('Failed to load site information. Please try again.');
            this.isLoading.set(false);
          }
        });
      },
      error: (error) => {
        console.error('Login error:', error);
        this.isLoading.set(false);
        this.errorMessage.set(
          error.error?.message || 'Login failed. Please check your credentials.'
        );
      }
    });
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }
}




