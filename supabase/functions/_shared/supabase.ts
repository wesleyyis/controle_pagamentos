// Acesso ao banco com a chave SECRETA (só dentro das Edge Functions) usando fetch.
// Funciona com as chaves novas (sb_secret_...) e, como reserva, com a service_role antiga.

export function urlProjeto(): string {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL ausente no ambiente da função.");
  return url.replace(/\/+$/, "");
}

function chaveDoJson(nomeVariavel: string): string | null {
  const bruto = Deno.env.get(nomeVariavel);
  if (!bruto) return null;
  try {
    const mapa = JSON.parse(bruto) as Record<string, string>;
    return mapa["default"] ?? Object.values(mapa)[0] ?? null;
  } catch {
    return null;
  }
}

export function chaveSecreta(): string {
  const chave = chaveDoJson("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!chave) {
    throw new Error("Nenhuma chave secreta no ambiente (SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY).");
  }
  return chave;
}

function chavePublicavel(): string {
  return chaveDoJson("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? chaveSecreta();
}

function cabecalhosAdmin(): Record<string, string> {
  const chave = chaveSecreta();
  const h: Record<string, string> = { apikey: chave, "Content-Type": "application/json" };
  // A chave antiga é um JWT e vai também em Authorization; a nova (sb_secret_) vai só em apikey.
  if (chave.startsWith("eyJ")) h["Authorization"] = `Bearer ${chave}`;
  return h;
}

export async function restAdmin<T = unknown>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const resposta = await fetch(`${urlProjeto()}/rest/v1/${caminho}`, {
    method: metodo,
    headers: cabecalhosAdmin(),
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  const texto = await resposta.text();
  if (!resposta.ok) throw new Error(`PostgREST ${metodo} ${caminho.split("?")[0]} -> ${resposta.status}: ${texto}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

/** Valida o token do usuário no Supabase Auth. Retorna null se for inválido/expirado. */
export async function usuarioDoToken(token: string): Promise<{ id: string; email?: string } | null> {
  const resposta = await fetch(`${urlProjeto()}/auth/v1/user`, {
    headers: { apikey: chavePublicavel(), Authorization: `Bearer ${token}` },
  });
  if (!resposta.ok) return null;
  const u = await resposta.json();
  return u && u.id ? { id: u.id, email: u.email } : null;
}
