// /functions/api/admin/users.js

export async function onRequestGet(context) {
    const { env, data } = context;
    try {
        const loggedInUser = data.user;

        if (!loggedInUser.permissions.includes('users:view_list')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão: users:view_list' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const db = env.DB;

        // Passo 1: Busca todos os usuários
        const usersStmt = db.prepare(`
            SELECT id, username, created_at, telegram_chat_id
            FROM users
            ORDER BY username ASC
        `);

        // Passo 2: Busca todas as ligações entre usuários e cargos de uma só vez
        const userRolesStmt = db.prepare(`
            SELECT ur.user_id, r.id as role_id, r.name as role_name, r.level as role_level
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            ORDER BY r.level ASC
        `);
        
        // Passo 3 (Opcional): Se o admin puder atribuir cargos, busca a lista de todos os cargos disponíveis
        let rolesStmt;
        if (loggedInUser.permissions.includes('roles:assign')) {
            rolesStmt = db.prepare(`SELECT id, name, level FROM roles ORDER BY level ASC, name ASC`);
        }

        // Executa as queries em paralelo
        const [usersResult, userRolesResult, rolesResult] = await db.batch([
            usersStmt,
            userRolesStmt,
            rolesStmt
        ].filter(Boolean));

        const allUsers = usersResult.results;
        const allUserRoles = userRolesResult.results;
        const allRoles = rolesResult ? rolesResult.results : [];

        // Mapeia os cargos para cada usuário para fácil acesso
        const userRolesMap = new Map();
        allUserRoles.forEach(ur => {
            if (!userRolesMap.has(ur.user_id)) {
                userRolesMap.set(ur.user_id, []);
            }
            userRolesMap.get(ur.user_id).push({
                role_id: ur.role_id,
                role_name: ur.role_name,
                role_level: ur.role_level
            });
        });

        // Adiciona os cargos a cada objeto de usuário
        allUsers.forEach(user => {
            const roles = userRolesMap.get(user.id) || [];
            user.roles = roles;
            // Define o cargo "principal" como o de maior poder para a UI e verificações de hierarquia
            if (roles.length > 0) {
                user.role_name = roles[0].role_name;
                user.role_level = roles[0].role_level;
            } else {
                user.role_name = 'Sem Cargo';
                user.role_level = Infinity;
            }
        });

        return new Response(JSON.stringify({
            success: true,
            users: allUsers,
            roles: allRoles // Retorna a lista completa de cargos para o dropdown de edição
        }), { headers: { 'Content-Type': 'application/json' }});

    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        return new Response(JSON.stringify({ success: false, message: 'Erro interno ao buscar a lista de usuários.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}