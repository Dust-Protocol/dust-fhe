// PIN-based key derivation for Dust Protocol
// Uses SHA-512 (from @noble/hashes) + Web Crypto API for PBKDF2 & AES-256-GCM

import { sha512 } from '@noble/hashes/sha512';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

// Async PBKDF2 via Web Crypto — hardware-accelerated, non-blocking
async function webCryptoPbkdf2(password: Uint8Array, salt: Uint8Array, iterations: number, dkLen: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey('raw', password.buffer as ArrayBuffer, 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    keyMaterial,
    dkLen * 8,
  );
  return new Uint8Array(derived);
}

// Derive a 32-byte spending seed from wallet signature + PIN
// Uses PBKDF2 with 100K iterations to resist brute-force (6-digit PIN = 1M combos)
export async function deriveSpendingSeed(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Spend Authority v2');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

// Derive a 32-byte viewing seed from wallet signature + PIN
export async function deriveViewingSeed(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust View Authority v2');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

// Derive a 32-byte claim seed from wallet signature + PIN
export async function deriveClaimSeed(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Claim Authority v2');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

// True original v0 derivation — plain SHA-512, pre-audit (before H2 PBKDF2 change)
// Existing users who registered before the audit have keys derived this way.
export function deriveSpendingSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust Spend Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

export function deriveViewingSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust View Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

export function deriveClaimSeedV0(signature: string, pin: string): string {
  const input = new TextEncoder().encode(signature + pin + 'Dust Claim Authority');
  return bytesToHex(sha512(input).slice(0, 32));
}

// Legacy v1 derivation — PBKDF2 with old salts (intermediate, rarely used)
export async function deriveSpendingSeedV1(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Spend Authority');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

export async function deriveViewingSeedV1(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust View Authority');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

export async function deriveClaimSeedV1(signature: string, pin: string): Promise<string> {
  const password = new TextEncoder().encode(signature + pin);
  const salt = new TextEncoder().encode('Dust Claim Authority');
  return bytesToHex(await webCryptoPbkdf2(password, salt, 100_000, 32));
}

const WEAK_PINS = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555',
  '666666', '777777', '888888', '999999', '123456', '654321',
  '123123', '121212', '696969', '112233', '159753', '292513',
]);

// Validate PIN format: exactly 6 digits
export function validatePin(pin: string): { valid: boolean; error?: string } {
  if (!pin) return { valid: false, error: 'PIN is required' };
  if (pin.length !== 6) return { valid: false, error: 'PIN must be exactly 6 digits' };
  if (!/^\d{6}$/.test(pin)) return { valid: false, error: 'PIN must contain only digits' };
  if (WEAK_PINS.has(pin)) return { valid: false, error: 'PIN is too common — choose a stronger one' };
  return { valid: true };
}

// Encrypt PIN using AES-256-GCM with PBKDF2-derived key from signature
export async function encryptPin(pin: string, signature: string): Promise<string> {
  const salt = sha256(new TextEncoder().encode('dust-pin-salt:' + signature.slice(0, 20)));
  const key = await webCryptoPbkdf2(new TextEncoder().encode(signature), salt, 100_000, 32);

  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    cryptoKey,
    new TextEncoder().encode(pin)
  );

  // Store as: iv (24 hex chars) + ciphertext (hex)
  return bytesToHex(iv) + bytesToHex(new Uint8Array(encrypted));
}

// Decrypt stored PIN
export async function decryptPin(encrypted: string, signature: string): Promise<string> {
  const salt = sha256(new TextEncoder().encode('dust-pin-salt:' + signature.slice(0, 20)));
  const key = await webCryptoPbkdf2(new TextEncoder().encode(signature), salt, 100_000, 32);

  const cryptoKey = await crypto.subtle.importKey('raw', key.buffer as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const iv = hexToBytes(encrypted.slice(0, 24));
  const ciphertext = hexToBytes(encrypted.slice(24));

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    cryptoKey,
    ciphertext.buffer as ArrayBuffer
  );

  return new TextDecoder().decode(decrypted);
}

// Storage helpers — keys are hashed to avoid fingerprinting the wallet address
import { storageKey, migrateKey } from '@/lib/storageKey';

function pinKey(address: string): string {
  return storageKey('pin', address);
}

export function hasPinStored(address: string): boolean {
  if (typeof window === 'undefined') return false;
  migrateKey('dust_pin_' + address.toLowerCase(), pinKey(address));
  return !!localStorage.getItem(pinKey(address));
}

export function getStoredPin(address: string): string | null {
  if (typeof window === 'undefined') return null;
  migrateKey('dust_pin_' + address.toLowerCase(), pinKey(address));
  return localStorage.getItem(pinKey(address));
}

export function storeEncryptedPin(address: string, encrypted: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(pinKey(address), encrypted);
}

export function clearStoredPin(address: string): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(pinKey(address));
  // Also clean up legacy key if still present
  localStorage.removeItem('dust_pin_' + address.toLowerCase());
}
