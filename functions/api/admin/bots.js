function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet() {
  return json({
    message: 'Endpoint descontinuado: a arquitetura agora usa bot único no backend (.env). Use /api/admin/bot-mappings para gerenciar fontes monitoradas.'
  }, 410);
}

export async function onRequestPost() {
  return json({
    message: 'Endpoint descontinuado: cadastro/edição de bots foi removido do painel.'
  }, 410);
}
