'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('funding_transactions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      wallet_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'wallets', key: 'id' },
      },
      type: { type: Sequelize.STRING, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'Pending' },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      turnover_multiplier: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 1 },
      psp_ref: { type: Sequelize.STRING },
      credited_amount: { type: Sequelize.DECIMAL(36, 18) },
      amount_mismatch: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    // one funding transaction per PSP reference, the idempotency backstop
    await queryInterface.addIndex('funding_transactions', ['psp_ref'], {
      unique: true,
      name: 'funding_transactions_psp_ref_unique',
      where: { psp_ref: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex('funding_transactions', ['wallet_id']);

    await queryInterface.addConstraint('funding_transactions', {
      fields: ['type'],
      type: 'check',
      name: 'funding_transactions_type_check',
      where: { type: ['deposit', 'withdrawal'] },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['status'],
      type: 'check',
      name: 'funding_transactions_status_check',
      where: { status: ['Pending', 'Completed', 'Failed'] },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['amount'],
      type: 'check',
      name: 'funding_transactions_amount_positive',
      where: { amount: { [Sequelize.Op.gt]: 0 } },
    });
    await queryInterface.addConstraint('funding_transactions', {
      fields: ['turnover_multiplier'],
      type: 'check',
      name: 'funding_transactions_multiplier_nonnegative',
      where: { turnover_multiplier: { [Sequelize.Op.gte]: 0 } },
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('funding_transactions');
  }
};
