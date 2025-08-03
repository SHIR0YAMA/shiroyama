// /functions/api/auth/register.js

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const { username, password } = await request.json();

        if (!username || !password || password.length < 6) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário e senha (mínimo 6 caracteres) são obrigatórios.' }), { status: 400 });
        }

        // --- ALTERAÇÃO PRINCIPAL AQUI ---
        // 1. Busca o ID do cargo "Membro" no banco de dados.
        const memberRoleStmt = env.DB.prepare('SELECT id FROM roles WHERE name = ?');
        const memberRole = await memberRoleStmt.bind('Membro').first();

        if (!memberRole) {
            // Isso só aconteceria se o cargo "Membro" fosse deletado, é uma salvaguarda.
            throw new Error('Cargo padrão "Membro" não encontrado. Contate o administrador.');
        }
        const defaultRoleId = memberRole.id;

        const hashedPassword = await hashPassword(password);
        
        // 2. Insere o novo usuário com o role_id padrão.
        const stmt = env.DB.prepare('INSERT INTO users (username, password, role_id) VALUES (?, ?, ?)');
        await stmt.bind(username, hashedPassword, defaultRoleId).run();

        return new Response(JSON.stringify({ success: true, message: 'Usuário registrado com sucesso! Você já pode fazer login.' }), { status: 201 });

    } catch (error) {
        // Trata o erro caso o nome de usuário já exista
        if (error.message.includes('UNIQUE constraint failed: users.username')) {
            return new Response(JSON.stringify({ success: false, message: 'Este nome de usuário já está em uso.' }), { status: 409 });
        }
        console.error("Erro no registro:", error);
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}