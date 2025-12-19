// services/admin/userManagement.service.js
const db = require("../../config/knex");

class UserManagementService {
    
    // Get user with full details including permissions
    async getUserWithFullDetails(userId) {
        // Get user with role
        const user = await db('user')
            .where('user.id', userId)
            .leftJoin('role', 'user.roleId', 'role.id')
            .leftJoin('user as parent', 'user.parentId', 'parent.id')
            .select(
                'user.*',
                'role.id as role_id',
                'role.name as role_name',
                'role.slug as role_slug',
                'role.rank as role_rank',
                'role.description as role_description',
                'parent.id as parent_id',
                'parent.name as parent_name',
                'parent.email as parent_email'
            )
            .first();

        if (!user) return null;

        // Get role permissions
        const rolePermissions = await db('rolepermission as rp')
            .join('permission as p', 'rp.permissionId', 'p.id')
            .where('rp.roleId', user.roleId)
            .select('p.*');

        // Get staff permissions
        const staffPermissions = await db('staffpermission as sp')
            .join('permission as p', 'sp.permissionId', 'p.id')
            .leftJoin('user as granter', 'sp.grantedBy', 'granter.id')
            .where('sp.userId', userId)
            .whereNull('sp.revokedAt')
            .select(
                'p.*',
                'sp.grantedAt',
                'sp.grantedBy',
                'granter.name as granter_name',
                'granter.email as granter_email'
            );

        // Get houses owned by user
        const housesOwned = await db('house')
            .where('ownerId', userId)
            .select('id', 'name', 'address');

        // Parse metadata if it exists
        if (user.metadata && typeof user.metadata === 'string') {
            try {
                user.metadata = JSON.parse(user.metadata);
            } catch (e) {
                user.metadata = {};
            }
        }

        // Format the response
        return {
            ...user,
            id: user.id.toString(),
            roleId: user.roleId ? user.roleId.toString() : null,
            parentId: user.parentId ? user.parentId.toString() : null,
            role: {
                id: user.role_id ? user.role_id.toString() : null,
                name: user.role_name,
                slug: user.role_slug,
                rank: user.role_rank,
                description: user.role_description
            },
            parent: user.parent_id ? {
                id: user.parent_id.toString(),
                name: user.parent_name,
                email: user.parent_email
            } : null,
            housesOwned,
            permissions: [
                ...rolePermissions.map(rp => rp.key),
                ...staffPermissions.map(sp => sp.key)
            ],
            rolePermissions: rolePermissions.map(rp => ({
                id: rp.id.toString(),
                key: rp.key,
                description: rp.description
            })),
            staffPermissions: staffPermissions.map(sp => ({
                id: sp.id.toString(),
                key: sp.key,
                description: sp.description,
                grantedAt: sp.grantedAt,
                grantedBy: {
                    id: sp.grantedBy ? sp.grantedBy.toString() : null,
                    name: sp.granter_name,
                    email: sp.granter_email
                }
            }))
        };
    }

    // Get user with basic details
    async getUserBasicDetails(userId) {
        const user = await db('user')
            .where('user.id', userId)
            .leftJoin('role', 'user.roleId', 'role.id')
            .select(
                'user.id',
                'user.uuid',
                'user.email',
                'user.name',
                'user.phone',
                'user.avatarUrl',
                'user.status',
                'user.createdAt',
                'role.name as role_name',
                'role.slug as role_slug'
            )
            .first();

        if (!user) return null;

        return {
            ...user,
            id: user.id.toString(),
            role: {
                name: user.role_name,
                slug: user.role_slug
            }
        };
    }

    // Get users with pagination
    async getUsers({ page = 1, limit = 20, search = '', role = null }) {
        const offset = (page - 1) * limit;

        let query = db('user')
            .leftJoin('role', 'user.roleId', 'role.id')
            .leftJoin('user as parent', 'user.parentId', 'parent.id');

        if (search) {
            query = query.where(function() {
                this.where('user.name', 'like', `%${search}%`)
                    .orWhere('user.email', 'like', `%${search}%`)
                    .orWhere('user.phone', 'like', `%${search}%`);
            });
        }

        if (role) {
            query = query.where('role.slug', role);
        }

        // Get total count
        const totalQuery = query.clone();
        const [{ total }] = await totalQuery.count('* as total');

        // Get paginated results
        const users = await query
            .select(
                'user.id',
                'user.uuid',
                'user.email',
                'user.name',
                'user.phone',
                'user.avatarUrl',
                'user.status',
                'user.lastLoginAt',
                'user.createdAt',
                'role.name as role_name',
                'role.slug as role_slug',
                'parent.name as parent_name'
            )
            .offset(offset)
            .limit(limit)
            .orderBy('user.createdAt', 'desc');

        return {
            users: users.map(user => ({
                ...user,
                id: user.id.toString(),
                role: {
                    name: user.role_name,
                    slug: user.role_slug
                },
                parent: user.parent_name
            })),
            pagination: {
                total: parseInt(total),
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        };
    }
}

module.exports = new UserManagementService();