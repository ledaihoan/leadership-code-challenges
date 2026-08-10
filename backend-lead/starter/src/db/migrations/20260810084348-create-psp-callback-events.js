'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('psp_callback_events', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      psp_ref: { type: Sequelize.STRING, allowNull: false },
      funding_tx_id: {
        type: Sequelize.UUID,
        references: { model: 'funding_transactions', key: 'id' },
      },
      outcome: { type: Sequelize.STRING, allowNull: false },
      payload: { type: Sequelize.JSONB, allowNull: false },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.addIndex('psp_callback_events', ['psp_ref']);

    await queryInterface.addConstraint('psp_callback_events', {
      fields: ['outcome'],
      type: 'check',
      name: 'psp_callback_events_outcome_check',
      where: {
        outcome: ['applied', 'applied_mismatch', 'duplicate', 'invalid_transition', 'orphan'],
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('psp_callback_events');
  },
};
