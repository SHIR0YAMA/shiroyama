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
            return new Response(JSON.stringify({ message: 'Dados inválidos.' }), { status: 400 });
        }
        
        const hashedPassword = await hashPassword(password);
        const db = env.DB;

        // Busca o ID do cargo "Membro"
        const memberRole = await db.prepare("SELECT id FROM roles WHERE name LIKE 'Membro'").first();
        if (!memberRole || !memberRole.id) {
            console.error("ERRO CRÍTICO: O cargo 'Membro' não foi encontrado no banco de dados.");
            return new Response(JSON.stringify({ message: 'Configuração do servidor incorreta: Cargo padrão não encontrado.' }), { status: 500 });
        }
        
        // Insere o usuário
        const userInsertResult = await db.prepare('INSERT INTO users (username, password) VALUES (?, ?)')
            .bind(username, hashedPassword)
            .run();
        
        // Busca o ID do usuário recém-criado
        const newUser = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        if (!newUser || !newUser.id) {
            throw new Error("Falha ao criar o usuário ou recuperar seu ID.");
        }
        
        // Atribui o cargo "Membro"
        await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)')
            .bind(newUser.id, memberRole.id)
            .run();

        return new Response(JSON.stringify({ message: 'Conta criada com sucesso! Agora você pode fazer login.' }), { status: 201 });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Este nome de usuário já está em uso.' }), { status: 409 });
        }
        console.error("Erro no registro:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}