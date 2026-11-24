// Valores PÚBLICOS do projeto (podem ficar no navegador; a segurança vem do RLS no banco).
// NUNCA coloque aqui a chave secreta (sb_secret_...), a service_role nem a chave privada VAPID.
//
// Onde achar:
//  - SUPABASE_URL e SUPABASE_ANON_KEY: Supabase → Settings → API Keys
//    (use a "Publishable key" sb_publishable_...; a chave "anon" antiga também funciona por enquanto)
//  - VAPID_PUBLIC_KEY: a mesma VAPID_PUBLIC_KEY que estava no seu .env do backend antigo
//    (ou gere outra com: npx web-push generate-vapid-keys)
export const CONFIG = {
  SUPABASE_URL: 'https://xsvrdoosdlcxjbblujsm.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_pKOn5Atl3q-mFwA7rBNo1w_cXpNuitD',
  VAPID_PUBLIC_KEY: '221d138c08fae60fa6a8392be4a24d29279cc6dac90bb8e14b54dccd02b9677c',
};
