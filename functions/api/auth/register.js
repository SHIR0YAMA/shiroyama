// /functions/api/auth/register.js

// Função auxiliar para criar um hash seguro da senha
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();
        const { username, password } = body;

        // 1. Validação básica de entrada
        if (!username || !password || username.length < 3 || password.length < 6) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário (mínimo 3 caracteres) e senha (mínimo 6 caracteres) são obrigatórios.' }), { status: 400 });
        }

        // 2. Criptografa a senha
        const password_hash = await hashPassword(password);

        // 3. Prepara e executa a query no banco de dados D1
        const stmt = env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
        await stmt.bind(username, password_hash).run();
        
        return new Response(JSON.stringify({ success: true, message: 'Usuário registrado com sucesso!' }), {
            status: 201, // 201 Created
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        // Verifica se o erro é de "usuário já existe"
        if (error.message && error.message.includes('UNIQUE constraint failed: users.username')) {
            return new Response(JSON.stringify({ success: false, message: 'Este nome de usuário já está em uso.' }), { status: 409 }); // 409 Conflict
        }
        
        // Outros erros
        console.error('Registration Error:', error);
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}