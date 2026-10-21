/**
 * @module services/users.service
 * @description Business logic for user management.
 * Handles Supabase Auth integration, user CRUD, supervisor ownership
 * verification, and cache invalidation.
 */

const { supabaseAdmin } = require('../config/supabase');
const usersRepository = require('../repositories/users.repository');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const cache = require('../utils/cache');
const { ROLES, CACHE_KEYS } = require('../utils/constants');

/**
 * Invalidate all user-related caches.
 * Called after any user mutation to ensure dashboards reflect current data.
 */
function invalidateUserCaches() {
  cache.del(CACHE_KEYS.ALL_USERS);
  cache.del(CACHE_KEYS.ADMIN_STATS);
  cache.del(CACHE_KEYS.ADMIN_OVERVIEW);
}

/**
 * Retrieve all users ordered by creation date (newest first).
 * Invalidates the user cache to ensure freshness on explicit fetch.
 * @returns {Promise<Array<Object>>} Array of user objects
 */
async function getAllUsers() {
  const users = await usersRepository.findAll();
  cache.del(CACHE_KEYS.ALL_USERS);
  return users;
}

/**
 * Retrieve a single user by id.
 * @param {string} userId - UUID of the user
 * @returns {Promise<Object>} The user object (full row)
 * @throws {ApiError} NotFound if the user does not exist
 */
async function getUserById(userId) {
  return usersRepository.findById(userId);
}

/**
 * Create a new user in both Supabase Auth and the users table.
 * If the database insert fails, the auth user is rolled back.
 *
 * @param {Object} params - User creation parameters
 * @param {string} params.full_name - Full name
 * @param {string} params.username - Username
 * @param {string} params.email - Email address
 * @param {string} params.role - Role (admin, manager, supervisor, agent)
 * @param {string} [params.phone] - Phone number
 * @param {boolean} [params.is_active=true] - Active status
 * @param {string} params.password - Initial password
 * @returns {Promise<Object>} The created user object from the users table
 * @throws {ApiError} BadRequest on auth failure, Internal on DB failure
 */
/**
 * Validate & resolve the parent for a role, enforcing the strict tree:
 *   • admin / manager → no parent (admin is the root; managers sit under admin)
 *   • supervisor      → parent MUST be a manager
 *   • agent           → parent MUST be a supervisor
 * @returns {Promise<string|null>} the validated parent user_id (or null)
 * @throws {ApiError} badRequest if the rule is violated
 */
async function resolveParentForRole(role, parentId) {
  if (role === ROLES.ADMIN || role === ROLES.MANAGER) return null;

  const need = role === ROLES.AGENT ? ROLES.SUPERVISOR : ROLES.MANAGER;
  if (!parentId) {
    throw ApiError.badRequest(
      role === ROLES.AGENT ? 'لازم تختار المشرف المسؤول عن الموظف' : 'لازم تختار المدير المسؤول عن المشرف'
    );
  }
  const parent = await usersRepository.findById(parentId); // يرمي notFound لو مش موجود
  if (parent.role !== need) {
    throw ApiError.badRequest(`الأب لازم يكون ${need} (المُختار دوره: ${parent.role})`);
  }
  return parentId;
}

async function createUser({ full_name, username, email, role, phone, is_active = true, password, parent_id = null }) {
  // فرض قاعدة الهرمية قبل أي إنشاء (نفشل بدري قبل ما نعمل auth user)
  const parentId = await resolveParentForRole(role, parent_id);

  // Step 1: Create the user in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, username, role, phone, is_active, must_change_password: true },
  });

  if (authError) {
    logger.error('UsersService.createUser auth failed', { email, error: authError.message });
    throw ApiError.badRequest(authError.message);
  }

  const authUser = authData.user;

  // Step 2: Upsert into the users table (manager_id = الأب في الهرمية)
  const { data: dbUser, error: dbError } = await supabaseAdmin
    .from('users')
    .upsert(
      { user_id: authUser.id, full_name, username, email, role, phone, is_active, parent_id: parentId },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (dbError) {
    logger.error('UsersService.createUser db failed, rolling back auth user', {
      userId: authUser.id,
      error: dbError.message,
    });

    // Rollback: delete the auth user
    await supabaseAdmin.auth.admin.deleteUser(authUser.id);

    throw ApiError.internal('Failed to create user record');
  }

  // Step 3: Invalidate caches
  invalidateUserCaches();

  logger.info('User created successfully', { userId: authUser.id, email, role });
  return dbUser;
}

/**
 * Update a user's role in both the users table and Supabase Auth metadata.
 *
 * @param {string} userId - UUID of the user
 * @param {string} role - New role value
 * @returns {Promise<Object>} The updated user object
 * @throws {ApiError} On failure
 */
async function updateRole(userId, role) {
  // Step 1: Update in users table
  const updatedUser = await usersRepository.updateRole(userId, role);

  // Step 2: Sync role to Supabase Auth user_metadata
  try {
    const { data: authData, error: getError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (!getError && authData?.user) {
      const currentMetadata = authData.user.user_metadata || {};
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...currentMetadata, role },
      });
    }
  } catch (err) {
    logger.warn('UsersService.updateRole auth sync failed', { userId, error: err.message });
    // Non-critical: the DB is the source of truth
  }

  // Step 3: Invalidate caches
  invalidateUserCaches();

  logger.info('User role updated', { userId, role });
  return updatedUser;
}

/**
 * Update a user's active status in both the users table and Supabase Auth metadata.
 *
 * @param {string} userId - UUID of the user
 * @param {boolean} isActive - New active status
 * @returns {Promise<Object>} The updated user object
 * @throws {ApiError} On failure
 */
async function updateStatus(userId, isActive) {
  // Step 1: Update in users table
  const updatedUser = await usersRepository.updateStatus(userId, isActive);

  // Step 2: Sync is_active to Supabase Auth user_metadata
  try {
    const { data: authData, error: getError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (!getError && authData?.user) {
      const currentMetadata = authData.user.user_metadata || {};
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        user_metadata: { ...currentMetadata, is_active: isActive },
      });
    }
  } catch (err) {
    logger.warn('UsersService.updateStatus auth sync failed', { userId, error: err.message });
    // Non-critical: the DB is the source of truth
  }

  // Step 3: Invalidate caches
  invalidateUserCaches();

  logger.info('User status updated', { userId, isActive });
  return updatedUser;
}

/**
 * Delete a user from both the users table and Supabase Auth.
 *
 * @param {string} userId - UUID of the user to delete
 * @returns {Promise<void>}
 * @throws {ApiError} On failure
 */
async function deleteUser(userId) {
  // Step 1: Delete from users table
  await usersRepository.deleteById(userId);

  // Step 2: Delete from Supabase Auth
  try {
    await supabaseAdmin.auth.admin.deleteUser(userId);
  } catch (err) {
    logger.warn('UsersService.deleteUser auth deletion failed', { userId, error: err.message });
    // Non-critical: DB record is already gone
  }

  // Step 3: Invalidate caches
  invalidateUserCaches();

  logger.info('User deleted', { userId });
}

/**
 * Get all supervisors managed by a specific manager.
 *
 * @param {string} managerId - UUID of the manager
 * @returns {Promise<Array<Object>>} Array of supervisor user objects
 */
async function getSupervisorsByManager(managerId) {
  return usersRepository.findByManagerId(managerId, ROLES.SUPERVISOR);
}

/**
 * Create a new supervisor under a specific manager.
 * Sets role='supervisor' and manager_id=managerId automatically.
 *
 * @param {string} managerId - UUID of the owning manager
 * @param {Object} params - Supervisor creation parameters
 * @param {string} params.full_name - Full name
 * @param {string} params.username - Username
 * @param {string} params.email - Email address
 * @param {string} [params.phone] - Phone number
 * @param {boolean} [params.is_active=true] - Active status
 * @param {string} params.password - Initial password
 * @returns {Promise<Object>} The created supervisor user object
 * @throws {ApiError} BadRequest on auth failure, Internal on DB failure
 */
async function createSupervisor(managerId, { full_name, username, email, phone, is_active = true, password }) {
  const role = ROLES.SUPERVISOR;

  // Step 1: Create the user in Supabase Auth
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name, username, role, phone, is_active, must_change_password: true },
  });

  if (authError) {
    logger.error('UsersService.createSupervisor auth failed', { email, error: authError.message });
    throw ApiError.badRequest(authError.message);
  }

  const authUser = authData.user;

  // Step 2: Upsert into the users table with manager_id
  const { data: dbUser, error: dbError } = await supabaseAdmin
    .from('users')
    .upsert(
      { user_id: authUser.id, full_name, username, email, role, phone, is_active, parent_id: managerId },
      { onConflict: 'user_id' }
    )
    .select()
    .single();

  if (dbError) {
    logger.error('UsersService.createSupervisor db failed, rolling back auth user', {
      userId: authUser.id,
      error: dbError.message,
    });

    // Rollback: delete the auth user
    await supabaseAdmin.auth.admin.deleteUser(authUser.id);

    throw ApiError.internal('Failed to create supervisor record');
  }

  // Step 3: Invalidate caches
  invalidateUserCaches();

  logger.info('Supervisor created', { userId: authUser.id, email, managerId });
  return dbUser;
}

/**
 * Update a supervisor's active status, with ownership verification.
 * Ensures the supervisor belongs to the specified manager before updating.
 *
 * @param {string} managerId - UUID of the manager claiming ownership
 * @param {string} supervisorId - UUID of the supervisor to update
 * @param {boolean} isActive - New active status
 * @returns {Promise<Object>} The updated supervisor user object
 * @throws {ApiError} Forbidden if not owned, NotFound if not found
 */
async function updateSupervisorStatus(managerId, supervisorId, isActive) {
  // Step 1: Verify ownership
  const supervisor = await usersRepository.findById(supervisorId);

  if (supervisor.parent_id !== managerId || supervisor.role !== ROLES.SUPERVISOR) {
    throw ApiError.forbidden('Not authorized for this supervisor');
  }

  // Step 2: Update status
  return updateStatus(supervisorId, isActive);
}

/**
 * Delete a supervisor, with ownership verification.
 * Ensures the supervisor belongs to the specified manager before deleting.
 *
 * @param {string} managerId - UUID of the manager claiming ownership
 * @param {string} supervisorId - UUID of the supervisor to delete
 * @returns {Promise<void>}
 * @throws {ApiError} Forbidden if not owned, NotFound if not found
 */
async function deleteSupervisor(managerId, supervisorId) {
  // Step 1: Verify ownership
  const supervisor = await usersRepository.findById(supervisorId);

  if (supervisor.parent_id !== managerId || supervisor.role !== ROLES.SUPERVISOR) {
    throw ApiError.forbidden('Not authorized for this supervisor');
  }

  // Step 2: Delete from users table and auth
  await deleteUser(supervisorId);

  logger.info('Supervisor deleted', { supervisorId, managerId });
}

/**
 * Assign a user's parent in the hierarchy (manager_id).
 * agent → supervisor, supervisor → manager, manager → admin.
 * @param {string} userId - UUID of the user to reparent
 * @param {string|null} parentId - UUID of the new parent (or null to detach)
 * @returns {Promise<Object>} The updated user
 */
async function assignParent(userId, parentId) {
  const user = await usersRepository.findById(userId);
  const validated = await resolveParentForRole(user.role, parentId);   // يفرض قاعدة الدور
  const updated = await usersRepository.update(userId, { parent_id: validated });
  invalidateUserCaches();
  logger.info('User parent assigned', { userId, parentId: validated });
  return updated;
}

/**
 * Resolve the agent user objects a given user is allowed to see, per the
 * org hierarchy (manager_id is the parent pointer):
 *   • admin      → all agents
 *   • manager    → agents under their supervisors (their whole unit)
 *   • supervisor → their own agents
 *   • agent      → just themselves
 * @param {{ id: string, role: string }} user - The authenticated user
 * @returns {Promise<Array<Object>>} Array of agent user objects
 */
async function getAgentsForUser(user) {
  const { id, role } = user;

  if (role === ROLES.ADMIN) {
    return usersRepository.findByRole(ROLES.AGENT);
  }
  if (role === ROLES.SUPERVISOR) {
    return usersRepository.findByManagerId(id, ROLES.AGENT);
  }
  if (role === ROLES.MANAGER) {
    const supervisors = await usersRepository.findByManagerId(id, ROLES.SUPERVISOR);
    const supervisorIds = supervisors.map((s) => s.user_id);
    return usersRepository.findByManagerIds(supervisorIds, ROLES.AGENT);
  }
  if (role === ROLES.AGENT) {
    return [await usersRepository.findById(id)];
  }
  return [];
}

/**
 * The agent user_ids a given user can see (IDs only — for scoping calls/reports).
 * @param {{ id: string, role: string }} user
 * @returns {Promise<Array<string>>} Array of agent UUIDs
 */
async function getVisibleAgentIds(user) {
  const agents = await getAgentsForUser(user);
  return agents.map((a) => a.user_id);
}

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateRole,
  updateStatus,
  deleteUser,
  assignParent,
  getSupervisorsByManager,
  createSupervisor,
  updateSupervisorStatus,
  deleteSupervisor,
  getAgentsForUser,
  getVisibleAgentIds,
};
