// /functions/api/auth/change-password.js

// Função para criar hash da senha
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        // 1. O _middleware.js já verificou o token. Pegamos os dados do usuário do contexto.
        const loggedInUser = data.user;
        const userId = loggedInUser.userId;

        // 2. Pega os dados da requisição
        const { currentPassword, newPassword } = await request.json();
        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return new Response(JSON.stringify({ success: false, message: 'Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias.' }), { status: 400, headers: { 'Content-Type': 'application/json' }});
        }

        // 3. Busca a senha atual do usuário no D1
        // CORREÇÃO: Usando a coluna 'password' em vez de 'password_hash'
        const user = await env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(userId).first();

        if (!user) {
            return new Response(JSON.stringify({ success: false, message: 'Usuário não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' }});
        }

        // 4. Verifica se a senha atual está correta
        const currentPasswordHash = await hashPassword(currentPassword);
        if (currentPasswordHash !== user.password) {
            return new Response(JSON.stringify({ success: false, message: 'A senha atual está incorreta.' }), { status: 403, headers: { 'Content-Type': 'application/json' }});
        }

        // 5. Se tudo estiver certo, atualiza para a nova senha e invalida tokens antigos
        const newPasswordHash = await hashPassword(newPassword);
        
        // CORREÇÃO: Atualiza a coluna 'password' e a nova coluna 'token_valid_after'
        const stmtUpdate = env.DB.prepare('UPDATE users SET password = ?, token_valid_after = CURRENT_TIMESTAMP WHERE id = ?');
        await stmtUpdate.bind(newPasswordHash, userId).run();

        // Log da ação
        await env.DB.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'change_password_self', `Usuário: ${loggedInUser.username}`)
            .run();

        return new Response(JSON.stringify({ success: true, message: 'Senha alterada com sucesso! Você foi desconectado e precisa fazer login novamente.' }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao alterar senha:", error);
        return new Response(JSON.stringify({ success: false, message: `Erro: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}