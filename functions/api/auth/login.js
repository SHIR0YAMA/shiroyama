// /functions/api/auth/login.js

import { SignJWT } from 'jose';

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

        if (!username || !password) {
            return new Response(JSON.stringify({ success: false, message: 'Nome de usuário e senha são obrigatórios.' }), { status: 400 });
        }

        const stmt = env.DB.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ?');
        const user = await stmt.bind(username).first();

        if (!user) {
            return new Response(JSON.stringify({ success: false, message: 'Credenciais inválidas.' }), { status: 401 });
        }

        const password_hash = await hashPassword(password);
        if (password_hash !== user.password_hash) {
            return new Response(JSON.stringify({ success: false, message: 'Credenciais inválidas.' }), { status: 401 });
        }

        // Gera o Token JWT com todas as informações necessárias
        const secret = new TextEncoder().encode(env.JWT_SECRET);
        const token = await new SignJWT({ 
                userId: user.id,
                role: user.role,
                username: user.username // Adicionado para exibição no frontend
            })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('24h')
            .sign(secret);

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