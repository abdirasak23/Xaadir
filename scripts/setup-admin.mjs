import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

async function readEnv(path) {
  try {
    const text = await readFile(path, "utf8");
    const values = {};
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      values[match[1]] = match[2].replace(/\\\$/g, "$").replace(/^(['"])(.*)\1$/, "$2");
    }
    return values;
  } catch {
    return {};
  }
}

const current = {
  ...await readEnv(".env.example"),
  ...await readEnv(".env"),
  ...await readEnv(".env.local"),
};
const terminal = createInterface({ input: stdin, output: stdout });
const username = (await terminal.question(`Admin username (default: ${current.ADMIN_USERNAME || "admin"}): `)).trim()
  || current.ADMIN_USERNAME || "admin";
const password = await terminal.question("Choose admin password: ");
terminal.close();

if (!password) {
  console.error("Password cannot be empty.");
  process.exit(1);
}

const adminSessionSecret = randomBytes(32).toString("base64url");
const generatedEdgeSecret = !current.EDGE_FUNCTION_SECRET
  || current.EDGE_FUNCTION_SECRET.startsWith("must_match_");
const generatedQrSecret = !current.QR_SIGNING_SECRET
  || current.QR_SIGNING_SECRET.startsWith("must_match_");
const passwordHash = await bcrypt.hash(password, 12);
const values = {
  ...current,
  ADMIN_USERNAME: username,
  ADMIN_PASSWORD_HASH: passwordHash,
  ADMIN_SESSION_SECRET: adminSessionSecret,
  EDGE_FUNCTION_SECRET: generatedEdgeSecret ? randomBytes(32).toString("base64url") : current.EDGE_FUNCTION_SECRET,
  QR_SIGNING_SECRET: generatedQrSecret ? randomBytes(32).toString("base64url") : current.QR_SIGNING_SECRET,
};

const output = Object.entries(values)
  .filter(([, value]) => value !== undefined)
  .map(([key, value]) => `${key}=${String(value).replace(/\$/g, "\\$")}`)
  .join("\n") + "\n";

await writeFile(".env.local", output, { mode: 0o600 });
console.log("Created .env.local with your admin username, bcrypt password hash, and a fresh session secret.");
console.log("Restart the Next.js dev server, then sign in using the username and password you just entered.");
console.log("The session secret is stored locally; you do not need to look it up or set it in the Supabase Dashboard.");
if (generatedEdgeSecret || generatedQrSecret) {
  console.log("Copy these generated function secrets into Supabase Dashboard → Edge Functions → Secrets:");
  if (generatedEdgeSecret) console.log(`EDGE_FUNCTION_SECRET=${values.EDGE_FUNCTION_SECRET}`);
  if (generatedQrSecret) console.log(`QR_SIGNING_SECRET=${values.QR_SIGNING_SECRET}`);
}
if (!values.NEXT_PUBLIC_SUPABASE_URL || !values.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.log("Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local to enable Supabase features.");
}
if (!values.SUPABASE_SERVICE_ROLE_KEY) {
  console.log("Add SUPABASE_SERVICE_ROLE_KEY to .env.local (server-only) to enable database-backed admin pages.");
}
