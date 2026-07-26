/**
 * Password hashing for Cloudflare Workers.
 *
 * Passwords never leave this module in a log or response. The returned
 * structure is safe to persist as-is in user_credentials.
 */

import bcrypt from "bcryptjs";

export const PASSWORD_ALGORITHM = "bcrypt";
export const DEFAULT_PASSWORD_COST = 12;
const LEGACY_PASSWORD_ALGORITHM = "pbkdf2-sha256";

function toBase64(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function fromBase64(value) {
	const binary = atob(value);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function passwordCharacterLength(password) {
	return Array.from(password).length;
}

/**
 * Validate the product's first-version password policy.
 * Unicode code points, rather than UTF-8 bytes or UTF-16 code units, are used.
 */
export function validatePassword(password) {
	if (typeof password !== "string") {
		return { valid: false, code: "INVALID_REQUEST", message: "密码必须是字符串" };
	}
	const length = passwordCharacterLength(password);
	if (length === 0 || /^\s+$/u.test(password)) {
		return { valid: false, code: "WEAK_PASSWORD", message: "密码不能为空或全部为空白字符" };
	}
	if (length < 10) {
		return { valid: false, code: "WEAK_PASSWORD", message: "密码长度至少为 10 个字符" };
	}
	if (length > 128) {
		return { valid: false, code: "WEAK_PASSWORD", message: "密码长度不能超过 128 个字符" };
	}
	return { valid: true, length };
}

/**
 * @param {string} password
 * @param {{iterations?: number}} [options]
 * @returns {Promise<{password_hash:string,password_salt:string,password_algorithm:string,password_iterations:number,password_updated_at:string}>}
 */
export async function hashPassword(password, options = {}) {
	const policy = validatePassword(password);
	if (!policy.valid) {
		const error = new Error(policy.message);
		error.code = policy.code;
		throw error;
	}
	const cost = Number(options.cost ?? DEFAULT_PASSWORD_COST);
	if (!Number.isInteger(cost) || cost < 8 || cost > 15) throw new Error("Invalid bcrypt cost");
	const passwordHash = await bcrypt.hash(password, cost);
	return {
		password_hash: passwordHash,
		password_salt: "",
		password_algorithm: PASSWORD_ALGORITHM,
		password_iterations: cost,
		password_updated_at: new Date().toISOString(),
	};
}

function timingSafeEqual(left, right) {
	let result = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		result |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return result === 0;
}

async function legacyDerive(password, salt, iterations) {
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
	const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, 256);
	return new Uint8Array(bits);
}

/**
 * @param {string} password
 * @param {{password_hash:string,password_salt:string,password_algorithm:string,password_iterations:number}} credential
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, credential) {
	if (typeof password !== "string" || !credential) {
		return false;
	}
	try {
		if (credential.password_algorithm === PASSWORD_ALGORITHM) return await bcrypt.compare(password, credential.password_hash);
		if (credential.password_algorithm !== LEGACY_PASSWORD_ALGORITHM) return false;
		const derived = await legacyDerive(password, fromBase64(credential.password_salt), Number(credential.password_iterations));
		return timingSafeEqual(derived, fromBase64(credential.password_hash));
	} catch {
		return false;
	}
}

/**
 * @param {{password_algorithm?:string,password_iterations?:number}} credential
 * @param {{iterations?:number}} [options]
 */
export function needsPasswordRehash(credential, options = {}) {
	return !credential
		|| credential.password_algorithm !== PASSWORD_ALGORITHM
		|| Number(credential.password_iterations) < Number(options.cost ?? DEFAULT_PASSWORD_COST);
}
