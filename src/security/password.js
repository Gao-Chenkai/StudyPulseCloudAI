/**
 * Password hashing for Cloudflare Workers.
 *
 * Passwords never leave this module in a log or response. The returned
 * structure is safe to persist as-is in user_credentials.
 */

export const PASSWORD_ALGORITHM = "pbkdf2-sha256";
export const DEFAULT_PASSWORD_ITERATIONS = 120_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_DERIVED_BYTES = 32;

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

function getIterations(options = {}) {
	const iterations = Number(options.iterations ?? DEFAULT_PASSWORD_ITERATIONS);
	if (!Number.isInteger(iterations) || iterations < 1) {
		throw new Error("Invalid PBKDF2 iteration configuration");
	}
	return iterations;
}

async function derive(password, salt, iterations) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(password),
		{ name: "PBKDF2" },
		false,
		["deriveBits"],
	);
	const bits = await crypto.subtle.deriveBits(
		{
			name: "PBKDF2",
			salt,
			iterations,
			hash: "SHA-256",
		},
		key,
		PASSWORD_DERIVED_BYTES * 8,
	);
	return new Uint8Array(bits);
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
	const iterations = getIterations(options);
	const salt = new Uint8Array(PASSWORD_SALT_BYTES);
	crypto.getRandomValues(salt);
	const derived = await derive(password, salt, iterations);
	return {
		password_hash: toBase64(derived),
		password_salt: toBase64(salt),
		password_algorithm: PASSWORD_ALGORITHM,
		password_iterations: iterations,
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

/**
 * @param {string} password
 * @param {{password_hash:string,password_salt:string,password_algorithm:string,password_iterations:number}} credential
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, credential) {
	if (typeof password !== "string" || !credential || credential.password_algorithm !== PASSWORD_ALGORITHM) {
		return false;
	}
	try {
		const derived = await derive(
			password,
			fromBase64(credential.password_salt),
			getIterations({ iterations: credential.password_iterations }),
		);
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
		|| Number(credential.password_iterations) < getIterations(options);
}
