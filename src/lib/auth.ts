import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "xaadir_admin";
export const COMPANY_SESSION_COOKIE = "xaadir_company";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function sessionSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  return new TextEncoder().encode(secret);
}

export async function createAdminSession() {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionSecret());
}

export async function isValidAdminSession(token: string | undefined) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function createCompanySession(
  userId: string,
  accessToken: string,
  refreshToken: string,
  mustChangePassword: boolean,
) {
  return new SignJWT({
    role: "company_admin",
    accessToken,
    refreshToken,
    mustChangePassword,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(sessionSecret());
}

export async function readCompanySession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (
      payload.role !== "company_admin"
      || typeof payload.sub !== "string"
      || typeof payload.accessToken !== "string"
      || typeof payload.refreshToken !== "string"
      || typeof payload.mustChangePassword !== "boolean"
    ) return null;
    return {
      userId: payload.sub,
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      mustChangePassword: payload.mustChangePassword,
    };
  } catch {
    return null;
  }
}

export async function isValidCompanySession(token: string | undefined) {
  return (await readCompanySession(token)) !== null;
}
