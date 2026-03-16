// /functions/api/admin/create-folder.js

function normalizeFolderPath(rawPath) {
    const trimmed = String(rawPath || '').trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed) return '';
    const parts = trimmed.split('/').map((p) => p.trim()).filter(Boolean);
    return parts.join('/');
}

function isInvalidSegment(segment) {
    if (!segment) return true;
    if (segment === '.' || segment === '..' || segment === '.placeholder') return true;
    return /[\\:*?"<>|]/.test(segment);
}

export async function onRequestPost(context) {
    const { request, env, data } = context;
    try {
        const loggedInUser = data.user;

        if (!loggedInUser.permissions.includes('can_create_folders')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão para criar pastas.' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const { folderPath } = await request.json();
        const normalizedPath = normalizeFolderPath(folderPath);

        if (!normalizedPath) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido. Não é possível criar a pasta raiz/Home.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        const segments = normalizedPath.split('/');
        if (segments.some(isInvalidSegment)) {
            return new Response(JSON.stringify({ message: 'Nome de pasta inválido.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }

        // evita conflito indevido por case (Animes vs animes)
        const existingFolderCase = await env.DB.prepare('SELECT folder_path FROM folders WHERE lower(folder_path) = lower(?)').bind(normalizedPath).first('folder_path');
        if (existingFolderCase) {
            return new Response(JSON.stringify({ message: `A pasta já existe: ${existingFolderCase}` }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }

        // evita colisão com nome de arquivo na mesma pasta
        const conflictingFile = await env.DB.prepare(`
            SELECT id FROM files
            WHERE lower(CASE WHEN folder_path = '' THEN file_name ELSE folder_path || '/' || file_name END) = lower(?)
            LIMIT 1
        `).bind(normalizedPath).first();
        if (conflictingFile) {
            return new Response(JSON.stringify({ message: 'Já existe um arquivo com este caminho.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }

        await env.DB.prepare(
            'INSERT INTO folders (folder_path, created_by_user_id) VALUES (?, ?)'
        ).bind(normalizedPath, loggedInUser.userId).run();

        // Compatibilidade legado (árvore antiga baseada em placeholder)
        const key = `${normalizedPath}/.placeholder`;
        const value = JSON.stringify({ created_at: new Date().toISOString() });
        await env.ARQUIVOS_TELEGRAM.put(key, value);

        return new Response(JSON.stringify({ success: true, message: 'Pasta criada com sucesso.', folderPath: normalizedPath }), { headers: { 'Content-Type': 'application/json' } });

    } catch (error) {
        if (String(error.message || '').includes('UNIQUE constraint failed')) {
            return new Response(JSON.stringify({ message: 'A pasta já existe.' }), { status: 409, headers: { 'Content-Type': 'application/json' } });
        }
        console.error('Erro ao criar pasta:', error);
        return new Response(JSON.stringify({ message: 'Erro interno ao criar pasta.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
