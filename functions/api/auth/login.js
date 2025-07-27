// /functions/api/auth/login.js

// --- FUNÇÕES JWT NATIVAS (SEM DEPENDÊNCIAS) ---

// Função para codificar dados em Base64URL
function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

// Função para criar e assinar o token JWT
async function createJwt(secret, payload) {
    const encoder = new TextEncoder();
    
    // Header do JWT (padrão)
    const header = { alg: 'HS256', typ: 'JWT' };
    const encodedHeader = base64url(encoder.encode(JSON.stringify(header)));
    
    // Payload do JWT (nossos dados)
    const encodedPayload = base64url(encoder.encode(JSON.stringify(payload)));
    
    // Cria a parte para assinar
    const dataToSign = `${encodedHeader}.${encodedPayload}`;
    
    // Importa a chave secreta para a API de criptografia
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    // Assina os dados
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
    
    // Codifica a assinatura
    const encodedSignature = base64url(signature);
    
    // Retorna o token completo
    return `${dataToSign}.${encodedSignature}`;
}

// Função para criar hash da senha (a mesma de antes)
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- FUNÇÃO PRINCIPAL DA API ---

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

        // Cria o payload do token
        const payload = {
            userId: user.id,
            role: user.role,
            username: user.username,
            iat: Math.floor(Date.now() / 1000), // Issued at
            exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // Expira em 24 horas
        };
        
        // Cria o token JWT usando nossa função nativa
        const token = await createJwt(env.JWT_SECRET, payload);

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