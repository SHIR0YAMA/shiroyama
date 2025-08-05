// /functions/api/admin/reset-password.js

// Função para gerar uma senha aleatória segura
function generateRandomPassword(length = 12) {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return password;
}

// Função para criar o hash da senha
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

        // CORREÇÃO: Verifica a permissão correta
        if (!loggedInUser.permissions.includes('can_manage_users')) {
             return new Response(JSON.stringify({ message: 'Acesso negado: Requer permissão para gerenciar usuários.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Busca informações do usuário alvo
        const targetUser = await db.prepare("SELECT u.id, u.username, r.level as role_level, (SELECT GROUP_CONCAT(p.name) FROM role_permissions rp JOIN permissions p ON rp.permission_id = p.id WHERE rp.role_id = u.role_id) as permissions FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?").bind(targetUserId).first();

        if (!targetUser) {
            return new Response(JSON.stringify({ message: 'Usuário alvo não encontrado.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }

        // Regra de Hierarquia
        if (loggedInUser.level >= targetUser.role_level) {
            return new Response(JSON.stringify({ message: 'Não é possível resetar a senha de um usuário com hierarquia igual ou superior à sua.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        // Trava de Segurança
        targetUser.permissions = targetUser.permissions ? targetUser.permissions.split(',') : [];
        if (targetUser.permissions.includes('can_manage_roles') && loggedInUser.role !== 'Dono') {
            return new Response(JSON.stringify({ message: 'Não é possível resetar a senha de um usuário com permissão para gerenciar cargos.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const newPassword = generateRandomPassword(12);
        const newHashedPassword = await hashPassword(newPassword);

        await db.prepare("UPDATE users SET password = ? WHERE id = ?").bind(newHashedPassword, targetUserId).run();

        // Log da ação
        await db.prepare("INSERT INTO admin_logs (admin_user_id, admin_username, action, target_info) VALUES (?, ?, ?, ?)")
            .bind(loggedInUser.userId, loggedInUser.username, 'reset_password', `Usuário: ${targetUser.username} (ID: ${targetUserId})`)
            .run();
        
        // Retorna a nova senha para o admin poder passá-la ao usuário
        return new Response(JSON.stringify({ success: true, newPassword: newPassword, message: `Senha para o usuário ${targetUser.username} resetada com sucesso.` }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao resetar senha:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao resetar senha." }), { status: 500, headers: { 'Content-Type': 'application/json' }});
    }
}