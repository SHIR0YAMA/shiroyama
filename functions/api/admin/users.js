// /functions/api/admin/users.js

export async function onRequestGet(context) {
    try {
        // O _middleware.js já cuidou da autenticação e verificação de permissão.
        // Se a execução chegou até aqui, significa que o usuário é válido e
        // tem a permissão 'can_manage_users'.

        const { env } = context;

        // A lógica agora é apenas buscar os dados do banco.
        // Vamos buscar todos os dados necessários de uma vez.
        const stmt = env.DB.prepare(`
            SELECT 
                u.id, 
                u.username, 
                u.created_at, 
                u.telegram_chat_id, 
                r.name as role_name,
                u.role_id
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY u.username ASC
        `);
        
        const { results } = await stmt.all();

        return new Response(JSON.stringify({ success: true, users: results }));

    } catch (error) {
        // Este catch agora lidará com erros do banco de dados, não de autenticação.
        console.error("Erro ao buscar usuários:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro interno ao buscar a lista de usuários.' }), { status: 500 });
    }
}