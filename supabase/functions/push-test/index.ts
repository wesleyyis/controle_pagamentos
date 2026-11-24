// Edge Function "push-test": o botão "Enviar notificação de teste" do app chama esta função
// com o token do usuário logado; ela envia uma notificação para os aparelhos dele.
import type { Assinatura } from "../_shared/alertas-core.ts";
import { restAdmin, usuarioDoToken } from "../_shared/supabase.ts";
import { enviar } from "../_shared/push.ts";

// O site (Netlify) e o Supabase ficam em domínios diferentes, então a função precisa responder ao CORS.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function responder(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ erro: "Método não permitido." }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return responder({ erro: "Autenticação necessária." }, 401);

  try {
    const usuario = await usuarioDoToken(token);
    if (!usuario) return responder({ erro: "Sessão inválida ou expirada." }, 401);

    const assinaturas = await restAdmin<Assinatura[]>(
      "GET",
      `push_subscriptions?select=id,user_id,endpoint,p256dh,auth_key&user_id=eq.${usuario.id}`,
    );
    if (!assinaturas.length) return responder({ erro: "Nenhum dispositivo inscrito para notificações." }, 404);

    const resultado = await enviar(
      assinaturas,
      {
        title: "Teste de notificação",
        body: "Se você está vendo isto, o Web Push está funcionando.",
        tag: "teste",
        url: "/",
        tipo: "teste",
        contas: [],
      },
      async (id) => {
        await restAdmin("DELETE", `push_subscriptions?id=eq.${Number(id)}`);
      },
    );
    return responder(resultado);
  } catch (err) {
    console.error("[push-test] falha:", err);
    return responder({ erro: "Falha ao enviar o teste. Veja os logs da função." }, 500);
  }
});
