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

        if (!username || username.length < 3 || !password || password.length < 6) {
            return new Response(JSON.stringify({ message: 'Nome de usuário (mínimo 3 caracteres) e senha (mínimo 6 caracteres) são obrigatórios.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        
        const hashedPassword = await hashPassword(password);
        const db = env.DB;

        // CORREÇÃO: Usa a função aprimorada para buscar o cargo padrão
        const memberRole = await db.prepare("SELECT id FROM roles WHERE name LIKE 'Membro'").first();

        if (!memberRole || !memberRole.id) {
            return new Response(JSON.stringify({ message: 'Configuração do servidor incorreta: Cargo padrão "Membro" não encontrado.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        
        const userInsertStmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
            .bind(username, hashedPassword);
        const { meta } = await userInsertStmt.run();
        
        const newUserId = meta.last_row_id;

        if (newUserId) {
            await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
                .bind(newUserId, memberRole.id)
                .run();
        } else {
            throw new Error("Não foi possível obter o ID do novo usuário após a inserção.");
        }

        return new Response(JSON.stringify({ message: 'Conta criada com sucesso! Agora você pode fazer login.' }), { status: 201, headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Este nome de usuário já está em uso.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error("Erro no registro:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}