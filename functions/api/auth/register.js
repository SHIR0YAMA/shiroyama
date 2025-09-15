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

        const memberRole = await db.prepare("SELECT id FROM roles WHERE name LIKE 'Membro'").first();
        if (!memberRole || !memberRole.id) {
            console.error("ERRO CRÍTICO: O cargo 'Membro' não foi encontrado no banco de dados.");
            return new Response(JSON.stringify({ message: 'Configuração do servidor incorreta: Cargo padrão não encontrado.' }), { status: 500 });
        }
        
        // D1 não suporta transações explícitas (BEGIN/COMMIT), mas `batch` é atômico.
        // O problema é que não podemos obter o ID do usuário inserido dentro do mesmo batch.
        // Vamos voltar à abordagem sequencial, mas com logs para depurar.

        console.log(`Tentando registrar usuário: ${username}`);
        
        const userInsertStmt = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').bind(username, hashedPassword);
        const info = await userInsertStmt.run();
        
        // Log para ver o que a inserção retorna
        console.log("Resultado da inserção do usuário:", JSON.stringify(info));

        // Busca o ID do usuário recém-criado
        const newUser = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
        
        if (!newUser || !newUser.id) {
            console.error("Falha ao recuperar o ID do usuário recém-criado.");
            throw new Error("Falha ao criar o usuário ou recuperar seu ID.");
        }
        
        console.log(`Usuário criado com ID: ${newUser.id}. Atribuindo cargo Membro (ID: ${memberRole.id})`);
        
        // Atribui o cargo "Membro"
        await db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(newUser.id, memberRole.id).run();
        
        console.log(`Cargo atribuído com sucesso ao usuário ID: ${newUser.id}`);

        return new Response(JSON.stringify({ message: 'Conta criada com sucesso! Agora você pode fazer login.' }), { status: 201 });

    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'Este nome de usuário já está em uso.' }), { status: 409 });
        }
        console.error("Erro no registro:", error);
        return new Response(JSON.stringify({ message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}