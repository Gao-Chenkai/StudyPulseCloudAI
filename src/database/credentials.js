import { DEFAULT_PASSWORD_COST, hashPassword } from "../security/password.js";

export async function getCredentialByUserId(userId, env) {
	return env.StudyPulseDB.prepare(
		`SELECT user_id, password_hash, password_salt, password_algorithm,
		        password_iterations, password_updated_at, failed_login_count,
		        locked_until, created_at, updated_at
		   FROM user_credentials WHERE user_id = ?`,
	).bind(userId).first();
}

export async function getCredentialByEmail(email, env) {
	return env.StudyPulseDB.prepare(
		`SELECT u.id AS user_id, u.email, u.email_normalized, u.email_verified,
		        c.password_hash, c.password_salt, c.password_algorithm,
		        c.password_iterations, c.password_updated_at,
		        c.failed_login_count, c.locked_until
		   FROM users u
		   LEFT JOIN user_credentials c ON c.user_id = u.id
		  WHERE u.email_normalized = ?`,
	).bind(email).first();
}

export async function savePassword(userId, password, env, options = {}) {
	const credential = await hashPassword(password, {
		cost: options.cost ?? DEFAULT_PASSWORD_COST,
	});
	const now = new Date().toISOString();
	await env.StudyPulseDB.prepare(
		`INSERT INTO user_credentials
			 (user_id, password_hash, password_salt, password_algorithm,
			  password_iterations, password_updated_at, failed_login_count,
			  locked_until, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET
			 password_hash = excluded.password_hash,
			 password_salt = excluded.password_salt,
			 password_algorithm = excluded.password_algorithm,
			 password_iterations = excluded.password_iterations,
			 password_updated_at = excluded.password_updated_at,
			 failed_login_count = 0,
			 locked_until = NULL,
			 updated_at = excluded.updated_at`,
	).bind(
		userId,
		credential.password_hash,
		credential.password_salt,
		credential.password_algorithm,
		credential.password_iterations,
		credential.password_updated_at,
		now,
		now,
	).run();
	await env.StudyPulseDB.prepare(
		"UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
	).bind(credential.password_hash, userId).run();
	return credential;
}

export async function recordFailedLogin(userId, env, lockUntil) {
	await env.StudyPulseDB.prepare(
		`UPDATE user_credentials
		    SET failed_login_count = failed_login_count + 1,
		        locked_until = CASE
				WHEN failed_login_count + 1 >= 5 THEN ?
				ELSE locked_until END,
		        updated_at = CURRENT_TIMESTAMP
		  WHERE user_id = ?`,
	).bind(lockUntil, userId).run();
}

export async function clearFailedLogins(userId, env) {
	await env.StudyPulseDB.prepare(
		`UPDATE user_credentials
		    SET failed_login_count = 0, locked_until = NULL, updated_at = CURRENT_TIMESTAMP
		  WHERE user_id = ?`,
	).bind(userId).run();
}
