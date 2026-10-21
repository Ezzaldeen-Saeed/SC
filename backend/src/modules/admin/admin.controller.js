/**
 * @fileoverview Admin controller - handles admin-level user, call,
 * customer, and dashboard operations.
 * @module modules/admin/admin.controller
 */

const asyncHandler = require('../../utils/asyncHandler');
const usersService = require('../../services/users.service');
const callsService = require('../../services/calls.service');
const customersService = require('../../services/customers.service');
const dashboardService = require('../../services/dashboard.service');
const events = require('../../services/events.service');
const audit = require('../../services/audit.service');

/**
 * Get the full admin dashboard payload (stats + users + calls + customers)
 * in a single response. Lets the dashboard render everything from one request.
 * @route GET /api/admin/overview
 * @returns {{ success: boolean, stats: object, users: object[], calls: object[], customers: object[] }}
 */
const getOverview = asyncHandler(async (req, res) => {
  const overview = await dashboardService.getAdminOverview();
  res.status(200).json({ success: true, ...overview });
});

/**
 * Get all users.
 * @route GET /api/admin/users
 * @returns {{ success: boolean, users: object[] }}
 */
const getUsers = asyncHandler(async (req, res) => {
  const users = await usersService.getAllUsers();
  res.status(200).json({ success: true, users });
});

/**
 * Get a single user's full profile: the user record, their parent (manager)
 * in the hierarchy, their calls, and aggregate call KPIs. Powers the admin
 * "user profile" view so every detail is sourced from the real schema.
 * @route GET /api/admin/users/:id
 * @returns {{ success: boolean, user: object, parent: object|null, calls: object[], stats: object }}
 */
const getUserDetail = asyncHandler(async (req, res) => {
  const user = await usersService.getUserById(req.params.id);

  let parent = null;
  if (user.parent_id) {
    try {
      parent = await usersService.getUserById(user.parent_id);
    } catch (_) {
      parent = null; // parent may have been removed (FK is ON DELETE SET NULL)
    }
  }

  const { calls, stats } = await callsService.getUserCallReport(user.user_id);

  // For managers/supervisors: their rating + the ratings of everyone under them.
  const team = await dashboardService.getTeamRatings(user);

  res.status(200).json({ success: true, user, parent, calls, stats, team });
});

/**
 * Create a new user.
 * @route POST /api/admin/users
 * @returns {{ success: boolean, user: object }}
 */
const createUser = asyncHandler(async (req, res) => {
  const user = await usersService.createUser(req.body);
  events.emit({
    type: 'user.created', title: 'مستخدم جديد',
    body: `تم إنشاء حساب ${user.full_name} (${user.role})`,
    notifType: 'success', roles: ['admin'], exceptUserId: req.user.id,
  });
  res.status(201).json({ success: true, user });
});

/**
 * Update a user's role.
 * @route PUT /api/admin/users/:id/role
 * @returns {{ success: boolean }}
 */
const updateRole = asyncHandler(async (req, res) => {
  await usersService.updateRole(req.params.id, req.body.role);
  events.emit({
    type: 'user.role', title: 'تغيير دور وظيفي',
    body: `تم تحديث دور مستخدم إلى ${req.body.role}`,
    notifType: 'info', roles: ['admin'], userIds: [req.params.id], exceptUserId: req.user.id,
  });
  res.status(200).json({ success: true });
});

/**
 * Update a user's active status.
 * @route PUT /api/admin/users/:id/status
 * @returns {{ success: boolean }}
 */
const updateStatus = asyncHandler(async (req, res) => {
  await usersService.updateStatus(req.params.id, req.body.is_active);
  events.emit({
    type: 'user.status', title: req.body.is_active ? 'تفعيل حساب' : 'تعطيل حساب',
    body: `تم ${req.body.is_active ? 'تفعيل' : 'تعطيل'} حساب مستخدم`,
    notifType: req.body.is_active ? 'success' : 'warn', roles: ['admin'], userIds: [req.params.id], exceptUserId: req.user.id,
  });
  res.status(200).json({ success: true });
});

/**
 * Assign/change a user's parent in the hierarchy (manager_id).
 * @route PUT /api/admin/users/:id/manager
 * @returns {{ success: boolean, user: object }}
 */
const assignManager = asyncHandler(async (req, res) => {
  const user = await usersService.assignParent(req.params.id, req.body.parent_id || null);

  // The audit action depends on who was (re)assigned: an agent → a supervisor,
  // or a supervisor → a manager.
  const action =
    user.role === 'agent' ? 'ASSIGN_AGENT' : user.role === 'supervisor' ? 'ASSIGN_SUPERVISOR' : 'UPDATE_USER';
  audit.record({
    userId: req.user.id,
    action,
    resource: 'user',
    resourceId: req.params.id,
    details: { target_role: user.role, parent_id: req.body.parent_id || null },
    ip: req.ip,
    userAgent: req.get('User-Agent') || null,
  });

  res.status(200).json({ success: true, user });
});

/**
 * Delete a user.
 * @route DELETE /api/admin/users/:id
 * @returns {{ success: boolean }}
 */
const deleteUser = asyncHandler(async (req, res) => {
  await usersService.deleteUser(req.params.id);
  events.emit({
    type: 'user.deleted', title: 'حذف مستخدم',
    body: 'تم حذف حساب مستخدم من النظام',
    notifType: 'warn', roles: ['admin'], exceptUserId: req.user.id,
  });
  res.status(200).json({ success: true });
});

/**
 * Get all calls.
 * @route GET /api/admin/calls
 * @returns {{ success: boolean, calls: object[] }}
 */
const getCalls = asyncHandler(async (req, res) => {
  const calls = await callsService.getAllCalls();
  res.status(200).json({ success: true, calls });
});

/**
 * Get a single call's full detail: the call with agent, customer and scores,
 * plus its complete transcript. Powers the admin call-detail view and PDF.
 * @route GET /api/admin/calls/:id
 * @returns {{ success: boolean, call: object }}
 */
const getCallDetail = asyncHandler(async (req, res) => {
  const call = await callsService.getCallDetail(req.params.id);
  res.status(200).json({ success: true, call });
});

/**
 * Get all customers.
 * @route GET /api/admin/customers
 * @returns {{ success: boolean, customers: object[] }}
 */
const getCustomers = asyncHandler(async (req, res) => {
  const customers = await customersService.getScopedCustomers(null); // all customers + handling agent
  res.status(200).json({ success: true, customers });
});

/**
 * Get admin dashboard statistics.
 * Returns stats directly without a success wrapper for backward compatibility.
 * @route GET /api/admin/stats
 * @returns {{ users: number, calls: number, active_users: number }}
 */
const getStats = asyncHandler(async (req, res) => {
  const stats = await dashboardService.getAdminStats();
  res.status(200).json(stats);
});

/**
 * Recent audit-trail entries (newest first) with the acting user joined.
 * @route GET /api/admin/audit-logs
 * @returns {{ success: boolean, logs: object[] }}
 */
const getAuditLogs = asyncHandler(async (req, res) => {
  const logs = await audit.list({ limit: 500 });
  res.status(200).json({ success: true, logs });
});

module.exports = {
  getOverview,
  getUsers,
  getUserDetail,
  createUser,
  updateRole,
  updateStatus,
  assignManager,
  deleteUser,
  getCalls,
  getCallDetail,
  getCustomers,
  getStats,
  getAuditLogs,
};
