function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function requirePermission(user) {
  return user?.permissions?.includes('bots:manage') || user?.permissions?.includes('can_view_files') || user?.level === 0;
}

export async function onRequestGet(context) {
  const { env, data } = context;
  if (!requirePermission(data.user)) return json({ message: 'Acesso negado.' }, 403);

  const { results } = await env.DB.prepare('SELECT folder_path FROM folders ORDER BY folder_path ASC').all();
  return json({ success: true, folders: results.map((r) => r.folder_path) });
}
