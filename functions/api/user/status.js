// /functions/api/user/status.js

export async function onRequestGet(context) {
    const { env, data } = context;
    try {
        const loggedInUser = data.user;
        const db = env.DB;

        // Passo 1: Busca os dados básicos do usuário.
        const userStmt = db.prepare(`
            SELECT id, username, telegram_chat_id, telegram_username 
            FROM users 
            WHERE id = ?
        `).bind(loggedInUser.userId);
        const user = await userStmt.first();

        if (!user) {
            return new Response(JSON.stringify({ message: 'Usuário não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Passo 2: Busca todos os cargos do usuário.
        const rolesStmt = db.prepare(`
            SELECT r.id as role_id, r.name as role_name, r.level 
            FROM roles r 
            JOIN user_roles ur ON r.id = ur.role_id 
            WHERE ur.user_id = ? 
            ORDER BY r.level ASC
        `).bind(loggedInUser.userId);
        const { results: roles } = await rolesStmt.all();

        // Adiciona os cargos encontrados ao objeto de resposta.
        user.roles = roles || [];
        // Adiciona o cargo principal para consistência com a UI.
        user.role_name = loggedInUser.role;

        return new Response(JSON.stringify(user), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        console.error("Erro ao buscar status do usuário:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao buscar status do usuário." }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}