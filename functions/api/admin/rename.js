// /functions/api/admin/rename.js

export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        const body = await request.json();
        const kv = env.ARQUIVOS_TELEGRAM;

        const { oldKey, newKey, secret } = body;

        if (secret !== env.ADMIN_SECRET_KEY) {
            return new Response(JSON.stringify({ success: false, message: 'Acesso não autorizado.' }), { status: 403 });
        }
        
        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ success: false, message: 'Caminho antigo ou novo não fornecido.' }), { status: 400 });
        }

        const value = await kv.get(oldKey);
        if (value === null) {
            return new Response(JSON.stringify({ success: false, message: 'Arquivo original não encontrado.' }), { status: 404 });
        }

        await kv.put(newKey, value);
        await kv.delete(oldKey);

        return new Response(JSON.stringify({ success: true, message: `Arquivo movido para "${newKey}".` }), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        return new Response(JSON.stringify({ success: false, message: `Erro no servidor: ${error.message}` }), { status: 500 });
    }
}