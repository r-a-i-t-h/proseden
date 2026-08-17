import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { currentTimer, timedAsync } from "../observe.js";

const scrypt = promisify(scryptCallback);

const KEYLEN = 64;

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  return timedAsync(currentTimer(), "scrypt", async () => {
    return (await scrypt(password, salt, KEYLEN)) as Buffer;
  });
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString("hex");
  const derived = await deriveKey(password, salt);
  return { hash: derived.toString("hex"), salt };
}

export async function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): Promise<boolean> {
  const derived = await deriveKey(password, salt);
  const expected = Buffer.from(hash, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
