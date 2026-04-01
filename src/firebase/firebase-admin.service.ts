import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "node:fs";
import { App, ServiceAccount, cert, getApps, initializeApp } from "firebase-admin/app";
import { Auth, DecodedIdToken, getAuth } from "firebase-admin/auth";
import { Messaging, getMessaging } from "firebase-admin/messaging";

const FIREBASE_APP_NAME = "budgetapp-firebase";

@Injectable()
export class FirebaseAdminService {
  private readonly logger = new Logger(FirebaseAdminService.name);
  private firebaseApp: App | null | undefined;

  constructor(private readonly configService: ConfigService) {}

  getMessagingOrThrow(): Messaging {
    const app = this.getFirebaseApp();

    if (!app) {
      throw new ServiceUnavailableException(
        "Firebase push notifications are not configured",
      );
    }

    return getMessaging(app);
  }

  getAuthOrThrow(): Auth {
    const app = this.getFirebaseApp();

    if (!app) {
      throw new ServiceUnavailableException(
        "Firebase authentication is not configured",
      );
    }

    return getAuth(app);
  }

  async verifyIdToken(idToken: string): Promise<DecodedIdToken> {
    return this.getAuthOrThrow().verifyIdToken(idToken, true);
  }

  private getFirebaseApp(): App | null {
    if (this.firebaseApp !== undefined) {
      return this.firebaseApp;
    }

    const serviceAccount = this.resolveServiceAccount();
    if (!serviceAccount) {
      this.firebaseApp = null;
      return this.firebaseApp;
    }

    const existing = getApps().find((item) => item.name === FIREBASE_APP_NAME);
    if (existing) {
      this.firebaseApp = existing;
      return this.firebaseApp;
    }

    this.firebaseApp = initializeApp(
      {
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
      },
      FIREBASE_APP_NAME,
    );

    return this.firebaseApp;
  }

  private resolveServiceAccount(): ServiceAccount | null {
    const rawJson = this.configService
      .get<string>("FIREBASE_SERVICE_ACCOUNT_JSON")
      ?.trim();

    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        return this.normalizeServiceAccount(parsed);
      } catch (error) {
        this.logger.error(
          "Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON",
          error instanceof Error ? error.stack : undefined,
        );
        return null;
      }
    }

    const serviceAccountPath = this.configService
      .get<string>("FIREBASE_SERVICE_ACCOUNT_PATH")
      ?.trim();

    if (serviceAccountPath) {
      try {
        if (!existsSync(serviceAccountPath)) {
          this.logger.error(
            `Firebase service account file not found at ${serviceAccountPath}`,
          );
          return null;
        }

        const parsed = JSON.parse(
          readFileSync(serviceAccountPath, "utf8"),
        ) as Record<string, unknown>;
        return this.normalizeServiceAccount(parsed);
      } catch (error) {
        this.logger.error(
          `Failed to read FIREBASE_SERVICE_ACCOUNT_PATH at ${serviceAccountPath}`,
          error instanceof Error ? error.stack : undefined,
        );
        return null;
      }
    }

    const serviceAccount = this.normalizeServiceAccount({
      projectId: this.configService.get<string>("FIREBASE_PROJECT_ID"),
      clientEmail: this.configService.get<string>("FIREBASE_CLIENT_EMAIL"),
      privateKey: this.configService.get<string>("FIREBASE_PRIVATE_KEY"),
    });

    if (!serviceAccount) {
      this.logger.error(
        "Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_PATH, or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY",
      );
    }

    return serviceAccount;
  }

  private normalizeServiceAccount(
    input: Record<string, unknown>,
  ): ServiceAccount | null {
    const projectId =
      typeof input.projectId === "string"
        ? input.projectId.trim()
        : typeof input.project_id === "string"
          ? input.project_id.trim()
          : "";
    const clientEmail =
      typeof input.clientEmail === "string"
        ? input.clientEmail.trim()
        : typeof input.client_email === "string"
          ? input.client_email.trim()
          : "";
    const rawPrivateKey =
      typeof input.privateKey === "string"
        ? input.privateKey
        : typeof input.private_key === "string"
          ? input.private_key
          : "";

    if (!projectId || !clientEmail || !rawPrivateKey) {
      return null;
    }

    return {
      projectId,
      clientEmail,
      privateKey: rawPrivateKey.replace(/\\n/g, "\n"),
    };
  }
}
