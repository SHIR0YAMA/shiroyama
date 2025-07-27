// /functions/api/auth/change-password.js

// --- FUNÇÕES JWT NATIVAS (precisamos delas para verificar o token) ---
async function verifyJwt(token, secret) {
    try {
        const encoder = new TextEncoder();
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        
        const dataToSign = `${encodedHeader}.${encodedPayload}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        
        const signature = new Uint8Array(atob(encodedSignature.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)));

        const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(dataToSign));

        if (!isValid) {
            throw new Error('Assinatura do token inválida');
        }

        const decodedPayload = JSON.parse(new TextDecoder().decode(new Uint8Array(atob(encodedPayload.replace(/_/g, '/').replace(/-/g, '+')).split('').map(c => c.charCodeAt(0)))));

        if (decodedPayload.exp < Math.floor(Date.now() / 1000)) {
            throw new Error('Token expirado');
        }

        return decodedPayload;
    } catch (error) {
        throw new Error('Token inválido ou malformado');
    }
}

// Função para criar hash da senha
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
        
        // 1. Verifica o token de autorização
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ success: false, message: 'Token não fornecido.' }), { status: 401 });
        }
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);
        const userId = payload.userId;

        // 2. Pega os dados da requisição
        const { currentPassword, newPassword } = await request.json();
        if (!currentPassword || !newPassword || newPassword.length < 6) {
            return new Response(JSON.stringify({ success: false, message: 'Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias.' }), { status: 400 });
        }

        // 3. Busca a senha atual do usuário no D1
        const stmtSelect = env.DB.prepare('SELECT password_hash FROM users WHERE id = ?');
        const user = await stmtSelect.bind(userId).first();

        if (!user) {
            return new Response(JSON.stringify({ success: false, message: 'Usuário não encontrado.' }), { status: 404 });
        }

        // 4. Verifica se a senha atual está correta
        const currentPasswordHash = await hashPassword(currentPassword);
        if (currentPasswordHash !== user.password_hash) {
            return new Response(JSON.stringify({ success: false, message: 'A senha atual está incorreta.' }), { status: 403 });
        }

        // 5. Se tudo estiver certo, atualiza para a nova senha
        const newPasswordHash = await hashPassword(newPassword);
        const stmtUpdate = env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        await stmtUpdate.bind(newPasswordHash, userId).run();

        return new Response(JSON.stringify({ success: true, message: 'Senha alterada com sucesso! Faça login novamente.' }));

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro: ${error.message}` }), { status: 401 });
    }
}