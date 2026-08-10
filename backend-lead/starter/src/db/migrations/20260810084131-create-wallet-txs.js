'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.createTable('wallet_txs', {
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
      funding_tx_id: {
        type: Sequelize.UUID,
        references: { model: 'funding_transactions', key: 'id' },
      },
      kind: { type: Sequelize.STRING, allowNull: false },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      balance_after: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    // a funding tx can cause at most one ledger row of each kind: double credit
    // becomes impossible at the DB layer even if application guards fail
    await queryInterface.addIndex('wallet_txs', ['funding_tx_id', 'kind'], {
      unique: true,
      name: 'wallet_txs_funding_tx_kind_unique',
      where: { funding_tx_id: { [Sequelize.Op.ne]: null } },
    });
    await queryInterface.addIndex('wallet_txs', ['wallet_id', 'created_at']);

    await queryInterface.addConstraint('wallet_txs', {
      fields: ['kind'],
      type: 'check',
      name: 'wallet_txs_kind_check',
      where: { kind: ['deposit_credit', 'wager_debit', 'withdrawal_debit'] },
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.dropTable('wallet_txs');
  }
};
