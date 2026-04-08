/**
 * AES-256-GCM encryption/decryption for sensitive DB tokens (e.g. Firstrade session cookies).
 * Uses ENCRYPTION_KEY env var (must be a 64-char hex string = 32 bytes).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'
const KEY_HEX = process.env.ENCRYPTION_KEY ?? ''

function getKey(): Buffer {
  if (!KEY_HEX || KEY_HEX.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)')
  }
  return Buffer.from(KEY_HEX, 'hex')
}

/**
 * Encrypt plaintext → "iv:authTag:ciphertext" (all hex).
 * Returns the original string unchanged if ENCRYPTION_KEY is not set (dev fallback).
 */
export function encryptToken(plaintext: string): string {
  if (!KEY_HEX || KEY_HEX === 'your_encryption_key_here') return plaintext
  const key = getKey()
  const iv = randomBytes(12) // 96-bit IV for GCM
  const cipher = createCipheriv(ALGO, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Decrypt "iv:authTag:ciphertext" → plaintext.
 * Returns the original string if it doesn't look encrypted (backward compat with plain tokens).
 */
export function decryptToken(stored: string): string {
  if (!KEY_HEX || KEY_HEX === 'your_encryption_key_here') return stored
  // If it doesn't match our format, treat as legacy plaintext
  const parts = stored.split(':')
  if (parts.length !== 3) return stored
  try {
    const key = getKey()
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const ciphertext = Buffer.from(parts[2], 'hex')
    const decipher = createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext) + decipher.final('utf8')
  } catch {
    // Decryption failed — token may be legacy plaintext, return as-is
    return stored
  }
}
