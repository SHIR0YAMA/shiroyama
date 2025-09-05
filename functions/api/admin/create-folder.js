// /functions/api/admin/create-folder.js

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;
        
        if (!loggedInUser.permissions.includes('can_create_folders')) {
            return new Response(JSON.stringify({ message: 'Acesso negado.' }), { status: 403 });
        }
        
        const { folderPath } = await request.json();
        if (!folderPath || folderPath.includes('//') || folderPath.endsWith('/')) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido.' }), { status: 400 });
        }
        
        const normalizedPath = folderPath.startsWith('/') ? folderPath.substring(1) : folderPath;
        const key = `${normalizedPath}/.placeholder`;

        const existing = await env.ARQUIVOS_TELEGRAM.get(key);
        if (existing !== null) {
            return new Response(JSON.stringify({ message: 'Uma pasta com este nome já existe.' }), { status: 409 });
        }

        await env.ARQUIVOS_TELEGRAM.put(key, JSON.stringify({ created_at: new Date().toISOString() }));
        
        await env.DB.prepare("INSERT INTO admin_logs...").bind(...).run(); // Log

        return new Response(JSON.stringify({ success: true, message: 'Pasta criada.' }));

    } catch (error) {
        console.error("Erro ao criar pasta:", error);
        return new Response(JSON.stringify({ message: "Erro interno." }), { status: 500 });
    }
}