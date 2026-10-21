/**
 * @module repositories/customers.repository
 * @description Data access layer for the customers table.
 * All operations use supabaseAdmin (service role) for full access.
 */

const { supabaseAdmin } = require('../config/supabase');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Retrieve all customers.
 * @returns {Promise<Array<Object>>} Array of customer objects
 * @throws {ApiError} On database error
 */
async function findAll() {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('*');

  if (error) {
    logger.error('CustomersRepository.findAll failed', { error: error.message });
    throw ApiError.internal('Failed to fetch customers');
  }

  return data;
}

/**
 * Retrieve customers by a set of customer IDs.
 * (The customers table is shared and has no owner/user_id column, so callers
 * resolve the relevant customer IDs first — e.g. from the calls table.)
 * @param {Array<string>} customerIds - Array of customer UUIDs
 * @returns {Promise<Array<Object>>} Array of customer objects
 * @throws {ApiError} On database error
 */
async function findByIds(customerIds) {
  if (!customerIds || customerIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('*')
    .in('customer_id', customerIds);

  if (error) {
    logger.error('CustomersRepository.findByIds failed', { error: error.message });
    throw ApiError.internal('Failed to fetch customers by IDs');
  }

  return data;
}

/**
 * Find a customer by phone number (phone_number is UNIQUE).
 * @param {string} phone - The phone number to look up
 * @returns {Promise<Object|null>} The customer, or null if not found
 * @throws {ApiError} On database error
 */
async function findByPhone(phone) {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('phone_number', phone)
    .maybeSingle();

  if (error) {
    logger.error('CustomersRepository.findByPhone failed', { error: error.message });
    throw ApiError.internal('Failed to fetch customer by phone');
  }

  return data;
}

/**
 * Insert a new customer row and return it.
 * (The customers table is not user-scoped — it has no user_id column.)
 * @param {Object} customerData - Column/value pairs (name, phone_number, email)
 * @returns {Promise<Object>} The created customer
 * @throws {ApiError} On database error (409-style on duplicate phone_number)
 */
async function insertCustomer(customerData) {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .insert(customerData)
    .select('*')
    .single();

  if (error) {
    // phone_number فريد — تعارض = رقم مسجّل بالفعل
    if (error.code === '23505') {
      throw ApiError.badRequest('رقم الهاتف مسجّل بالفعل لعميل آخر');
    }
    logger.error('CustomersRepository.insertCustomer failed', { error: error.message });
    throw ApiError.internal('Failed to create customer');
  }

  return data;
}

module.exports = {
  findAll,
  findByIds,
  findByPhone,
  insertCustomer,
};
