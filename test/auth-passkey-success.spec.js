import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { createSession } from "../src/auth/session.js";
import { handlePasskeyAuthenticationOptions, handlePasskeyAuthenticationVerify, handlePasskeyRegistrationOptions, handlePasskeyRegistrationVerify } from "../src/auth/passkey.js";

function base64Url(bytes) {
	const binary = String.fromCharCode(...new Uint8Array(bytes));
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function digest(value) {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", value));
}

function concat(...parts) {
	const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.length;
	}
	return result;
}

function uint32(value) {
	const result = new Uint8Array(4);
	new DataView(result.buffer).setUint32(0, value);
	return result;
}

function derEncodeEcdsaSignature(rawSignature) {
	const raw = new Uint8Array(rawSignature);
	const component = (value) => {
		let bytes = value;
		while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.slice(1);
		if (bytes[0] & 0x80) bytes = concat(new Uint8Array([0]), bytes);
		return concat(new Uint8Array([0x02, bytes.length]), bytes);
	};
	const r = component(raw.slice(0, 32));
	const s = component(raw.slice(32, 64));
	return concat(new Uint8Array([0x30, r.length + s.length]), r, s);
}

async function createUser() {
	const id = crypto.randomUUID();
	const email = `${id}@example.com`;
	await env.StudyPulseDB.prepare(
		"INSERT INTO users (id, email, email_normalized, email_verified, status) VALUES (?, ?, ?, 1, 'active')",
	).bind(id, email, email).run();
	return { id, email, session: await createSession(id, env) };
}

function sessionRequest(path, body, token) {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: {
			Origin: "http://localhost",
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			"CF-Connecting-IP": crypto.randomUUID(),
		},
		body: JSON.stringify(body),
	});
}

function publicRequest(path, body) {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { Origin: "http://localhost", "Content-Type": "application/json", "CF-Connecting-IP": crypto.randomUUID() },
		body: JSON.stringify(body),
	});
}

async function createRegistrationResponse(options) {
	const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
	const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
	const credentialId = crypto.getRandomValues(new Uint8Array(16));
	const credentialIdText = base64Url(credentialId);
	const x = rawPublicKey.slice(1, 33);
	const y = rawPublicKey.slice(33, 65);
	const credentialPublicKey = isoCBOR.encode(new Map([
		[1, 2],
		[3, -7],
		[-1, 1],
		[-2, x],
		[-3, y],
	]));
	const rpIdHash = await digest(new TextEncoder().encode("localhost"));
	const authData = concat(
		rpIdHash,
		new Uint8Array([0x45]),
		uint32(7),
		new Uint8Array(16),
		new Uint8Array([0, credentialId.length]),
		credentialId,
		credentialPublicKey,
	);
	const clientDataJSON = new TextEncoder().encode(JSON.stringify({
		type: "webauthn.create",
		challenge: options.challenge,
		origin: "http://localhost",
	}));
	const attestationObject = isoCBOR.encode(new Map([
		["fmt", "none"],
		["attStmt", new Map()],
		["authData", authData],
	]));
	return {
		keyPair,
		credentialId: credentialIdText,
		response: {
			id: credentialIdText,
			rawId: credentialIdText,
			type: "public-key",
			response: {
				clientDataJSON: base64Url(clientDataJSON),
				attestationObject: base64Url(attestationObject),
				transports: ["internal"],
			},
		},
	};
}

async function createAuthenticationResponse(options, keyPair, credentialId, counter) {
	const rpIdHash = await digest(new TextEncoder().encode("localhost"));
	const authenticatorData = concat(rpIdHash, new Uint8Array([0x05]), uint32(counter));
	const clientDataJSON = new TextEncoder().encode(JSON.stringify({
		type: "webauthn.get",
		challenge: options.challenge,
		origin: "http://localhost",
	}));
	const clientDataHash = await digest(clientDataJSON);
	const rawSignature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		keyPair.privateKey,
		concat(authenticatorData, clientDataHash),
	);
	return {
		id: credentialId,
		rawId: credentialId,
		type: "public-key",
		response: {
			clientDataJSON: base64Url(clientDataJSON),
			authenticatorData: base64Url(authenticatorData),
			signature: base64Url(derEncodeEcdsaSignature(rawSignature)),
		},
	};
}

describe("Passkey successful verification semantics", () => {
	it("stores a credential, creates a Session, updates the counter, and consumes the challenge once", async () => {
		const user = await createUser();
		const registrationOptions = await handlePasskeyRegistrationOptions(
			sessionRequest("/auth/passkey/register/options", { name: "Test device" }, user.session.token),
			env,
		);
		const registrationOptionsJson = await registrationOptions.json();
		const fixture = await createRegistrationResponse(registrationOptionsJson.data.public_key);
		const registrationVerify = await handlePasskeyRegistrationVerify(
			sessionRequest("/auth/passkey/register/verify", {
				challenge_token: registrationOptionsJson.data.challenge_token,
				response: fixture.response,
			}, user.session.token),
			env,
		);
		expect(registrationVerify.status).toBe(200);

		const loginOptions = await handlePasskeyAuthenticationOptions(publicRequest("/auth/passkey/login/options", {}), env);
		const loginOptionsJson = await loginOptions.json();
		const assertion = await createAuthenticationResponse(loginOptionsJson.data.public_key, fixture.keyPair, fixture.credentialId, 8);
		const loginVerifyBody = { challenge_token: loginOptionsJson.data.challenge_token, response: assertion };
		const loginVerify = await handlePasskeyAuthenticationVerify(publicRequest("/auth/passkey/login/verify", loginVerifyBody), env);
		const loginJson = await loginVerify.json();
		expect(loginVerify.status).toBe(200);
		expect(loginJson.data.access_token).toMatch(/^sp_sess_/);
		expect(loginJson.data.user).toEqual({ id: user.id, email: user.email });

		const stored = await env.StudyPulseDB.prepare(
			"SELECT sign_count, last_used_at, public_key FROM user_passkeys WHERE credential_id = ?",
		).bind(fixture.credentialId).first();
		expect(stored.sign_count).toBe(8);
		expect(stored.last_used_at).toBeTruthy();
		expect(stored.public_key).toBeTruthy();

		const repeated = await handlePasskeyAuthenticationVerify(publicRequest("/auth/passkey/login/verify", loginVerifyBody), env);
		expect(repeated.status).toBe(401);
		expect((await repeated.json()).error.code).toBe("INVALID_PASSKEY");
	});
});
