// /functions/api/admin/reset-password.js

function generateRandomPassword(length = 12) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        const { userId: targetUserId } = await request.json();
        const db = env.DB;

        // A verificação de permissão 'users:reset_password' é feita aqui
        if (!loggedInUser.permissions.includes('users:reset_password')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão: users:reset_password' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // CORREÇÃO: Busca o nível do cargo do usuário alvo a partir da tabela user_roles
        const targetUserStmt = db.prepare(`
            SELECT u.id, u.username, MIN(r.level) as role_level 
            FROM users u
            JOIN user_roles ur ON u.id = ur.user_id
            JOIN roles r ON ur.role_id = r.id
            WHERE u.id = ?
            GROUP BY u.id
        `).bind(targetUserId);
        const targetUser = await targetUserStmt.first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        if (loggedInUser.level >= targetUser.role_level) {
            return new Response(JSON.stringify({ message: 'Não é possível resetar a senha de um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const newPassword = generateRandomPassword(12);
        const newHashedPassword = await hashPassword(newPassword);

        // Atualiza a senha e invalida os tokens antigos
        await db.prepare("UPDATE users SET password = ?, token_valid_after = CURRENT_TIMESTAMP WHERE id = ?").bind(newHashedPassword, targetUserId).run();

        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'reset_password', `Usuário: ${targetUser.username} (ID: ${targetUserId})`)
            .run();
        
        return new Response(JSON.stringify({ success: true, newPassword: newPassword, message: `Senha para o usuário ${targetUser.username} resetada com sucesso.` }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao resetar senha:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao resetar senha." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}