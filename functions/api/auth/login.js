// /functions/api/auth/login.js

import { SignJWT } from 'jose'; // Importa a biblioteca para criar o token

// Função auxiliar para criar um hash da senha (a mesma do registro)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();
        const { username, password } = body;

        // 1. Validação básica
        if (!username || !password) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário e senha são obrigatórios.' }), { status: 400 });
        }

        // 2. Busca o usuário no banco de dados D1
        const stmt = env.DB.prepare('SELECT id, password_hash, role FROM users WHERE username = ?');
        const user = await stmt.bind(username).first();

        if (!user) {
            return new Response(JSON.stringify({ success: false, message: 'Credenciais inválidas.' }), { status: 401 });
        }

        // 3. Compara a senha enviada com a senha salva no banco
        const password_hash = await hashPassword(password);
        if (password_hash !== user.password_hash) {
            return new Response(JSON.stringify({ success: false, message: 'Credenciais inválidas.' }), { status: 401 });
        }

        // 4. Se tudo estiver correto, gera o Token JWT
        const secret = new TextEncoder().encode(env.JWT_SECRET);
        const token = await new SignJWT({ 
                userId: user.id, // Payload: informações que guardamos no token
                role: user.role 
            })
            .setProtectedHeader({ alg: 'HS256' }) // Algoritmo de assinatura
            .setIssuedAt() // Quando o token foi criado
            .setExpirationTime('24h') // Validade do token
            .sign(secret); // Assina com nossa chave secreta

        // 5. Retorna o token para o frontend
        return new Response(JSON.stringify({ 
            success: true, 
            message: 'Login bem-sucedido!',
            token: token
        }), {
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('Login Error:', error);
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}