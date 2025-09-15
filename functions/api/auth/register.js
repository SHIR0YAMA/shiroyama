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

        if (!username || !password) {
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }
        
        const hashedPassword = await hashPassword(password);
        const db = env.DB;

        // Busca pelo nome EXATO do cargo.
        const memberRole = await db.prepare("SELECT id FROM roles WHERE name = 'Membro'").first();

        if (!memberRole || !memberRole.id) {
            // Se esta mensagem aparecer nos logs, o problema é 100% o nome do cargo no banco.
            console.error("ERRO CRÍTICO: Não foi possível encontrar um cargo com o nome EXATO 'Membro'. Verifique o D1.");
            return new Response(JSON.stringify({ message: 'Configuração de cargo padrão incorreta no servidor.' }), { status: 500 });
        }
        
        // Insere o usuário
        await db.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
            .bind(username, hashedPassword)
            .run();
        
        // Busca o ID do usuário recém-criado
        const newUser = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (!newUser || !newUser.id) {
            throw new Error("Falha crítica ao recuperar o ID do usuário recém-criado.");
        }
        
        // Atribui o cargo "Membro"
        await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
            .bind(newUser.id, memberRole.id)
            .run();

        return new Response(JSON.stringify({ message: 'Conta criada com sucesso!' }), { status: 201 });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Este nome de usuário já está em uso.' }), { status: 409 });
        }
        console.error("Erro no registro:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}