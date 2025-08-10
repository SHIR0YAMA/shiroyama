// /functions/api/admin/users.js

export async function onRequestGet(context) {
    try {
        const loggedInUser = context.data.user;
        if (!loggedInUser.permissions.includes('users:view_list')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão: users:view_list' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const { env } = context;
        const stmt = env.DB.prepare(`
            SELECT u.id, u.username, u.created_at, u.telegram_chat_id, r.name as role_name, u.role_id, r.level as role_level
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY u.username ASC
        `);
        const { results } = await stmt.all();
        return new Response(JSON.stringify({ success: true, users: results }));
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro interno ao buscar a lista de usuários.' }), { status: 500 });
    }
}