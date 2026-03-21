// /functions/api/admin/users.js

export async function onRequestGet(context) {
    const { env, data } = context;
    try {
        const loggedInUser = data.user;

        if (!loggedInUser.permissions.includes('users:view_list')) {
            return new Response(JSON.stringify({ message: 'Acesso negado. Requer permissão: users:view_list' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
        }

        const db = env.DB;

        const usersPromise = db.prepare(`
            SELECT id, username, created_at, telegram_chat_id
            FROM users
            ORDER BY username ASC
        `).all();

        const userRolesPromise = db.prepare(`
            SELECT ur.user_id, r.id as role_id, r.name as role_name, r.level as role_level
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            ORDER BY r.level ASC
        `).all();

        const rolesPromise = loggedInUser.permissions.includes('roles:assign')
            ? db.prepare('SELECT id, name, level FROM roles ORDER BY level ASC, name ASC').all()
            : Promise.resolve({ results: [] });

        const [usersResult, userRolesResult, rolesResult] = await Promise.all([
            usersPromise,
            userRolesPromise,
            rolesPromise
        ]);

        const allUsers = usersResult.results || [];
        const allUserRoles = userRolesResult.results || [];
        const allRoles = rolesResult.results || [];

        const userRolesMap = new Map();
        allUserRoles.forEach((ur) => {
            if (!userRolesMap.has(ur.user_id)) userRolesMap.set(ur.user_id, []);
            userRolesMap.get(ur.user_id).push({
                role_id: ur.role_id,
                role_name: ur.role_name,
                role_level: ur.role_level
            });
        });

        allUsers.forEach((user) => {
            const roles = userRolesMap.get(user.id) || [];
            user.roles = roles;
            if (roles.length > 0) {
                user.role_name = roles[0].role_name;
                user.role_level = roles[0].role_level;
            } else {
                user.role_name = 'Sem Cargo';
                user.role_level = Infinity;
            }
        });

        return new Response(JSON.stringify({ success: true, users: allUsers, roles: allRoles }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Erro ao buscar usuários:', error);
        return new Response(JSON.stringify({ success: false, message: `Erro interno ao buscar a lista de usuários: ${error.message}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }
}
