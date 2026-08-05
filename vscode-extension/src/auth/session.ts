
import * as vscode from 'vscode';

import { ApiError, NetworkError, request } from '../api/http';
import type { ApiEnvelope, DeviceStart, SessionPayload, User } from '../api/types';
import { config } from '../config';
import { log } from '../logger';

const ACCESS_TOKEN_KEY = 'imageshrink.accessToken';
const REFRESH_TOKEN_KEY = 'imageshrink.refreshToken';
const USER_KEY = 'imageshrink.user';

export class SessionStore {
  private readonly changeEmitter = new vscode.EventEmitter<User | undefined>();

  readonly onDidChangeSession = this.changeEmitter.event;

  private refreshInFlight: Promise<string> | undefined;

  private cachedUser: User | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.cachedUser = context.globalState.get<User>(USER_KEY);
  }

  get user(): User | undefined {
    return this.cachedUser;
  }

  get isSignedIn(): boolean {
    return this.cachedUser !== undefined;
  }

  private get api(): string {
    return config.apiUrl();
  }

  private get clientVersion(): string {
    return (this.context.extension.packageJSON as { version?: string }).version ?? '0.0.0';
  }

  private async store(payload: SessionPayload): Promise<void> {
    await this.context.secrets.store(ACCESS_TOKEN_KEY, payload.token);
    await this.context.secrets.store(REFRESH_TOKEN_KEY, payload.refreshToken);
    await this.context.globalState.update(USER_KEY, payload.user);
    this.cachedUser = payload.user;
    this.changeEmitter.fire(payload.user);
  }

  private async clear(): Promise<void> {
    await this.context.secrets.delete(ACCESS_TOKEN_KEY);
    await this.context.secrets.delete(REFRESH_TOKEN_KEY);
    await this.context.globalState.update(USER_KEY, undefined);
    this.cachedUser = undefined;
    this.changeEmitter.fire(undefined);
  }

  async accessToken(): Promise<string | undefined> {
    return this.context.secrets.get(ACCESS_TOKEN_KEY);
  }

  async refresh(): Promise<string> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const refreshToken = await this.context.secrets.get(REFRESH_TOKEN_KEY);
      if (!refreshToken) throw new ApiError('Not signed in', 401);

      try {
        const response = await request<ApiEnvelope<SessionPayload>>(`${this.api}/auth/refresh`, {
          method: 'POST',
          body: { refreshToken },
          timeoutMs: 20_000,
        });
        await this.store(response.data);
        log.info('session refreshed');
        return response.data.token;
      } catch (error) {
        if (error instanceof ApiError && error.isAuthFailure) {
          log.warn(`session ended: ${error.message}`);
          await this.clear();
          void vscode.window.showWarningMessage(`ImageShrink: ${error.message}`, 'Sign In').then(
            (choice) => {
              if (choice === 'Sign In') void vscode.commands.executeCommand('imageshrink.signIn');
            }
          );
        }
        throw error;
      }
    })().finally(() => {
      this.refreshInFlight = undefined;
    });

    return this.refreshInFlight;
  }

  async signIn(): Promise<User | undefined> {
    if (!config.networkAllowed()) {
      const choice = await vscode.window.showWarningMessage(
        'ImageShrink is set to use local rules only, so it cannot sign in. Signing in enables AI analysis and syncs your history.',
        'Open Settings',
        'Cancel'
      );
      if (choice === 'Open Settings') {
        void vscode.commands.executeCommand(
          'workbench.action.openSettings',
          'imageshrink.useLocalRulesOnly'
        );
      }
      return undefined;
    }

    let start: DeviceStart;
    try {
      const response = await request<ApiEnvelope<DeviceStart>>(`${this.api}/auth/device/start`, {
        method: 'POST',
        body: {
          clientName: 'VS Code',
          clientVersion: this.clientVersion,
          platform: `${vscode.env.appName} on ${process.platform}`,
        },
        timeoutMs: 20_000,
      });
      start = response.data;
    } catch (error) {
      void vscode.window.showErrorMessage(
        `ImageShrink could not start sign-in: ${(error as Error).message}`
      );
      return undefined;
    }

    const proceed = await vscode.window.showInformationMessage(
      `Your ImageShrink sign-in code is ${start.userCode}`,
      {
        modal: true,
        detail:
          'Copy the code, then approve the sign-in in your browser. The code expires in ' +
          `${Math.round(start.expiresIn / 60)} minutes.`,
      },
      'Copy & Open Browser',
      'Open Browser Only'
    );
    if (!proceed) return undefined;

    if (proceed === 'Copy & Open Browser') {
      await vscode.env.clipboard.writeText(start.userCode);
    }
    await vscode.env.openExternal(vscode.Uri.parse(start.verificationUriComplete));

    return this.pollForApproval(start);
  }

  private async pollForApproval(start: DeviceStart): Promise<User | undefined> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `ImageShrink: waiting for approval (${start.userCode})`,
        cancellable: true,
      },
      async (_progress, token) => {
        const deadline = Date.now() + start.expiresIn * 1000;
        let intervalMs = Math.max(1, start.interval) * 1000;

        while (!token.isCancellationRequested) {
          if (Date.now() > deadline) {
            void vscode.window.showErrorMessage(
              'ImageShrink sign-in expired before it was approved. Run Sign In again.'
            );
            return undefined;
          }

          await new Promise((resolve) => setTimeout(resolve, intervalMs));
          if (token.isCancellationRequested) return undefined;

          try {
            const response = await request<ApiEnvelope<SessionPayload>>(
              `${this.api}/auth/device/token`,
              { method: 'POST', body: { deviceCode: start.deviceCode }, timeoutMs: 20_000 }
            );
            await this.store(response.data);
            log.info(`signed in as ${response.data.user.username}`);
            void vscode.window.showInformationMessage(
              `ImageShrink: signed in as ${response.data.user.username}.`
            );
            return response.data.user;
          } catch (error) {
            if (error instanceof ApiError && error.status === 202) continue;

            if (error instanceof ApiError && error.isThrottled) {
              intervalMs = Math.max(intervalMs, (error.retryAfter ?? start.interval) * 1000);
              continue;
            }

            if (error instanceof NetworkError) {
              log.warn(`sign-in poll failed, retrying: ${error.message}`);
              continue;
            }

            void vscode.window.showErrorMessage(`ImageShrink sign-in failed: ${(error as Error).message}`);
            return undefined;
          }
        }
        return undefined;
      }
    );
  }

  async signOut(): Promise<void> {
    const token = await this.accessToken();
    const username = this.cachedUser?.username;

    if (token && config.networkAllowed()) {
      try {
        await request(`${this.api}/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          timeoutMs: 10_000,
        });
      } catch (error) {
        log.debug(`logout call failed, clearing locally anyway: ${(error as Error).message}`);
      }
    }

    await this.clear();
    log.info('signed out');
    void vscode.window.showInformationMessage(
      username ? `ImageShrink: signed out of ${username}.` : 'ImageShrink: signed out.'
    );
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}
