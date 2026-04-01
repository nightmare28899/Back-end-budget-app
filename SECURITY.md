# Security Checklist

## Before Deploy

- Run `npx prisma migrate deploy` so the `AuthSession` table exists before new auth tokens are issued.
- Rotate `JWT_SECRET` and `JWT_REFRESH_SECRET` when deploying the session-rotation changes to invalidate older tokens faster.
- Set non-default values for `SWAGGER_USERNAME` and `SWAGGER_PASSWORD`, or disable Swagger entirely in public environments.
- Set `CORS_ORIGIN` to the exact admin-panel origin and keep it on HTTPS in production.
- Set `API_BODY_LIMIT` explicitly instead of relying on framework defaults.
- Keep MinIO, database, Firebase, and SMTP credentials out of source control.

## After Deploy

- Force re-login for admins and users if you suspect any token exposure before the refresh-token rotation rollout.
- Watch application logs for `[security]` events such as repeated `auth.refresh.rejected`, `auth.session.invalid`, and unexpected admin disable/update activity.
- Confirm logout revokes the current session and that password changes revoke all active sessions.
- Verify the scheduled auth-session cleanup job runs in the deployed environment.

## Remaining Audit Note

- `npm audit --omit=dev` is clean for high-severity backend issues after the dependency updates in this repo.
- One low-severity advisory chain remains under `firebase-admin` transitive Google client packages. There is no safe same-major upgrade path exposed by `npm audit` at the moment, so keep `firebase-admin` current and revisit on the next upstream release.
