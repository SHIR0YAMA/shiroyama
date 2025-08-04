// /functions/api/admin/create-folder.js

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        // O _middleware.js já verificou a permissão 'can_create_folders'
        const { folderPath } = await request.json();

        if (!folderPath || folderPath.includes('//') || folderPath.endsWith('/')) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido.' }), { status: 400 });
        }
        
        const key = `${folderPath}/.placeholder`;

        const existing = await env.ARQUIVOS_TELEGRAM.get(key);
        if (existing !== null) {
            return new Response(JSON.stringify({ message: 'Uma pasta ou arquivo com este nome já existe.' }), { status: 409 });
        }

        // Usando um valor simples para o placeholder
        await env.ARQUIVOS_TELEGRAM.put(key, "placeholder");

        return new Response(JSON.stringify({ success: true, message: 'Pasta criada com sucesso.' }));

    } catch (error) {
        console.error("Erro ao criar pasta:", error);
        return new Response(JSON.stringify({ message: "Erro interno ao criar pasta." }), { status: 500 });
    }
}