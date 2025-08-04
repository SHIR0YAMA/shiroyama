// /functions/api/admin/rename.js

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_rename_items'.
        const { oldKey, newKey, isFolder } = await request.json();

        if (!oldKey || !newKey) {
            return new Response(JSON.stringify({ message: 'Nome antigo e novo são obrigatórios.' }), { status: 400 });
        }
        
        if (isFolder) {
            const list = await env.ARQUIVOS_TELEGRAM.list({ prefix: oldKey + '/' });

            if (list.keys.length === 0) {
                const placeholderValue = await env.ARQUIVOS_TELEGRAM.get(oldKey + '/.placeholder');
                if (placeholderValue) {
                    await env.ARQUIVOS_TELEGRAM.put(newKey + '/.placeholder', placeholderValue);
                    await env.ARQUIVOS_TELEGRAM.delete(oldKey + '/.placeholder');
                    return new Response(JSON.stringify({ success: true, message: 'Pasta vazia movida/renomeada com sucesso.' }));
                } else {
                    return new Response(JSON.stringify({ message: 'Pasta de origem não encontrada.' }), { status: 404 });
                }
            }

            const operations = list.keys.map(async (key) => {
                const originalValue = await env.ARQUIVOS_TELEGRAM.get(key.name);
                if (originalValue !== null) {
                    const newPath = key.name.replace(oldKey, newKey);
                    await env.ARQUIVOS_TELEGRAM.put(newPath, originalValue);
                    await env.ARQUIVOS_TELEGRAM.delete(key.name);
                }
            });
            
            await Promise.all(operations);
            return new Response(JSON.stringify({ success: true, message: 'Pasta e seu conteúdo renomeados com sucesso.' }));

        } else { // é um arquivo
            const value = await env.ARQUIVOS_TELEGRAM.get(oldKey);
            if (value === null) {
                return new Response(JSON.stringify({ message: 'Arquivo de origem não encontrado.' }), { status: 404 });
            }
            
            await env.ARQUIVOS_TELEGRAM.put(newKey, value);
            await env.ARQUIVOS_TELEGRAM.delete(oldKey);

            return new Response(JSON.stringify({ success: true, message: 'Arquivo renomeado com sucesso.' }));
        }

    } catch (error) {
        console.error("Erro ao renomear:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao renomear." }), { status: 500 });
    }
}