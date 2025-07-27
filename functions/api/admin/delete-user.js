// /functions/api/admin/delete-user.js

// -- Função de verificação de Token JWT (copie novamente) --
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

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 401 });
        const token = authHeader.split(' ')[1];
        const payload = await verifyJwt(token, env.JWT_SECRET);

        if (payload.role !== 'owner') {
            return new Response(JSON.stringify({ message: 'Apenas o dono pode deletar usuários.' }), { status: 403 });
        }

        const { userId } = await request.json();

        // Medida de segurança: O dono não pode deletar a si mesmo.
        if (payload.userId === userId) {
            return new Response(JSON.stringify({ message: 'Você não pode deletar sua própria conta.' }), { status: 400 });
        }

        const stmt = env.DB.prepare('DELETE FROM users WHERE id = ?');
        await stmt.bind(userId).run();

        return new Response(JSON.stringify({ success: true, message: 'Usuário deletado com sucesso!' }));

    } catch (error) {
        return new Response(JSON.stringify({ message: `Erro: ${error.message}` }), { status: 401 });
    }
}