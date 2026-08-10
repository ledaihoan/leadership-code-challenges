import { DataTypes, Model, Sequelize } from 'sequelize';

export type PspCallbackOutcome =
  | 'applied'
  | 'applied_mismatch'
  | 'duplicate'
  | 'invalid_transition'
  | 'orphan';

// Audit row for every callback delivery, whatever we did with it.
export class PspCallbackEvent extends Model {
  declare id: string;
  declare pspRef: string;
  declare fundingTxId: string | null;
  declare outcome: PspCallbackOutcome;
  declare payload: object;
}

export function initPspCallbackEvent(sequelize: Sequelize): void {
  PspCallbackEvent.init(
    {
      id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
      pspRef: { type: DataTypes.STRING, allowNull: false },
      fundingTxId: { type: DataTypes.UUID, allowNull: true },
      outcome: { type: DataTypes.STRING, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
    },
    { sequelize, tableName: 'psp_callback_events', underscored: true, updatedAt: false },
  );
}
