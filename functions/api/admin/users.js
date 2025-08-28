// /functions/api/admin/users.js

export async function onRequestGet(context) {
    const { env, data } = context;
    try {
        const loggedInUser = data.user;

        if (!loggedInUser.permissions.includes('users:view_list')) {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const db = env.DB;
        const usersStmt = db.prepare(`
            SELECT u.id, u.username, u.created_at, u.telegram_chat_id, r.name as role_name, u.role_id, r.level as role_level
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY u.username ASC
        `);
        
        let rolesStmt;
        if (loggedInUser.permissions.includes('roles:assign')) {
            rolesStmt = db.prepare(`SELECT id, name, level FROM roles ORDER BY level ASC, name ASC`);
        }

        // Executa as queries em batch para otimização
        const [usersResult, rolesResult] = await db.batch([
            usersStmt,
            rolesStmt // Será null se o usuário não tiver permissão
        ].filter(Boolean)); // Filtra para remover a query nula se for o caso

        return new Response(JSON.stringify({
            success: true,
            users: usersResult ? usersResult.results : [],
            roles: rolesResult ? rolesResult.results : [] // Retorna a lista de cargos junto
        }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro interno ao buscar a lista de usuários.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}