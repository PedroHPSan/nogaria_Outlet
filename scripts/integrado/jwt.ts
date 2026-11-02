// Gera um JWT HS256 para o teste integrado: deno run jwt.ts <segredo> <role> [email]
const [segredo, role, email] = Deno.args;
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const corpo = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, ...(email ? { email } : {}), iss: "local", exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(corpo))))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
console.log(`${corpo}.${sig}`);
